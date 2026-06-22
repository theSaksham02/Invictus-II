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
        Serial.println("GCS:ERROR RFM95W init failed, restarting...");
        delay(500);
        ESP.restart();
    }
    
    if (!rf95.setFrequency(RFM95_FREQ)) {
        Serial.println("GCS:ERROR RFM95W frequency set failed");
        while (1) {
            delay(100);
        }
    }
    // Setting High Power, but GS is mostly receiving
    rf95.setTxPower(20, false);
    
    Serial.println("GCS:READY RFM95W 868MHz");
}

void loop() {
    if (rf95.available()) {
        uint8_t buf[RH_RF95_MAX_MESSAGE_LEN];
        uint8_t len = sizeof(buf);

        if (rf95.recv(buf, &len)) {
            // Null-terminate safely
            if (len < sizeof(buf)) {
                buf[len] = '\0';
            } else {
                buf[sizeof(buf) - 1] = '\0';
            }
            
            // MACHX2 payload has 15 fields separated by 14 commas, plus a CRC separated by the 15th comma.
            char* ptr = (char*)buf;
            int commas = 0;
            char* rssi_start = nullptr;
            
            while(*ptr) {
                if(*ptr == ',') {
                    commas++;
                    if(commas == 13) rssi_start = ptr + 1;
                }
                ptr++;
            }
            
            if (rssi_start && commas >= 14) {
                char* flags_start = strchr(rssi_start, ',');
                if (flags_start) {
                    unsigned int flags = atoi(flags_start + 1);
                    *rssi_start = '\0'; // Truncate at the comma before rssi
                    
                    char newPayload[256];
                    int n = snprintf(newPayload, sizeof(newPayload), "%s%d,%u", (char*)buf, rf95.lastRssi(), flags);
                    
                    if (n > 0 && n < (int)sizeof(newPayload) && n > 7) {
                        uint16_t crc = crc16Ccitt((uint8_t*)(newPayload + 7), n - 7);
                        Serial.printf("%s,%04X\n", newPayload, crc);
                        return; // Done
                    } else {
                        Serial.println("GCS:WARN payload rebuild truncated");
                    }
                }
            }
            
            // Fallback
            Serial.print((char*)buf);
        }
    }
}
