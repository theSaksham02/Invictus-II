/*
 * INVICTUS II - MACH-X / SUGAR CanSat Firmware
 * Target: STM32 Bluepill
 * Radio: RFM95W @ 868.0 MHz (LoRa)
 * Sensors: 
 *   - 1x BMP388 (I2C)
 *   - 4x LM75 Temperature Sensors (I2C: 0x48, 0x49, 0x4A, 0x4C)
 *   - 1x MPU6500 (SPI)
 *   - 1x U-Blox NEO-8M (Serial)
 *   - 1x SD Card (SPI)
 */

#include <Arduino.h>
#include <SPI.h>
#include <Wire.h>
#include <RH_RF95.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>
#include <SdFat.h>
#include <IWatchdog.h>

// ─── Pin Definitions ─────────────────────────────────────────────────────────
#define RFM95_CS    PA15
#define RFM95_INT   PB5
#define MPU6500_CS  PB12
#define SD_CS       PA4

#define RFM95_FREQ  868.0

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

// ─── Globals ─────────────────────────────────────────────────────────────────
RH_RF95 rf95(RFM95_CS, RFM95_INT);
Adafruit_BMP3XX bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(PB11, PB10);
SPIClass sdSPI(PA7, PA6, PA5);
SdFat sd;
FsFile logFile;

uint32_t pkt_id = 0;
uint32_t lastTxMs = 0;
const uint32_t TX_INTERVAL_MS = 1000;
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
float maxAltitude = 0.0f;
uint8_t flags = 0;
bool radio_ok = false;

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

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
    #if defined(HAL_AFIO_MODULE_ENABLED)
    __HAL_AFIO_REMAP_SWJ_NOJTAG(); // Free PA15 (JTAG) for RFM95 CS, keep SWD
    #endif

    Serial.begin(115200);
    SerialGPS.begin(9600);
    
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

    // Shared SPI bus safety: de-select all devices before any SPI transfers
    pinMode(RFM95_CS, OUTPUT);
    digitalWrite(RFM95_CS, HIGH);

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

    // Init Radio
    radio_ok = rf95.init();
    if (radio_ok) {
        if (!rf95.setFrequency(RFM95_FREQ)) {
            radio_ok = false;
        } else {
            rf95.setTxPower(20, false); // High power LoRa
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
            logFile.println("pkt_id,timestamp_ms,alt,press,temp_bmp,t1,t2,t3,t4,accel_z,gyro_x,lat,lon,rssi,flags");
            flags |= FLAG_SD_OK;
        }
    }

    // Put LoRa to sleep at boot to unblind GPS immediately
    if (radio_ok) {
        rf95.sleep();
    }
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
                // 1. Read Sensors
                bool bmpReadSuccess = false;
                if (flags & FLAG_BMP_OK && bmp.performReading()) {
                    temp_bmp = bmp.temperature;
                    press_hpa = bmp.pressure / 100.0f;
                    
                    if (baselineSamples < 20) {
                        baselinePressure = ((baselinePressure * baselineSamples) + press_hpa) / (baselineSamples + 1);
                        baselineSamples++;
                    }
                    alt_m = bmp.readAltitude(baselinePressure);
                    if (alt_m > maxAltitude) maxAltitude = alt_m;
                    bmpReadSuccess = true;
                    lastBmpUpdateMs = now;
                }
                
                bool lm75Success[4] = {false};
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

                // I2C Bus recovery trigger: if BMP and all LM75s fail consecutively
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
                
                if (gps.location.isValid() && gps.location.age() < 2000) {
                    gps_lat = gps.location.lat();
                    gps_lon = gps.location.lng();
                    flags |= FLAG_GPS_FIX;
                } else {
                    flags &= ~FLAG_GPS_FIX;
                }
                
                // Pseudo-logic for mission phase
                if (!(flags & FLAG_LAUNCHED) && alt_m > 15.0) {
                    flags |= FLAG_LAUNCHED;
                }
                if ((flags & FLAG_LAUNCHED) && !(flags & FLAG_APOGEE) && (maxAltitude - alt_m) > 20.0) {
                    flags |= FLAG_APOGEE;
                }
                
                // Read IMU
                readMPU6500();

                // Stale sensor watchdog (stale if older than 3 seconds, or IMU not ok)
                bool sensorStale = false;
                if (now - lastBmpUpdateMs > SENSOR_TIMEOUT_MS) {
                    sensorStale = true;
                }
                for (int i = 0; i < 4; i++) {
                    if (now - lastLm75UpdateMs[i] > SENSOR_TIMEOUT_MS) {
                        sensorStale = true;
                    }
                }
                if ((flags & FLAG_LAUNCHED) && (!gps.location.isValid() || gps.location.age() > 5000)) {
                    sensorStale = true;
                }
                if (!(flags & FLAG_IMU_OK)) {
                    sensorStale = true;
                }

                if (sensorStale) {
                    flags |= FLAG_STALE_SENSOR;
                } else {
                    flags &= ~FLAG_STALE_SENSOR;
                }

                // 2. Format MACHX2 body string (without MACHX2:, CRC and \n)
                char bodyBuf[256];
                int written = snprintf(bodyBuf, sizeof(bodyBuf), 
                    "%lu,%lu,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u",
                    pkt_id, now, alt_m, press_hpa, temp_bmp, 
                    temp_lm75[0], temp_lm75[1], temp_lm75[2], temp_lm75[3],
                    accel_z, gyro_x, gps_lat, gps_lon, rssi_dbm, flags
                );
                
                if (written >= 0 && written < (int)sizeof(bodyBuf)) {
                    // 3. Compute CRC16 CCITT over the payload ONLY
                    uint16_t crc = crc16Ccitt((uint8_t*)bodyBuf, strlen(bodyBuf));
                    
                    // 4. Append Prefix, Body, CRC and newline
                    char finalPacket[256];
                    int finalWritten = snprintf(finalPacket, sizeof(finalPacket), "MACHX2:%s,%04X\n", bodyBuf, crc);
                    
                    if (finalWritten >= 0 && finalWritten < (int)sizeof(finalPacket)) {
                        // 5. Wake up LoRa and Send
                        if (radio_ok) {
                            rf95.setModeIdle(); // Wake up from sleep mode
                            rf95.send((uint8_t*)finalPacket, strlen(finalPacket));
                        }
                        
                        // 6. Log to SD with bounded/periodic flushing
                        if (flags & FLAG_SD_OK) {
                            size_t expectedBytes = strlen(finalPacket);
                            size_t writtenBytes = logFile.print(finalPacket);
                            if (writtenBytes != expectedBytes) {
                                flags &= ~FLAG_SD_OK;
                                Serial.println("SD:WARN write failed; disabling SD_OK flag");
                            }
                            
                            static uint32_t lastFlushMs = 0;
                            static uint32_t flushIntervalMs = 10000; // start at 10 seconds
                            if ((flags & FLAG_SD_OK) && now - lastFlushMs >= flushIntervalMs) {
                                uint32_t flushStart = millis();
                                logFile.flush();
                                uint32_t flushDuration = millis() - flushStart;
                                lastFlushMs = now;
                                
                                if (flushDuration > 50) {
                                    // Degrade flush interval to 30s if SD is slow
                                    flushIntervalMs = 30000;
                                } else {
                                    flushIntervalMs = 10000;
                                }
                            }
                        }
                        
                        Serial.print(finalPacket); // Local debug
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
                txDone = rf95.waitPacketSent(10);
            }
            
            // If TX is complete OR 200ms safety timeout has expired
            if (txDone || (now - tdmStateStartMs >= 200)) {
                // Put radio back to sleep to unblind GPS
                if (radio_ok) {
                    rf95.sleep();
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
