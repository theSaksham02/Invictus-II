#include <Arduino.h>
#include <RH_RF69.h>
#include <SPI.h>
#include <Adafruit_BMP3XX.h>
#include <Adafruit_MPU6050.h>
#include <TinyGPSPlus.h>
#include "telemetry.h"

#define RFM69_CS PA4
#define RFM69_INT PA3
#define RFM69_RST PA2
#define RF69_FREQ 433.0

RH_RF69 rf69(RFM69_CS, RFM69_INT);

Adafruit_BMP3XX bmp; 
Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial SerialGPS(USART2); // PA3 (RX), PA2 (TX) // Check pinouts

float baseline_pressure = 1013.25;

TelemetryPacket pkt;
uint32_t last_tx = 0;
const uint32_t TX_INTERVAL = 100; // 10Hz

void setup() {
    Serial.begin(115200);
    pkt.pkt_id = 0;
}

void loop() {
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    if (gps.location.isUpdated() && gps.location.isValid()) {
        pkt.flags |= 0x04; // gps_fix
        pkt.lat = gps.location.lat();
        pkt.lon = gps.location.lng();
    }

    if (millis() - last_tx >= TX_INTERVAL) {
        last_tx = millis();
        pkt.pkt_id++;
        pkt.timestamp_ms = millis();
        
        if (pkt.flags & 0x08) {
            if (bmp.performReading()) {
                pkt.temp_c = bmp.temperature;
                pkt.pressure_hpa = bmp.pressure / 100.0;
                if (pkt.pkt_id == 1) baseline_pressure = pkt.pressure_hpa;
                pkt.altitude_m = bmp.readAltitude(baseline_pressure);
            }
        }

        if (pkt.flags & 0x10) {
            sensors_event_t a, g, temp;
            mpu.getEvent(&a, &g, &temp);
            pkt.accel_z = a.acceleration.z / 9.81; // Convert m/s^2 to G's
            pkt.gyro_x = g.gyro.x * 57.2958;       // Convert rad/s to deg/s
        }
        
        // Checksum calculation (XOR bytes 0-35)
        uint8_t* ptr = (uint8_t*)&pkt;
        pkt.checksum = 0;
        for(int i = 0; i < 36; i++) {
            pkt.checksum ^= ptr[i];
        }
        
        // Transmit
        rf69.send((uint8_t*)&pkt, sizeof(TelemetryPacket));
        rf69.waitPacketSent();
        
        // TODO: SD Write
    }
}imestamp_ms = millis();
        
        // Checksum calculation (XOR bytes 0-35)
        uint8_t* ptr = (uint8_t*)&pkt;
        pkt.checksum = 0;
        for(int i = 0; i < 36; i++) {
            pkt.checksum ^= ptr[i];
        }
        
        // TODO: Transmit & SD Write
    }
}