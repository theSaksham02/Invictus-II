#include <Arduino.h>
#include <RH_RF69.h>
#include <SPI.h>
#include "telemetry.h"

#define RFM69_CS PA4
#define RFM69_INT PA3
#define RFM69_RST PA2
#define RF69_FREQ 433.0

RH_RF69 rf69(RFM69_CS, RFM69_INT);

TelemetryPacket pkt;
uint32_t last_tx = 0;
const uint32_t TX_INTERVAL = 100; // 10Hz

void setup() {
    Serial.begin(115200);
    pkt.pkt_id = 0;
}

void loop() {
    if (millis() - last_tx >= TX_INTERVAL) {
        last_tx = millis();
        pkt.pkt_id++;
        pkt.timestamp_ms = millis();
        
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