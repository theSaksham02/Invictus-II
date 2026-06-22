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

    bool radio_ok = false;
    for (int i = 0; i < 3; i++) {
        radio_ok = rf95.init();
        if (radio_ok) break;
        Serial.printf("GCS:WARN RFM95W init attempt %d failed\n", i + 1);
        delay(500);
    }
    
    if (!radio_ok) {
        Serial.println("GCS:FATAL RFM95W init failed completely. Halting...");
        pinMode(2, OUTPUT);
        while (1) {
            digitalWrite(2, HIGH);
            delay(250);
            digitalWrite(2, LOW);
            delay(250);
        }
    }
    
    bool freq_ok = false;
    for (int i = 0; i < 3; i++) {
        freq_ok = rf95.setFrequency(RFM95_FREQ);
        if (freq_ok) break;
        Serial.printf("GCS:WARN RFM95W frequency set attempt %d failed\n", i + 1);
        delay(500);
    }
    
    if (!freq_ok) {
        Serial.println("GCS:FATAL RFM95W frequency set failed completely. Halting...");
        pinMode(2, OUTPUT);
        while (1) {
            digitalWrite(2, HIGH);
            delay(250);
            digitalWrite(2, LOW);
            delay(250);
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
            
            // Strip trailing newlines or whitespace
            while (len > 0 && (buf[len - 1] == '\r' || buf[len - 1] == '\n' || buf[len - 1] == ' ' || buf[len - 1] == '\0')) {
                buf[len - 1] = '\0';
                len--;
            }
            
            if (strncmp((char*)buf, "MACHX2:", 7) == 0) {
                // Count commas to verify the packet format (MACHX2 payload has 15 fields separated by 14 commas, plus a CRC separated by the 15th comma)
                int commas = 0;
                char* comma_ptrs[16] = {nullptr};
                char* p = (char*)buf;
                while (*p) {
                    if (*p == ',') {
                        if (commas < 16) {
                            comma_ptrs[commas] = p;
                        }
                        commas++;
                    }
                    p++;
                }
                
                if (commas == 15) {
                    char* incoming_crc_str = comma_ptrs[14] + 1;
                    uint16_t incoming_crc = (uint16_t)strtol(incoming_crc_str, nullptr, 16);
                    
                    // Verify CRC on the body (from buf + 7 to the 15th comma)
                    size_t body_len = comma_ptrs[14] - ((char*)buf + 7);
                    uint16_t expected_crc = crc16Ccitt((uint8_t*)(buf + 7), body_len);
                    
                    if (incoming_crc == expected_crc) {
                        // Extract flags (after 14th comma, before 15th comma)
                        unsigned int flags = atoi(comma_ptrs[13] + 1);
                        
                        // Truncate at the comma before rssi (13th comma)
                        *comma_ptrs[12] = '\0';
                        
                        char newPayload[256];
                        int n = snprintf(newPayload, sizeof(newPayload), "%s,%d,%u", (char*)buf, rf95.lastRssi(), flags);
                        
                        if (n > 0 && n < (int)sizeof(newPayload) && n > 7) {
                            uint16_t crc = crc16Ccitt((uint8_t*)(newPayload + 7), n - 7);
                            Serial.printf("%s,%04X\n", newPayload, crc);
                            return; // Done
                        } else {
                            Serial.println("GCS:WARN payload rebuild truncated");
                        }
                    } else {
                        Serial.printf("GCS:WARN invalid crc (received %04X, expected %04X)\n", incoming_crc, expected_crc);
                    }
                } else {
                    Serial.printf("GCS:WARN malformed packet (comma count: %d)\n", commas);
                }
            } else {
                // Fallback for non-MACHX2 packets
                Serial.println((char*)buf);
            }
        }
    }
}
