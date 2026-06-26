#ifndef RUN_SD_BENCHMARK
/*
 * INVICTUS II - MACH-X / SUGAR CanSat Firmware
 * Target: STM32 Bluepill
 * Radio: RFM69HCW @ 433.0 MHz
 * Sensors: 
 *   - 1x BMP388 (I2C)
 *   - 4x LM75 Temperature Sensors (I2C: 0x48, 0x49, 0x4A, 0x4C)
 *   - 1x MPU6500 (SPI)
 *   - 1x U-Blox NEO-6M (Serial)
 *   - 1x SD Card (SPI)
 */

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <RH_RF69.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>
#include <SdFat.h>
#include <IWatchdog.h>
#include "telemetry.h"

// ─── Pin Definitions ─────────────────────────────────────────────────────────
#define RFM69_CS    PA15
#define RFM69_INT   PB5
#define MPU6500_CS  PB12
#define SD_CS       PA4
#define LED_PIN     PA0
#define BUZZER_PIN  PA1

#define RFM69_FREQ  433.0

// ─── Sensor Addresses ────────────────────────────────────────────────────────
const uint8_t LM75_ADDR_1 = 0x48; // PCB 1
const uint8_t LM75_ADDR_2 = 0x49; // PCB 2
const uint8_t LM75_ADDR_3 = 0x4A; // PCB 4
const uint8_t LM75_ADDR_4 = 0x4C; // PCB 3
const uint8_t LM75_ADDRS[4] = { LM75_ADDR_1, LM75_ADDR_2, LM75_ADDR_3, LM75_ADDR_4 };

// ─── Flags ───────────────────────────────────────────────────────────────────
#define FLAG_LAUNCHED     0x01
#define FLAG_APOGEE       0x02
#define FLAG_GPS_FIX      0x04
#define FLAG_BMP_OK       0x08
#define FLAG_IMU_OK       0x10
#define FLAG_SD_OK        0x20
#define FLAG_STALE_SENSOR 0x40
#define FLAG_GPS_RECOVERY 0x80

#define LAUNCH_ALTITUDE_AGL_M 15.0f
#define APOGEE_DROP_M 20.0f
#define RECOVERY_ALTITUDE_AGL_M 20.0f

// ─── Globals ─────────────────────────────────────────────────────────────────
RH_RF69 rf69(RFM69_CS, RFM69_INT);
Adafruit_BMP3XX bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(PB11, PB10);
SPIClass sdSPI(PA7, PA6, PA5);
SdFat sd;
FsFile logFile;

uint16_t pkt_id = 0;
const uint32_t SENSOR_TIMEOUT_MS = 3000;

// TDM State Machine Definitions
enum TdmState {
    TDM_STATE_GPS_LISTEN,
    TDM_STATE_LORA_TX
};
TdmState tdmState = TDM_STATE_GPS_LISTEN;
uint32_t tdmStateStartMs = 0;
const uint32_t GPS_LISTEN_TIMEOUT_MS = 2000;

float baselinePressure = 1013.25f;
uint8_t baselineSamples = 0;
float baselineAltitude = 0.0f;
float maxAltitude = 0.0f;
uint8_t flags = 0;
bool radio_ok = false;
uint8_t missionMode = CANSAT_MODE_PRE_DEPLOY;
uint8_t apogeeConfirmCount = 0;

// Watchdog timestamps
uint32_t lastBmpUpdateMs = 0;
uint32_t lastLm75UpdateMs[4] = {0};

// Sensor data cache
float alt_m = 0.0, press_hpa = 0.0, temp_bmp = 0.0;
float temp_lm75[4] = {0};
float accel_z = 0.0, gyro_x = 0.0;
float gps_lat = 0.0, gps_lon = 0.0;
int rssi_dbm = 0;

// ─── Helpers ─────────────────────────────────────────────────────────────────
uint16_t crc16Ccitt(const uint8_t* data, size_t len) {
    uint16_t crc = 0xFFFF;
    for (size_t i = 0; i < len; i++) {
        crc ^= static_cast<uint16_t>(data[i]) << 8;
        for (uint8_t bit = 0; bit < 8; bit++) {
            crc = (crc & 0x8000) ? static_cast<uint16_t>((crc << 1) ^ 0x1021) : static_cast<uint16_t>(crc << 1);
        }
    }
    return crc;
}

void pulseIndicator(uint8_t count, uint16_t onMs = 40, uint16_t offMs = 80) {
    for (uint8_t i = 0; i < count; i++) {
        digitalWrite(LED_PIN, HIGH);
        digitalWrite(BUZZER_PIN, HIGH);
        delay(onMs);
        digitalWrite(BUZZER_PIN, LOW);
        digitalWrite(LED_PIN, LOW);
        delay(offMs);
    }
}

float readLM75(uint8_t address) {
    Wire.beginTransmission(address);
    Wire.write(0x00); // Temperature register
    if (Wire.endTransmission() != 0) return -999.0f;
    
    Wire.requestFrom(address, (uint8_t)2);
    if (Wire.available() == 2) {
        uint16_t val = (Wire.read() << 8) | Wire.read();
        return (float)((int16_t)val >> 5) * 0.125f;
    }
    return -999.0f;
}

void writeMPU6500(uint8_t reg, uint8_t data) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg & 0x7F); // Write bit is 0
    SPI.transfer(data);
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();
}

uint8_t readRegisterMPU6500(uint8_t reg) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg | 0x80); // Read bit is 1
    uint8_t val = SPI.transfer(0xFF);
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();
    return val;
}

void readMPU6500() {
    if (!(flags & FLAG_IMU_OK)) return;

    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(0x3B | 0x80); // Read from ACCEL_XOUT_H
    
    uint8_t buf[14];
    for (int i = 0; i < 14; i++) {
        buf[i] = SPI.transfer(0xFF);
    }
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();

    // Check if the read buffer is all 0x00 or all 0xFF (communication failure)
    bool allZero = true;
    bool allFF = true;
    for (int i = 0; i < 14; i++) {
        if (buf[i] != 0x00) allZero = false;
        if (buf[i] != 0xFF) allFF = false;
    }

    if (allZero || allFF) {
        flags &= ~FLAG_IMU_OK;
        return;
    }

    int16_t az = (buf[4] << 8) | buf[5];
    int16_t gx = (buf[8] << 8) | buf[9];

    accel_z = az * (2.0f * 9.80665f / 32768.0f);
    gyro_x = gx * (250.0f / 32768.0f);
}

void recoverI2CBus() {
    Serial.println("I2C: Running bus recovery...");
    pinMode(PB6, OUTPUT);
    pinMode(PB7, INPUT_PULLUP);
    delayMicroseconds(10);

    // Clock out up to 16 cycles if SDA is stuck LOW
    for (int i = 0; i < 16; i++) {
        if (digitalRead(PB7) == HIGH) {
            break;
        }
        digitalWrite(PB6, LOW);
        delayMicroseconds(10);
        digitalWrite(PB6, HIGH);
        delayMicroseconds(10);
    }

    // Generate STOP condition
    pinMode(PB7, OUTPUT);
    digitalWrite(PB7, LOW);
    delayMicroseconds(10);
    digitalWrite(PB6, HIGH);
    delayMicroseconds(10);
    digitalWrite(PB7, HIGH);
    delayMicroseconds(10);

    // Re-initialize Wire
    Wire.begin();
    #if defined(WIRE_HAS_TIMEOUT)
    Wire.setWireTimeout(3000, true);
    #endif
}

void updateMissionMode(float altitudeM) {
    if (!(flags & FLAG_LAUNCHED) && altitudeM > LAUNCH_ALTITUDE_AGL_M) {
        flags |= FLAG_LAUNCHED;
    }

    if (altitudeM > maxAltitude) {
        maxAltitude = altitudeM;
    }

    if ((flags & FLAG_LAUNCHED) && !(flags & FLAG_APOGEE)) {
        if ((maxAltitude - altitudeM) > APOGEE_DROP_M) {
            if (apogeeConfirmCount < 3) apogeeConfirmCount++;
        } else {
            apogeeConfirmCount = 0;
        }

        if (apogeeConfirmCount >= 3) {
            flags |= FLAG_APOGEE;
            missionMode = CANSAT_MODE_DEPLOYED_SCIENCE;
            pulseIndicator(3);
        }
    }

    if (missionMode == CANSAT_MODE_DEPLOYED_SCIENCE &&
        altitudeM <= (baselineAltitude + RECOVERY_ALTITUDE_AGL_M)) {
        missionMode = CANSAT_MODE_GPS_RECOVERY;
        pulseIndicator(6, 30, 40);
    }
}

uint8_t buildTransmitFlags(bool gpsFixValid) {
    uint8_t txFlags = flags;

    if (missionMode == CANSAT_MODE_GPS_RECOVERY) {
        txFlags |= FLAG_GPS_RECOVERY;
        txFlags &= ~(FLAG_BMP_OK | FLAG_IMU_OK | FLAG_SD_OK | FLAG_STALE_SENSOR);
        if (gpsFixValid) txFlags |= FLAG_GPS_FIX;
        else txFlags &= ~FLAG_GPS_FIX;
        return txFlags;
    }

    txFlags &= ~(FLAG_GPS_RECOVERY | FLAG_GPS_FIX);
    return txFlags;
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
    #if defined(HAL_AFIO_MODULE_ENABLED)
    __HAL_AFIO_REMAP_SWJ_NOJTAG(); // Free PA15 (JTAG) for RFM69 CS, keep SWD
    #endif

    Serial.begin(115200);
    SerialGPS.begin(9600);

    pinMode(LED_PIN, OUTPUT);
    pinMode(BUZZER_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    
    // Perform I2C bus recovery and initialize Wire
    recoverI2CBus();
    
    // IWatchdog timeout is in microseconds (3,000,000 us = 3 seconds)
    IWatchdog.begin(3000000); 

    // Initialize watchdog timestamps
    lastBmpUpdateMs = millis();
    for (int i = 0; i < 4; i++) {
        lastLm75UpdateMs[i] = millis();
    }

    // SPI Setup
    SPI.setMOSI(PB15);
    SPI.setMISO(PB14);
    SPI.setSCLK(PB13);
    SPI.begin();

    // Shared SPI2 bus safety: de-select all devices before any SPI transfers
    pinMode(RFM69_CS, OUTPUT);
    digitalWrite(RFM69_CS, HIGH);

    pinMode(MPU6500_CS, OUTPUT);
    digitalWrite(MPU6500_CS, HIGH);

    pinMode(SD_CS, OUTPUT);
    digitalWrite(SD_CS, HIGH);
    
    // Verify MPU6500 is alive and communicating before waking it up
    uint8_t who = readRegisterMPU6500(0x75);
    Serial.print("MPU6500: WHO_AM_I = 0x");
    Serial.println(who, HEX);
    if (who == 0x70 || who == 0x71 || who == 0x72 || who == 0x73 || who == 0x98 || who == 0x68) {
        // Wake MPU6500
        writeMPU6500(0x6B, 0x00);
        delay(10);
        flags |= FLAG_IMU_OK;
    } else {
        flags &= ~FLAG_IMU_OK;
        Serial.println("MPU6500: Failed WHO_AM_I test!");
    }

    // Init RFM69HCW radio. RESET is intentionally unconnected in the flight harness.
    radio_ok = rf69.init();
    if (radio_ok) {
        if (!rf69.setFrequency(RFM69_FREQ)) {
            radio_ok = false;
        } else {
            rf69.setTxPower(20, true); // RFM69HCW high-power module
        }
    }

    // Init BMP388
    if (bmp.begin_I2C()) {
        bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
        bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
        bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
        bmp.setOutputDataRate(BMP3_ODR_50_HZ);
        flags |= FLAG_BMP_OK;
        lastBmpUpdateMs = millis();
    }

    // SD Init
    if (sd.begin(SdSpiConfig(SD_CS, DEDICATED_SPI, SD_SCK_MHZ(4), &sdSPI))) {
        logFile = sd.open("machx_flight.csv", O_WRONLY | O_CREAT | O_APPEND);
        if (logFile) {
            logFile.println("pkt_id,timestamp_ms,mission_mode,altitude_m,temp_c,pressure_hpa,temp_c_1,temp_c_2,temp_c_3,temp_c_4,accel_z,gyro_x,lat,lon,rssi_dbm,flags");
            flags |= FLAG_SD_OK;
        }
    }

    // Put radio to sleep at boot to minimize current draw between packets.
    if (radio_ok) {
        rf69.sleep();
    }
    pulseIndicator(radio_ok ? 2 : 5);
    tdmStateStartMs = millis();
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
void loop() {
    uint32_t now = millis();
    
    // Always feed GPS parser
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    switch (tdmState) {
        case TDM_STATE_GPS_LISTEN: {
            // Check if we received a fresh GPS lock update OR if we timed out (2 seconds)
            bool gpsReady = (gps.location.isUpdated() && gps.location.age() < 1000);
            bool timeout = (now - tdmStateStartMs >= GPS_LISTEN_TIMEOUT_MS);
            
            if (gpsReady || timeout) {
                bool gpsFixValid = gps.location.isValid() && gps.location.age() < 2000;
                bool sampleScience = missionMode != CANSAT_MODE_GPS_RECOVERY;
                bool bmpReadSuccess = false;
                bool lm75Success[4] = {false};

                if (sampleScience) {
                    if (flags & FLAG_BMP_OK && bmp.performReading()) {
                        temp_bmp = bmp.temperature;
                        press_hpa = bmp.pressure / 100.0f;

                        if (baselineSamples < 20) {
                            baselinePressure = ((baselinePressure * baselineSamples) + press_hpa) / (baselineSamples + 1);
                            baselineSamples++;
                            baselineAltitude = 0.0f;
                        }
                        alt_m = bmp.readAltitude(baselinePressure);
                        bmpReadSuccess = true;
                        lastBmpUpdateMs = now;
                    }
                    
                    for (int i = 0; i < 4; i++) {
                        float t = readLM75(LM75_ADDRS[i]);
                        if (t != -999.0f) {
                            temp_lm75[i] = t;
                            lastLm75UpdateMs[i] = now;
                            lm75Success[i] = true;
                        } else {
                            temp_lm75[i] = -999.0f;
                        }
                    }

                    // I2C bus recovery is only attempted during science sampling.
                    static int consecutiveI2cFails = 0;
                    if (!bmpReadSuccess && !lm75Success[0] && !lm75Success[1] && !lm75Success[2] && !lm75Success[3]) {
                        consecutiveI2cFails++;
                        if (consecutiveI2cFails >= 3) {
                            recoverI2CBus();
                            consecutiveI2cFails = 0;
                        }
                    } else {
                        consecutiveI2cFails = 0;
                    }

                    updateMissionMode(alt_m);

                    if (missionMode != CANSAT_MODE_GPS_RECOVERY) {
                        readMPU6500();
                    }

                    bool sensorStale = false;
                    if (now - lastBmpUpdateMs > SENSOR_TIMEOUT_MS) {
                        sensorStale = true;
                    }
                    for (int i = 0; i < 4; i++) {
                        if (now - lastLm75UpdateMs[i] > SENSOR_TIMEOUT_MS) {
                            sensorStale = true;
                        }
                    }
                    if (!(flags & FLAG_IMU_OK)) {
                        sensorStale = true;
                    }

                    if (sensorStale) {
                        flags |= FLAG_STALE_SENSOR;
                    } else {
                        flags &= ~FLAG_STALE_SENSOR;
                    }
                }

                if (missionMode == CANSAT_MODE_GPS_RECOVERY && gpsFixValid) {
                    gps_lat = gps.location.lat();
                    gps_lon = gps.location.lng();
                } else if (missionMode != CANSAT_MODE_GPS_RECOVERY) {
                    gps_lat = 0.0f;
                    gps_lon = 0.0f;
                }

                uint8_t txFlags = buildTransmitFlags(gpsFixValid);

                TelemetryPacket packet = {};
                packet.sync = TELEMETRY_SYNC;
                packet.version = TELEMETRY_VERSION;
                packet.source_id = TELEMETRY_SOURCE_CANSAT;
                packet.payload_len = TELEMETRY_PAYLOAD_LEN;
                packet.pkt_id = pkt_id;
                packet.timestamp_ms = now;
                packet.mode = missionMode;
                packet.altitude_m = alt_m;
                packet.temp_c = temp_bmp;
                packet.pressure_hpa = press_hpa;
                packet.temp_c_1 = temp_lm75[0];
                packet.temp_c_2 = temp_lm75[1];
                packet.temp_c_3 = temp_lm75[2];
                packet.temp_c_4 = temp_lm75[3];
                packet.accel_z = accel_z;
                packet.gyro_x = gyro_x;
                packet.lat = gps_lat;
                packet.lon = gps_lon;
                packet.rssi_dbm = rssi_dbm;
                packet.flags = txFlags;
                packet.crc16 = crc16Ccitt((uint8_t*)&packet, sizeof(packet) - sizeof(packet.crc16));

                if (radio_ok) {
                    rf69.setModeIdle(); // Wake from sleep before loading FIFO
                    rf69.send((uint8_t*)&packet, sizeof(packet));
                }

                // USB bench output uses the same v3 frame that the backend parser accepts.
                Serial.write((uint8_t*)&packet, sizeof(packet));
                
                // Log science data only. GPS recovery avoids SD writes and non-GPS sampling.
                if ((txFlags & FLAG_SD_OK) && missionMode != CANSAT_MODE_GPS_RECOVERY) {
                    char csvLine[208];
                    int csvWritten = snprintf(csvLine, sizeof(csvLine),
                        "%u,%lu,%u,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u\n",
                        pkt_id, (unsigned long)now, missionMode, alt_m, temp_bmp, press_hpa,
                        temp_lm75[0], temp_lm75[1], temp_lm75[2], temp_lm75[3],
                        accel_z, gyro_x, gps_lat, gps_lon, rssi_dbm, txFlags
                    );

                    if (csvWritten > 0 && csvWritten < (int)sizeof(csvLine)) {
                        size_t writtenBytes = logFile.print(csvLine);
                        if (writtenBytes != (size_t)csvWritten) {
                            flags &= ~FLAG_SD_OK;
                            Serial.println("SD:WARN write failed; disabling SD_OK flag");
                            pulseIndicator(4);
                        }

                        static uint32_t lastFlushMs = 0;
                        static uint32_t flushIntervalMs = 10000; // start at 10 seconds
                        if ((flags & FLAG_SD_OK) && now - lastFlushMs >= flushIntervalMs) {
                            uint32_t flushStart = millis();
                            logFile.flush();
                            uint32_t flushDuration = millis() - flushStart;
                            lastFlushMs = now;
                            
                            if (flushDuration > 50) {
                                // Degrade flush interval to 30s if SD is slow.
                                flushIntervalMs = 30000;
                            } else {
                                flushIntervalMs = 10000;
                            }
                        }
                    }
                }
                pkt_id++;
                
                // Transition to monitoring transmission state
                tdmState = TDM_STATE_LORA_TX;
                tdmStateStartMs = now;
            }
            break;
        }
        
        case TDM_STATE_LORA_TX: {
            // Check if transmission is complete (non-blocking 10ms wait check)
            bool txDone = true;
            if (radio_ok) {
                txDone = rf69.waitPacketSent(10);
            }
            
            // If TX is complete OR 200ms safety timeout has expired
            if (txDone || (now - tdmStateStartMs >= 200)) {
                if (radio_ok) {
                    rf69.sleep();
                }
                
                // Return to GPS listening state
                tdmState = TDM_STATE_GPS_LISTEN;
                tdmStateStartMs = now;
            }
            break;
        }
    }
    
    IWatchdog.reload();
}
#else // RUN_SD_BENCHMARK

#include <Arduino.h>
#include <SPI.h>
#include <SdFat.h>

// CS and other pins
#define RFM95_CS    PA15
#define MPU6500_CS  PB12
#define SD_CS       PA4

SPIClass sdSPI(PA7, PA6, PA5);
SdFat sd;
FsFile file;

// Test size: 128 KB
const uint32_t TEST_FILE_SIZE = 128 * 1024;
uint8_t buf512[512];
uint8_t buf64[64];

void runBenchmarkForSpeed(uint32_t speedMhz) {
    Serial.println("\n------------------------------------------------");
    Serial.print("Testing SD SPI Clock Speed: ");
    Serial.print(speedMhz);
    Serial.println(" MHz");
    Serial.println("------------------------------------------------");

    // Initialize SD card at the target speed
    if (!sd.begin(SdSpiConfig(SD_CS, DEDICATED_SPI, SD_SCK_MHZ(speedMhz), &sdSPI))) {
        Serial.println("Error: sd.begin() failed at this speed!");
        return;
    }

    Serial.println("SD card initialized successfully.");

    // ---- TEST 1: 512-byte Sequential Writes & Reads ----
    {
        Serial.println("\n[Test 1] 512-Byte Blocks (Buffered writes, single close)");
        
        if (sd.exists("bench512.dat")) {
            sd.remove("bench512.dat");
        }
        
        if (!file.open("bench512.dat", O_WRONLY | O_CREAT | O_TRUNC)) {
            Serial.println("Failed to open file for writing!");
            return;
        }

        uint32_t startWrite = millis();
        uint32_t writeBlocks = TEST_FILE_SIZE / 512;
        uint32_t minLat = 9999999;
        uint32_t maxLat = 0;
        uint32_t sumLat = 0;

        for (uint32_t i = 0; i < writeBlocks; i++) {
            uint32_t blockStart = micros();
            int n = file.write(buf512, 512);
            uint32_t blockTime = micros() - blockStart;

            if (n != 512) {
                Serial.print("Write failed at block ");
                Serial.println(i);
                file.close();
                return;
            }

            if (blockTime < minLat) minLat = blockTime;
            if (blockTime > maxLat) maxLat = blockTime;
            sumLat += blockTime;
        }
        
        uint32_t closeStart = micros();
        file.close();
        uint32_t closeTime = micros() - closeStart;
        uint32_t totalWriteTime = millis() - startWrite;

        float writeSpeed = (float)TEST_FILE_SIZE / totalWriteTime; // KB/s
        Serial.print("Write performance: ");
        Serial.print(writeSpeed, 2);
        Serial.println(" KB/s");
        Serial.print("Latency per 512-byte block: ");
        Serial.print("Min: "); Serial.print((float)minLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Max: "); Serial.print((float)maxLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Avg: "); Serial.print(((float)sumLat / writeBlocks) / 1000.0, 3); Serial.println(" ms");
        Serial.print("File close latency: "); Serial.print((float)closeTime / 1000.0, 3); Serial.println(" ms");

        // Read Speed Test
        if (!file.open("bench512.dat", O_RDONLY)) {
            Serial.println("Failed to open file for reading!");
            return;
        }

        uint32_t startRead = millis();
        minLat = 9999999;
        maxLat = 0;
        sumLat = 0;

        for (uint32_t i = 0; i < writeBlocks; i++) {
            uint32_t blockStart = micros();
            int n = file.read(buf512, 512);
            uint32_t blockTime = micros() - blockStart;

            if (n != 512) {
                Serial.print("Read failed at block ");
                Serial.println(i);
                file.close();
                return;
            }

            if (blockTime < minLat) minLat = blockTime;
            if (blockTime > maxLat) maxLat = blockTime;
            sumLat += blockTime;
        }
        file.close();
        uint32_t totalReadTime = millis() - startRead;

        float readSpeed = (float)TEST_FILE_SIZE / totalReadTime; // KB/s
        Serial.print("Read performance: ");
        Serial.print(readSpeed, 2);
        Serial.println(" KB/s");
        Serial.print("Latency per 512-byte block: ");
        Serial.print("Min: "); Serial.print((float)minLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Max: "); Serial.print((float)maxLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Avg: "); Serial.print(((float)sumLat / writeBlocks) / 1000.0, 3); Serial.println(" ms");
        
        sd.remove("bench512.dat");
    }

    // ---- TEST 2: 512-byte Writes WITH Manual Flush after each write ----
    {
        Serial.println("\n[Test 2] 512-Byte Blocks (Flushed after every block)");
        
        if (sd.exists("bench512f.dat")) {
            sd.remove("bench512f.dat");
        }
        
        if (!file.open("bench512f.dat", O_WRONLY | O_CREAT | O_TRUNC)) {
            Serial.println("Failed to open file for writing!");
            return;
        }

        uint32_t startWrite = millis();
        uint32_t writeBlocks = TEST_FILE_SIZE / 512;
        uint32_t minLat = 9999999;
        uint32_t maxLat = 0;
        uint32_t sumLat = 0;
        uint32_t minFlushLat = 9999999;
        uint32_t maxFlushLat = 0;
        uint32_t sumFlushLat = 0;

        for (uint32_t i = 0; i < writeBlocks; i++) {
            uint32_t blockStart = micros();
            file.write(buf512, 512);
            uint32_t blockTime = micros() - blockStart;

            uint32_t flushStart = micros();
            file.flush();
            uint32_t flushTime = micros() - flushStart;

            if (blockTime < minLat) minLat = blockTime;
            if (blockTime > maxLat) maxLat = blockTime;
            sumLat += blockTime;

            if (flushTime < minFlushLat) minFlushLat = flushTime;
            if (flushTime > maxFlushLat) maxFlushLat = flushTime;
            sumFlushLat += flushTime;
        }
        file.close();
        uint32_t totalWriteTime = millis() - startWrite;

        float writeSpeed = (float)TEST_FILE_SIZE / totalWriteTime; // KB/s
        Serial.print("Write performance (flushed): ");
        Serial.print(writeSpeed, 2);
        Serial.println(" KB/s");
        Serial.print("Write latency (excluding flush): ");
        Serial.print("Min: "); Serial.print((float)minLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Max: "); Serial.print((float)maxLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Avg: "); Serial.print(((float)sumLat / writeBlocks) / 1000.0, 3); Serial.println(" ms");
        Serial.print("Flush latency: ");
        Serial.print("Min: "); Serial.print((float)minFlushLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Max: "); Serial.print((float)maxFlushLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Avg: "); Serial.print(((float)sumFlushLat / writeBlocks) / 1000.0, 3); Serial.println(" ms");

        sd.remove("bench512f.dat");
    }

    // ---- TEST 3: 64-byte Sequential Writes (Simulating telemetry packets) ----
    {
        Serial.println("\n[Test 3] 64-Byte Blocks (Buffered writes, single close)");
        
        if (sd.exists("bench64.dat")) {
            sd.remove("bench64.dat");
        }
        
        if (!file.open("bench64.dat", O_WRONLY | O_CREAT | O_TRUNC)) {
            Serial.println("Failed to open file for writing!");
            return;
        }

        uint32_t startWrite = millis();
        uint32_t writeBlocks = TEST_FILE_SIZE / 64;
        uint32_t minLat = 9999999;
        uint32_t maxLat = 0;
        uint32_t sumLat = 0;

        for (uint32_t i = 0; i < writeBlocks; i++) {
            uint32_t blockStart = micros();
            int n = file.write(buf64, 64);
            uint32_t blockTime = micros() - blockStart;

            if (n != 64) {
                Serial.print("Write failed at block ");
                Serial.println(i);
                file.close();
                return;
            }

            if (blockTime < minLat) minLat = blockTime;
            if (blockTime > maxLat) maxLat = blockTime;
            sumLat += blockTime;
        }
        file.close();
        uint32_t totalWriteTime = millis() - startWrite;

        float writeSpeed = (float)TEST_FILE_SIZE / totalWriteTime; // KB/s
        Serial.print("Write performance: ");
        Serial.print(writeSpeed, 2);
        Serial.println(" KB/s");
        Serial.print("Latency per 64-byte block: ");
        Serial.print("Min: "); Serial.print((float)minLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Max: "); Serial.print((float)maxLat / 1000.0, 3); Serial.print(" ms, ");
        Serial.print("Avg: "); Serial.print(((float)sumLat / writeBlocks) / 1000.0, 3); Serial.println(" ms");

        sd.remove("bench64.dat");
    }
}

void setup() {
    Serial.begin(115200);
    // Wait up to 3 seconds for Serial Monitor to connect
    uint32_t start = millis();
    while (!Serial && (millis() - start < 3000)) delay(10);

    Serial.println("\n========================================");
    Serial.println("INVICTUS II - SD CARD SPEED BENCHMARK");
    Serial.println("========================================");

    // Disable SPI bus devices to prevent bus conflicts
    pinMode(RFM95_CS, OUTPUT);
    digitalWrite(RFM95_CS, HIGH);

    pinMode(MPU6500_CS, OUTPUT);
    digitalWrite(MPU6500_CS, HIGH);

    pinMode(SD_CS, OUTPUT);
    digitalWrite(SD_CS, HIGH);

    // Initialize SPIClass pins
    sdSPI.setMOSI(PA7);
    sdSPI.setMISO(PA6);
    sdSPI.setSCLK(PA5);
    sdSPI.begin();

    // Prepare buffer data
    for (int i = 0; i < 512; i++) {
        buf512[i] = 'A' + (i % 26);
    }
    for (int i = 0; i < 64; i++) {
        buf64[i] = 'a' + (i % 26);
    }

    // Run tests at different clock speeds
    runBenchmarkForSpeed(4);
    runBenchmarkForSpeed(8);
    runBenchmarkForSpeed(12);
    runBenchmarkForSpeed(16);
    runBenchmarkForSpeed(18);
    runBenchmarkForSpeed(24);

    Serial.println("\nBenchmark complete! You can safely power off or reset.");
}

void loop() {
    // Nothing to do
    delay(1000);
}

#endif // RUN_SD_BENCHMARK

