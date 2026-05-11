#include <Arduino.h>
#include <RH_RF69.h>
#include <SPI.h>
#include <Adafruit_BMP3XX.h>
#include <Adafruit_MPU6050.h>
#include <TinyGPSPlus.h>
#include <SD.h>
#include "telemetry.h"

// PIN DEFINITIONS (Matching cansat-hardware.js)
#define RFM69_CS    PA15
#define RFM69_INT   PB5
#define RFM69_RST   PA2 // Not in spec, keeping fallback
#define SD_CS       PA4

// SENSORS & RADIOS
RH_RF69 rf69(RFM69_CS, RFM69_INT);
Adafruit_BMP3XX bmp; 
Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial SerialGPS(PB11, PB10); // RX, TX
File logFile;

// GLOBAL STATE
float baseline_pressure = 1013.25;
TelemetryPacket pkt;
uint32_t last_tx = 0;
const uint32_t TX_INTERVAL = 1000; // 1Hz for NRC requirements

void setup() {
    Serial.begin(115200);
    SerialGPS.begin(9600);
    
    // Initialize Packet
    memset(&pkt, 0, sizeof(TelemetryPacket));
    
    // Initialize RFM69
    pinMode(RFM69_RST, OUTPUT);
    digitalWrite(RFM69_RST, LOW);
    if (rf69.init()) {
        rf69.setFrequency(433.0);
        rf69.setTxPower(20, true);
    }

    // Initialize BMP388
    if (bmp.begin_I2C()) {
        bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
        bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
        bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
        bmp.setOutputDataRate(BMP3_ODR_50_HZ);
        pkt.flags |= 0x08; // bmp_ok
    }

    // Initialize MPU6050
    if (mpu.begin()) {
        mpu.setAccelerometerRange(MPU6050_RANGE_16_G);
        mpu.setGyroRange(MPU6050_RANGE_500_DEG);
        mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
        pkt.flags |= 0x10; // mpu_ok
    }

    // Initialize SD Card
    if (SD.begin(SD_CS)) {
        logFile = SD.open("flight.csv", FILE_WRITE);
        if (logFile) {
            logFile.println("pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags");
            pkt.flags |= 0x20; // sd_ok
        }
    }
}

void loop() {
    // Process GPS
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    if (gps.location.isUpdated() && gps.location.isValid()) {
        pkt.flags |= 0x04; // gps_fix
        pkt.lat = gps.location.lat();
        pkt.lon = gps.location.lng();
    } else {
        pkt.flags &= ~0x04;
    }

    // Telemetry Loop
    if (millis() - last_tx >= TX_INTERVAL) {
        last_tx = millis();
        pkt.pkt_id++;
        pkt.timestamp_ms = millis();
        
        // Update BMP388
        if (pkt.flags & 0x08) {
            if (bmp.performReading()) {
                pkt.temp_c = bmp.temperature;
                pkt.pressure_hpa = bmp.pressure / 100.0;
                if (pkt.pkt_id <= 5) baseline_pressure = pkt.pressure_hpa; // Calibrate baseline first 5 secs
                pkt.altitude_m = bmp.readAltitude(baseline_pressure);
            }
        }

        // Update MPU6050
        if (pkt.flags & 0x10) {
            sensors_event_t a, g, temp;
            mpu.getEvent(&a, &g, &temp);
            pkt.accel_z = a.acceleration.z / 9.81; // G's
            pkt.gyro_x = g.gyro.x * 57.2958;       // deg/s
        }
        
        // Mission Phase Logic (Simple)
        if (!(pkt.flags & 0x01) && pkt.accel_z > 2.5) pkt.flags |= 0x01; // Launched
        if ((pkt.flags & 0x01) && pkt.accel_z < 0.5) pkt.flags |= 0x02;  // Apogee/Descent
        
        // Radio RSSI
        pkt.rssi_dbm = rf69.lastRssi();

        // Checksum
        uint8_t* ptr = (uint8_t*)&pkt;
        pkt.checksum = 0;
        for(int i = 0; i < 36; i++) pkt.checksum ^= ptr[i];

        // SD Logging
        if (logFile) {
            logFile.printf("%u,%u,%.2f,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%u\n",
                pkt.pkt_id, pkt.timestamp_ms, pkt.altitude_m, pkt.temp_c, 
                pkt.pressure_hpa, pkt.accel_z, pkt.gyro_x, pkt.lat, pkt.lon, pkt.flags);
            if (pkt.pkt_id % 5 == 0) logFile.flush();
        }
        
        // RF Transmission
        rf69.send((uint8_t*)&pkt, sizeof(TelemetryPacket));
        rf69.waitPacketSent();
        
        // Debug
        Serial.print("PKT: "); Serial.println(pkt.pkt_id);
    }
}