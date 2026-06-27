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
#include <ctype.h>
#include <string.h>

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

static constexpr size_t MAX_PACKET_LEN = 191;
static constexpr size_t MAX_BODY_LEN = 159;

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

bool isHex4(const char* value) {
  if (!value || strlen(value) != 4) return false;
  for (uint8_t i = 0; i < 4; i++) {
    const char c = value[i];
    const bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    if (!ok) return false;
  }
  return true;
}

int splitCsvFields(char* body, char** fields, int maxFields) {
  int count = 0;
  char* cursor = body;
  while (cursor && count < maxFields) {
    fields[count++] = cursor;
    char* comma = strchr(cursor, ',');
    if (!comma) return count;
    *comma = '\0';
    cursor = comma + 1;
  }
  return count;
}

bool buildCsvBody(char** fields, int count, char* out, size_t outLen) {
  size_t used = 0;
  if (!out || outLen == 0) return false;
  out[0] = '\0';
  for (int i = 0; i < count; i++) {
    const int written = snprintf(out + used, outLen - used, "%s%s", i > 0 ? "," : "", fields[i]);
    if (written < 0 || (size_t)written >= outLen - used) return false;
    used += (size_t)written;
  }
  return true;
}

void trimAscii(char* value) {
  if (!value) return;
  size_t len = strlen(value);
  while (len > 0 && isspace((unsigned char)value[len - 1])) value[--len] = '\0';
  char* start = value;
  while (*start && isspace((unsigned char)*start)) start++;
  if (start != value) memmove(value, start, strlen(start) + 1);
}

bool validateAndRestamp(char* packet, int packetRssi, char* outLine, size_t outLineLen) {
  trimAscii(packet);
  const bool isMxr3 = strncmp(packet, "MXR3:", 5) == 0;
  const bool isMxr2 = strncmp(packet, "MXR2:", 5) == 0;
  if (!isMxr3 && !isMxr2) return false;

  const char* prefix = isMxr3 ? "MXR3:" : "MXR2:";
  char* body = packet + 5;
  char* lastComma = strrchr(body, ',');
  if (!lastComma) return false;

  *lastComma = '\0';
  const char* crcField = lastComma + 1;
  if (!isHex4(crcField)) return false;

  const uint16_t expected = static_cast<uint16_t>(strtoul(crcField, nullptr, 16));
  const uint16_t actual = crc16Ccitt(reinterpret_cast<const uint8_t*>(body), strlen(body));
  if (expected != actual) return false;

  char bodyCopy[MAX_BODY_LEN + 1];
  if (strlen(body) > MAX_BODY_LEN) return false;
  strncpy(bodyCopy, body, sizeof(bodyCopy));
  bodyCopy[sizeof(bodyCopy) - 1] = '\0';

  char* fields[10];
  const int fieldCount = splitCsvFields(bodyCopy, fields, 10);
  if ((isMxr3 && fieldCount != 10) || (isMxr2 && fieldCount != 9)) return false;
  if (strchr(fields[fieldCount - 1], ',') != nullptr) return false;

  const int rssiIndex = isMxr3 ? 8 : 7;
  char rssiField[8];
  snprintf(rssiField, sizeof(rssiField), "%d", packetRssi);
  fields[rssiIndex] = rssiField;

  char restampedBody[MAX_BODY_LEN + 1];
  if (!buildCsvBody(fields, fieldCount, restampedBody, sizeof(restampedBody))) return false;
  const uint16_t restampedCrc = crc16Ccitt(
    reinterpret_cast<const uint8_t*>(restampedBody),
    strlen(restampedBody)
  );

  const int written = snprintf(outLine, outLineLen, "%s%s,%04X", prefix, restampedBody, restampedCrc);
  return written > 0 && (size_t)written < outLineLen;
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
    uint8_t rawPacket[MAX_PACKET_LEN + 1] = {0};
    const int state = radio.readData(rawPacket, MAX_PACKET_LEN);
    if (state == RADIOLIB_ERR_NONE) {
      char packet[MAX_PACKET_LEN + 1];
      char outLine[MAX_PACKET_LEN + 1];
      const int packetRssi = static_cast<int>(round(radio.getRSSI()));
      memcpy(packet, rawPacket, MAX_PACKET_LEN);
      packet[MAX_PACKET_LEN] = '\0';
      if (packet[0] != '\0' && validateAndRestamp(packet, packetRssi, outLine, sizeof(outLine))) {
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
