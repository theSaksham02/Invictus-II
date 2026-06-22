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

float baselinePressure = 1013.25f;
uint8_t baselineSamples = 0;
float maxAltitude = 0.0f;
uint8_t flags = 0;
bool radio_ok = false;

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
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg);
    SPI.transfer(data);
    digitalWrite(MPU6500_CS, HIGH);
}

void readMPU6500() {
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(0x3B | 0x80); // Read from ACCEL_XOUT_H
    int16_t ax = (SPI.transfer(0) << 8) | SPI.transfer(0);
    int16_t ay = (SPI.transfer(0) << 8) | SPI.transfer(0);
    int16_t az = (SPI.transfer(0) << 8) | SPI.transfer(0);
    int16_t temp = (SPI.transfer(0) << 8) | SPI.transfer(0);
    int16_t gx = (SPI.transfer(0) << 8) | SPI.transfer(0);
    digitalWrite(MPU6500_CS, HIGH);
    
    accel_z = az / 16384.0f * 9.81f; // +/- 2g scale
    gyro_x = gx / 131.0f;            // +/- 250dps scale
    
    if (az != 0 && az != -1) {
        flags |= FLAG_IMU_OK;
    } else {
        flags &= ~FLAG_IMU_OK;
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
    #if defined(HAL_AFIO_MODULE_ENABLED)
    __HAL_AFIO_REMAP_SWJ_NOJTAG(); // Free PA15 (JTAG) for RFM95 CS, keep SWD
    #endif

    Serial.begin(115200);
    SerialGPS.begin(9600);
    Wire.begin();
    
    IWatchdog.begin(3000); // 3 seconds

    // SPI Setup
    SPI.setMOSI(PB15);
    SPI.setMISO(PB14);
    SPI.setSCLK(PB13);
    SPI.begin();

    pinMode(MPU6500_CS, OUTPUT);
    digitalWrite(MPU6500_CS, HIGH); // Deselect MPU6500 to free SPI bus
    
    // Wake MPU6500
    writeMPU6500(0x6B, 0x00);
    delay(10);

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
    }

    // SD Init
    if (sd.begin(SdSpiConfig(SD_CS, DEDICATED_SPI, SD_SCK_MHZ(4), &sdSPI))) {
        logFile = sd.open("machx_flight.csv", O_WRONLY | O_CREAT | O_APPEND);
        if (logFile) {
            logFile.println("pkt_id,timestamp_ms,alt,press,temp_bmp,t1,t2,t3,t4,accel_z,gyro_x,lat,lon,rssi,flags");
            flags |= FLAG_SD_OK;
        }
    }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────
void loop() {
    uint32_t now = millis();
    
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    if (now - lastTxMs >= TX_INTERVAL_MS) {
        lastTxMs += TX_INTERVAL_MS;
        if (now - lastTxMs >= TX_INTERVAL_MS) lastTxMs = now; // Prevent spiral of death
        
        // 1. Read Sensors
        if (flags & FLAG_BMP_OK && bmp.performReading()) {
            temp_bmp = bmp.temperature;
            press_hpa = bmp.pressure / 100.0f;
            
            if (baselineSamples < 20) {
                baselinePressure = ((baselinePressure * baselineSamples) + press_hpa) / (baselineSamples + 1);
                baselineSamples++;
            }
            alt_m = bmp.readAltitude(baselinePressure);
            if (alt_m > maxAltitude) maxAltitude = alt_m;
        }
        
        temp_lm75[0] = readLM75(LM75_ADDR_1);
        temp_lm75[1] = readLM75(LM75_ADDR_2);
        temp_lm75[2] = readLM75(LM75_ADDR_3);
        temp_lm75[3] = readLM75(LM75_ADDR_4);
        
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
                // 5. Send over LoRa
                if (radio_ok) {
                    rf95.send((uint8_t*)finalPacket, strlen(finalPacket));
                    rf95.waitPacketSent(100);
                }
                
                // 6. Log to SD
                if (flags & FLAG_SD_OK) {
                    logFile.print(finalPacket);
                    logFile.flush();
                }
                
                Serial.print(finalPacket); // Local debug
            }
        }
        pkt_id++;
        
        IWatchdog.reload();
    }
}
