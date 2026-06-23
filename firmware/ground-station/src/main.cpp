/*
 * INVICTUS II - CanSat Ground Station Receiver
 * Target: ESP32 WROOM-32
 * Radio: RFM69HCW @ 433.0 MHz
 *
 * Role:
 *   - Receives the 43-byte CANSAT v2 binary telemetry frame over RFM69HCW
 *   - Validates sync/version/source/payload length and CRC16-CCITT
 *   - Stamps ground-side RSSI into byte 39
 *   - Recomputes CRC and forwards the raw frame over USB Serial
 */

#include <Arduino.h>
#include <SPI.h>
#include <RH_RF69.h>

// ─── Pin Definitions (ESP32 WROOM) ───────────────────────────────────────────
#define RFM69_CS      5
#define RFM69_IRQ     4
#define RFM69_RST    14
#define RFM69_FREQ  433.0

#define GCS_SERIAL_BAUD 115200

#define TELEMETRY_SYNC 0xA55A
#define TELEMETRY_VERSION 2
#define TELEMETRY_SOURCE_CANSAT 1
#define TELEMETRY_PAYLOAD_LEN 36
#define TELEMETRY_FRAME_BYTES 43
#define TELEMETRY_RSSI_OFFSET 39
#define TELEMETRY_CRC_OFFSET 41

RH_RF69 rf69(RFM69_CS, RFM69_IRQ);

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

bool validFrame(const uint8_t* buf, uint8_t len) {
    if (len != TELEMETRY_FRAME_BYTES) return false;
    uint16_t sync = static_cast<uint16_t>(buf[0]) | (static_cast<uint16_t>(buf[1]) << 8);
    if (sync != TELEMETRY_SYNC) return false;
    if (buf[2] != TELEMETRY_VERSION) return false;
    if (buf[3] != TELEMETRY_SOURCE_CANSAT) return false;
    if (buf[4] != TELEMETRY_PAYLOAD_LEN) return false;

    uint16_t receivedCrc = static_cast<uint16_t>(buf[TELEMETRY_CRC_OFFSET]) |
        (static_cast<uint16_t>(buf[TELEMETRY_CRC_OFFSET + 1]) << 8);
    uint16_t expectedCrc = crc16Ccitt(buf, TELEMETRY_FRAME_BYTES - 2);
    return receivedCrc == expectedCrc;
}

void resetRadio() {
    pinMode(RFM69_RST, OUTPUT);
    digitalWrite(RFM69_RST, HIGH);
    delay(10);
    digitalWrite(RFM69_RST, LOW);
    delay(10);
}

void setup() {
    Serial.begin(GCS_SERIAL_BAUD);

    resetRadio();

    bool radioOk = false;
    for (int i = 0; i < 3; i++) {
        radioOk = rf69.init();
        if (radioOk) break;
        Serial.printf("GCS:WARN RFM69HCW init attempt %d failed\n", i + 1);
        delay(500);
    }
    if (!radioOk) {
        Serial.println("GCS:FATAL RFM69HCW init failed completely. Halting...");
        pinMode(2, OUTPUT);
        while (1) {
            digitalWrite(2, HIGH);
            delay(250);
            digitalWrite(2, LOW);
            delay(250);
        }
    }

    bool freqOk = false;
    for (int i = 0; i < 3; i++) {
        freqOk = rf69.setFrequency(RFM69_FREQ);
        if (freqOk) break;
        Serial.printf("GCS:WARN RFM69HCW frequency set attempt %d failed\n", i + 1);
        delay(500);
    }
    if (!freqOk) {
        Serial.println("GCS:FATAL RFM69HCW frequency set failed completely. Halting...");
        pinMode(2, OUTPUT);
        while (1) {
            digitalWrite(2, HIGH);
            delay(250);
            digitalWrite(2, LOW);
            delay(250);
        }
    }

    rf69.setTxPower(13, true);
    Serial.println("GCS:READY RFM69HCW 433MHz");
}

void loop() {
    if (!rf69.available()) return;

    uint8_t buf[RH_RF69_MAX_MESSAGE_LEN];
    uint8_t len = sizeof(buf);
    if (!rf69.recv(buf, &len)) return;

    if (!validFrame(buf, len)) {
        Serial.printf("GCS:WARN rejected frame len=%u\n", len);
        return;
    }

    int rssi = rf69.lastRssi();
    if (rssi < -127) rssi = -127;
    if (rssi > 20) rssi = 20;
    buf[TELEMETRY_RSSI_OFFSET] = static_cast<uint8_t>(static_cast<int8_t>(rssi));

    uint16_t crc = crc16Ccitt(buf, TELEMETRY_FRAME_BYTES - 2);
    buf[TELEMETRY_CRC_OFFSET] = static_cast<uint8_t>(crc & 0xFF);
    buf[TELEMETRY_CRC_OFFSET + 1] = static_cast<uint8_t>((crc >> 8) & 0xFF);

    Serial.write(buf, TELEMETRY_FRAME_BYTES);
}
