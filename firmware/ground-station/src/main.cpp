/*
 * INVICTUS II - CanSat Ground Station Receiver
 * Target: ESP32 WROOM-32
 * Radio: RFM69HCW @ 433.0 MHz
 * Wiring source: backend/CANSAT_GROUNDSTATION.md
 *
 * Role:
 *   - Receives 43-byte CANSAT v2 and 60-byte CANSAT v3 binary telemetry frames over RFM69HCW
 *   - Validates sync/version/source/payload length and CRC16-CCITT
 *   - Stamps ground-side RSSI into the protocol-specific RSSI byte
 *   - Recomputes CRC and forwards the raw frame over USB Serial
 */

#include <Arduino.h>
#include <SPI.h>
#include <RH_RF69.h>

// ESP32 WROOM-32 pins from backend/CANSAT_GROUNDSTATION.md:
// D5 -> NSS, D2 -> DIO0, D14 -> RESET, D18/D19/D23 -> SCK/MISO/MOSI.
#define RFM69_CS      5
#define RFM69_IRQ     2
#define RFM69_RST    14
#define RFM69_SCK    18
#define RFM69_MISO   19
#define RFM69_MOSI   23
#define RFM69_FREQ  433.0

#define GCS_SERIAL_BAUD 115200

#define TELEMETRY_SYNC 0xA55A
#define TELEMETRY_VERSION_V2 2
#define TELEMETRY_VERSION_V3 3
#define TELEMETRY_SOURCE_CANSAT 1
#define TELEMETRY_PAYLOAD_LEN_V2 36
#define TELEMETRY_PAYLOAD_LEN_V3 53
#define TELEMETRY_FRAME_BYTES_V2 43
#define TELEMETRY_FRAME_BYTES_V3 60
#define TELEMETRY_RSSI_OFFSET_V2 39
#define TELEMETRY_RSSI_OFFSET_V3 56
#define TELEMETRY_CRC_OFFSET_V2 41
#define TELEMETRY_CRC_OFFSET_V3 58

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

struct FrameMeta {
    uint8_t len;
    uint8_t version;
    uint8_t payloadLen;
    uint8_t rssiOffset;
    uint8_t crcOffset;
};

bool frameMetaForLength(uint8_t len, FrameMeta* meta) {
    if (len == TELEMETRY_FRAME_BYTES_V2) {
        *meta = {TELEMETRY_FRAME_BYTES_V2, TELEMETRY_VERSION_V2, TELEMETRY_PAYLOAD_LEN_V2, TELEMETRY_RSSI_OFFSET_V2, TELEMETRY_CRC_OFFSET_V2};
        return true;
    }
    if (len == TELEMETRY_FRAME_BYTES_V3) {
        *meta = {TELEMETRY_FRAME_BYTES_V3, TELEMETRY_VERSION_V3, TELEMETRY_PAYLOAD_LEN_V3, TELEMETRY_RSSI_OFFSET_V3, TELEMETRY_CRC_OFFSET_V3};
        return true;
    }
    return false;
}

bool validFrame(const uint8_t* buf, uint8_t len, FrameMeta* meta) {
    if (!frameMetaForLength(len, meta)) return false;
    uint16_t sync = static_cast<uint16_t>(buf[0]) | (static_cast<uint16_t>(buf[1]) << 8);
    if (sync != TELEMETRY_SYNC) return false;
    if (buf[2] != meta->version) return false;
    if (buf[3] != TELEMETRY_SOURCE_CANSAT) return false;
    if (buf[4] != meta->payloadLen) return false;

    uint16_t receivedCrc = static_cast<uint16_t>(buf[meta->crcOffset]) |
        (static_cast<uint16_t>(buf[meta->crcOffset + 1]) << 8);
    uint16_t expectedCrc = crc16Ccitt(buf, meta->len - 2);
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
    delay(100);

    pinMode(RFM69_CS, OUTPUT);
    digitalWrite(RFM69_CS, HIGH);
    pinMode(RFM69_IRQ, INPUT);
    SPI.begin(RFM69_SCK, RFM69_MISO, RFM69_MOSI, RFM69_CS);
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
        while (1) {
            delay(1000);
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
        while (1) {
            delay(1000);
        }
    }

    Serial.println("GCS:READY RFM69HCW 433MHz RX");
}

void loop() {
    if (!rf69.available()) return;

    uint8_t buf[RH_RF69_MAX_MESSAGE_LEN];
    uint8_t len = sizeof(buf);
    if (!rf69.recv(buf, &len)) return;

    FrameMeta meta = {};
    if (!validFrame(buf, len, &meta)) {
        Serial.printf("GCS:WARN rejected frame len=%u\n", len);
        return;
    }

    int rssi = rf69.lastRssi();
    if (rssi < -127) rssi = -127;
    if (rssi > 20) rssi = 20;
    buf[meta.rssiOffset] = static_cast<uint8_t>(static_cast<int8_t>(rssi));

    uint16_t crc = crc16Ccitt(buf, meta.len - 2);
    buf[meta.crcOffset] = static_cast<uint8_t>(crc & 0xFF);
    buf[meta.crcOffset + 1] = static_cast<uint8_t>((crc >> 8) & 0xFF);

    Serial.write(buf, meta.len);
}
