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
#define LORA_CR         7
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
  const bool isMxr3 = packet.startsWith("MXR3:");
  const bool isMxr2 = packet.startsWith("MXR2:");
  if (!isMxr3 && !isMxr2) return false;

  const String prefix = isMxr3 ? "MXR3:" : "MXR2:";
  const String bodyWithCrc = packet.substring(5);
  const int lastComma = bodyWithCrc.lastIndexOf(',');
  if (lastComma < 0) return false;

  const String body = bodyWithCrc.substring(0, lastComma);
  const String crcField = bodyWithCrc.substring(lastComma + 1);
  if (!isHex4(crcField)) return false;

  const uint16_t expected = static_cast<uint16_t>(strtoul(crcField.c_str(), nullptr, 16));
  const uint16_t actual = crc16Ccitt(reinterpret_cast<const uint8_t*>(body.c_str()), body.length());
  if (expected != actual) return false;

  String fields[10];
  const int fieldCount = splitCsvFields(body, fields, 10);
  if ((isMxr3 && fieldCount != 10) || (isMxr2 && fieldCount != 9)) return false;

  const int rssiIndex = isMxr3 ? 8 : 7;
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
  const int state = radio.begin(LORA_FREQ, LORA_BW, LORA_SF, LORA_CR, LORA_SW, LORA_POWER, LORA_PREAMBLE);
  if (state != RADIOLIB_ERR_NONE) {
    Serial.printf("[MXR-GS] SX1262 init failed: %d\n", state);
    while (true) delay(1000);
  }

  Serial.println("[MXR-GS] SX1262 OK @ 868 MHz, forwarding CRC-valid MXR2/MXR3 packets");
}

void loop() {
  String packet;
  const int state = radio.receive(packet);
  if (state == RADIOLIB_ERR_NONE) {
    String outLine;
    const int packetRssi = static_cast<int>(round(radio.getRSSI()));
    if (validateAndRestamp(packet, packetRssi, outLine)) {
      Serial.println(outLine);
    } else {
      Serial.println("[MXR-GS] rejected malformed or CRC-invalid packet");
    }
  } else if (state != RADIOLIB_ERR_RX_TIMEOUT) {
    Serial.printf("[MXR-GS] receive error: %d\n", state);
  }
}
