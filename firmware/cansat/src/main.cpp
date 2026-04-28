#include <Arduino.h>
#include "telemetry.h"

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
        
        // TODO: Transmit & SD Write
    }
}