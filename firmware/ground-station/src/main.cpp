/*
 * INVICTUS II - MACH-X / SUGAR Ground Station Firmware
 * Target: ESP32 (WROOM-32)
 * Radio: RFM95W @ 868.0 MHz (LoRa)
 *
 * Role:
 *   - Listens for MACHX2 ASCII telemetry packets over RFM95W
 *   - Forwards the raw string directly over USB Serial to the laptop
 */

#include <Arduino.h>
#include <SPI.h>
#include <RH_RF95.h>

// ─── Pin Definitions (ESP32 WROOM) ───────────────────────────────────────────
#define RFM95_CS      5
#define RFM95_IRQ     4
#define RFM95_RST    14
#define RFM95_FREQ  868.0

#define GCS_SERIAL_BAUD 115200

RH_RF95 rf95(RFM95_CS, RFM95_IRQ);

void setup() {
    Serial.begin(GCS_SERIAL_BAUD);
    
    // Hardware Reset for RFM95
    pinMode(RFM95_RST, OUTPUT);
    digitalWrite(RFM95_RST, HIGH);
    delay(10);
    digitalWrite(RFM95_RST, LOW);
    delay(10);
    digitalWrite(RFM95_RST, HIGH);
    delay(10);

    if (!rf95.init()) {
        Serial.println("GCS:ERROR RFM95W init failed");
        while (1) {
            delay(100);
        }
    }
    
    rf95.setFrequency(RFM95_FREQ);
    // Setting High Power, but GS is mostly receiving
    rf95.setTxPower(20, false);
    
    Serial.println("GCS:READY RFM95W 868MHz");
}

void loop() {
    if (rf95.available()) {
        uint8_t buf[RH_RF95_MAX_MESSAGE_LEN];
        uint8_t len = sizeof(buf);

        if (rf95.recv(buf, &len)) {
            // Null-terminate to ensure safe printing
            if (len < sizeof(buf)) {
                buf[len] = '\0';
            } else {
                buf[sizeof(buf) - 1] = '\0';
            }
            
            // Forward the raw ASCII frame over USB Serial with the RSSI prefix
            Serial.printf("[RSSI:%d] %s", rf95.lastRssi(), (char*)buf);
        }
    }
}
