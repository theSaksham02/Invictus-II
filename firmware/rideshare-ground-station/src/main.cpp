/*
 * INVICTUS II - Mach-X Rideshare LoRa Ground Receiver
 *
 * Hardware: Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262)
 * Purpose : Receive MXR2/MXR3 LoRa packets from the rideshare flight payload,
 *           validate CRC16-CCITT, stamp ground-side RSSI, and forward the
 *           corrected line over USB Serial for backend/rideshare-serial.js.
 */

#include <Arduino.h>
#include <RadioLib.h>
#include <SPI.h>

#define LORA_NSS        8
#define LORA_DIO1       14
#define LORA_RST        12
#define LORA_BUSY       13
#define LORA_SCK        9
#define LORA_MISO       11
#define LORA_MOSI       10

#define LORA_FREQ       868.0
#define LORA_BW         125.0
#define LORA_SF         9
#define LORA_CR         5
#define LORA_SW         0x12
#define LORA_POWER      14
#define LORA_PREAMBLE   8

SPIClass loraSPI(FSPI);
SX1262 radio = new Module(LORA_NSS, LORA_DIO1, LORA_RST, LORA_BUSY, loraSPI);

uint16_t crc16Ccitt(const uint8_t* data, size_t len) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= static_cast<uint16_t>(data[i]) << 8;
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000)
        ? static_cast<uint16_t>((crc << 1) ^ 0x1021)
        : static_cast<uint16_t>(crc << 1);
    }
  }
  return crc;
}

bool isHex4(const String& value) {
  if (value.length() != 4) return false;
  for (uint8_t i = 0; i < 4; i++) {
    const char c = value.charAt(i);
    const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!ok) return false;
  }
  return true;
}

int splitCsvFields(const String& body, String* fields, int maxFields) {
  int count = 0;
  int start = 0;
  while (count < maxFields) {
    const int comma = body.indexOf(',', start);
    if (comma < 0) {
      fields[count++] = body.substring(start);
      return count;
    }
    fields[count++] = body.substring(start, comma);
    start = comma + 1;
  }
  return count;
}

String joinCsvFields(String* fields, int count) {
  String out;
  for (int i = 0; i < count; i++) {
    if (i > 0) out += ",";
    out += fields[i];
  }
  return out;
}

bool validateAndRestamp(String packet, int packetRssi, String& outLine) {
  packet.trim();
  const bool isMxr4 = packet.startsWith("MXR4:");
  const bool isMxr3 = packet.startsWith("MXR3:");
  const bool isMxr2 = packet.startsWith("MXR2:");
  if (!isMxr4 && !isMxr3 && !isMxr2) return false;

  const String prefix = isMxr4 ? "MXR4:" : isMxr3 ? "MXR3:" : "MXR2:";
  const String bodyWithCrc = packet.substring(5);
  const int lastComma = bodyWithCrc.lastIndexOf(',');
  if (lastComma < 0) return false;

  const String body = bodyWithCrc.substring(0, lastComma);
  const String crcField = bodyWithCrc.substring(lastComma + 1);
  if (!isHex4(crcField)) return false;

  const uint16_t expected = static_cast<uint16_t>(strtoul(crcField.c_str(), nullptr, 16));
  const uint16_t actual = crc16Ccitt(reinterpret_cast<const uint8_t*>(body.c_str()), body.length());
  if (expected != actual) return false;

  const int maxFields = isMxr4 ? 12 : isMxr3 ? 10 : 9;
  String fields[12];
  const int fieldCount = splitCsvFields(body, fields, 12);
  if (fieldCount != maxFields) return false;

  // RSSI field index: MXR4 has accel_z(8),gyro_x(9),rssi(10) ; MXR3 rssi(8) ; MXR2 rssi(7)
  const int rssiIndex = isMxr4 ? 10 : isMxr3 ? 8 : 7;
  fields[rssiIndex] = String(packetRssi);

  const String restampedBody = joinCsvFields(fields, fieldCount);
  const uint16_t restampedCrc = crc16Ccitt(
    reinterpret_cast<const uint8_t*>(restampedBody.c_str()),
    restampedBody.length()
  );

  char crcHex[5];
  snprintf(crcHex, sizeof(crcHex), "%04X", restampedCrc);
  outLine = prefix + restampedBody + "," + String(crcHex);
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("[MXR-GS] Booting rideshare LoRa ground receiver");

  loraSPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  // Initialize LoRa radio with default parameters, then configure individually
  int state = radio.begin();
  bool gs_lora_ok = false;
  if (state == RADIOLIB_ERR_NONE) {
    state = radio.setFrequency(LORA_FREQ);
    if (state == RADIOLIB_ERR_NONE) state = radio.setBandwidth(LORA_BW);
    if (state == RADIOLIB_ERR_NONE) state = radio.setSpreadingFactor(LORA_SF);
    if (state == RADIOLIB_ERR_NONE) state = radio.setCodingRate(LORA_CR);
    if (state == RADIOLIB_ERR_NONE) state = radio.setSyncWord(LORA_SW);
    if (state == RADIOLIB_ERR_NONE) state = radio.setOutputPower(LORA_POWER);
    if (state == RADIOLIB_ERR_NONE) state = radio.setPreambleLength(LORA_PREAMBLE);
    if (state == RADIOLIB_ERR_NONE) {
      radio.setDio2AsRfSwitch(true);
      state = radio.startReceive();
      if (state == RADIOLIB_ERR_NONE) {
        gs_lora_ok = true;
        Serial.println("[MXR-GS] SX1262 OK @ 868 MHz, forwarding CRC-valid MXR2/MXR3 packets (RF Switch ON)");
      }
    }
  }
  if (!gs_lora_ok) {
    Serial.printf("[MXR-GS] SX1262 init failed: %d\n", state);
    while (true) delay(1000);
  }
}

void loop() {
  if (digitalRead(LORA_DIO1) == HIGH) {
    String packet;
    const int state = radio.readData(packet);
    if (state == RADIOLIB_ERR_NONE) {
      String outLine;
      const int packetRssi = static_cast<int>(round(radio.getRSSI()));
      if (validateAndRestamp(packet, packetRssi, outLine)) {
        Serial.println(outLine);
      } else {
        Serial.println("[MXR-GS] rejected malformed or CRC-invalid packet");
      }
    } else {
      Serial.printf("[MXR-GS] receive error: %d\n", state);
    }
    // Restart continuous receive mode
    radio.startReceive();
  }
}
