/*
 * INVICTUS II — Ground Station Receiver
 * Hardware: ESP32 WROOM-32 + RFM69HCW 433 MHz
 *
 * Role:
 *   - Listens for 43-byte CANSAT telemetry packets over RFM69HCW @ 433 MHz
 *   - Validates the 0xA55A sync word at bytes 0-1
 *   - Forwards the raw 43-byte frame over USB Serial (115200 baud) to the laptop
 *   - The Node.js backend (serial.js + CansatFrameParser) reads and fully decodes
 *     the packet including CRC16 validation
 *
 * Why ESP32 WROOM-32 (not a bare USB dongle)?
 *   - Hardware SPI at up to 10 MHz → zero missed packets even at 1 Hz rate
 *   - Built-in USB-CDC via CP2102/CH340 — plug-and-play on all OS
 *   - Can buffer multiple frames if the laptop USB stalls
 *   - RSSI and link quality stamped by the ESP32 before forwarding
 *   - Future: WiFi fallback if USB cable is disconnected mid-flight
 *
 * Pin mapping — ESP32 WROOM-32 DevKit:
 *   RFM69HCW  ←→  ESP32
 *   MOSI          GPIO 23
 *   MISO          GPIO 19
 *   SCK           GPIO 18
 *   NSS (CS)      GPIO  5
 *   DIO0 (IRQ)    GPIO  4
 *   RST           GPIO 14  (optional — tie HIGH if not used)
 *   3.3V          3V3
 *   GND           GND
 */

#include <Arduino.h>
#include <SPI.h>
#include <RH_RF69.h>

// ── Pin definitions ──────────────────────────────────────────────────────────
#define RFM69_CS      5
#define RFM69_IRQ     4
#define RFM69_RST    14
#define RFM69_FREQ  433.0f

// ── Packet framing constants (must match telemetry.h / cansat-hardware.js) ──
#define PACKET_BYTES_V2      43
#define PACKET_BYTES_LEGACY  37
#define SYNC_BYTE_0         0x5A   // little-endian 0xA55A → [0]=0x5A, [1]=0xA5
#define SYNC_BYTE_1         0xA5

// ── Serial baud (must match SERIAL_BAUD_CANSAT in backend/.env) ─────────────
#define GCS_SERIAL_BAUD 115200

RH_RF69 rf69(RFM69_CS, RFM69_IRQ);

// Diagnostic counters (printed every 10 s over Serial debug)
uint32_t rxCount       = 0;
uint32_t rxRejected    = 0;
uint32_t lastDiagMs    = 0;

// ── Helpers ──────────────────────────────────────────────────────────────────

bool initRadio() {
    pinMode(RFM69_RST, OUTPUT);
    digitalWrite(RFM69_RST, HIGH);
    delay(10);
    digitalWrite(RFM69_RST, LOW);
    delay(10);

    if (!rf69.init()) return false;
    rf69.setFrequency(RFM69_FREQ);
    // Match the CanSat transmitter: +17 dBm, high-power mode
    rf69.setTxPower(17, true);
    // Promiscuous mode so we receive all node IDs
    rf69.setPromiscuous(true);
    return true;
}

bool isValidSyncWord(const uint8_t* buf) {
    return buf[0] == SYNC_BYTE_0 && buf[1] == SYNC_BYTE_1;
}

// Forward the raw binary frame over USB Serial to the laptop backend.
// The backend's CansatFrameParser handles re-sync and CRC validation.
void forwardFrame(const uint8_t* buf, uint8_t len) {
    Serial.write(buf, len);
}

// ── Setup / Loop ─────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(GCS_SERIAL_BAUD);
    SPI.begin();

    bool ok = initRadio();

    // Signal to the operator (debug on same Serial — safe because the
    // backend parser only cares about the binary frame bytes; ASCII lines
    // with prefix GCS: are harmless because the framer re-syncs on 0xA55A)
    if (ok) {
        Serial.println("GCS:READY RFM69HCW 433MHz");
    } else {
        Serial.println("GCS:ERROR RFM69HCW init failed");
        // Blink LED to signal hardware fault (GPIO2 = built-in LED on most devkits)
        pinMode(2, OUTPUT);
        while (true) {
            digitalWrite(2, !digitalRead(2));
            delay(200);
        }
    }
}

void loop() {
    if (rf69.available()) {
        uint8_t buf[RH_RF69_MAX_MESSAGE_LEN];
        uint8_t len = sizeof(buf);

        if (rf69.recv(buf, &len)) {
            // Accept 43-byte v2 packets (primary) or 37-byte legacy packets
            bool isV2     = (len == PACKET_BYTES_V2)     && isValidSyncWord(buf);
            bool isLegacy = (len == PACKET_BYTES_LEGACY);

            if (isV2 || isLegacy) {
                // Stamp ground-side RSSI into byte 39 of the v2 packet
                // (same offset as rssi_dbm in TelemetryPacket).
                // This overwrites whatever RSSI the CanSat embedded —
                // ground RSSI is more useful for link quality monitoring.
                if (isV2 && len > 39) {
                    buf[39] = static_cast<uint8_t>(rf69.lastRssi());
                }
                forwardFrame(buf, len);
                rxCount++;
            } else {
                rxRejected++;
                // Bad length — emit a diagnostic so the operator knows
                Serial.print("GCS:WARN bad_len=");
                Serial.println(len);
            }
        }
    }

    // Print link diagnostics every 10 seconds (non-blocking)
    uint32_t now = millis();
    if (now - lastDiagMs >= 10000) {
        lastDiagMs = now;
        Serial.print("GCS:DIAG rx=");
        Serial.print(rxCount);
        Serial.print(" rejected=");
        Serial.print(rxRejected);
        Serial.print(" rssi=");
        Serial.println(rf69.lastRssi());
    }
}
