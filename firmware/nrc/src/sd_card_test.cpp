/*
 * Minimal SD card module test for the Heltec WiFi LoRa 32 V3 NRC payload.
 *
 * Upload with:
 *   pio run -e sd_card_test -t upload --upload-port /dev/cu.usbserial-3
 *   pio device monitor -p /dev/cu.usbserial-3 -b 115200
 */

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>

#define SD_CS    38
#define SD_SCK   39
#define SD_MOSI  41
#define SD_MISO  42

static const uint32_t kSpeeds[] = {400000, 1000000, 4000000};

void printCardType(uint8_t cardType) {
  switch (cardType) {
    case CARD_MMC:
      Serial.println("[SD-TEST] Card type: MMC");
      break;
    case CARD_SD:
      Serial.println("[SD-TEST] Card type: SDSC");
      break;
    case CARD_SDHC:
      Serial.println("[SD-TEST] Card type: SDHC/SDXC");
      break;
    default:
      Serial.println("[SD-TEST] Card type: UNKNOWN");
      break;
  }
}

bool writeReadTest() {
  const char *path = "/sd_module_test.txt";
  const char *payload = "sd module write/read test ok\n";

  if (SD.exists(path)) {
    SD.remove(path);
  }

  File out = SD.open(path, FILE_WRITE);
  if (!out) {
    Serial.println("[SD-TEST] FAIL: could not open test file for write");
    return false;
  }

  size_t written = out.print(payload);
  out.flush();
  out.close();

  if (written != strlen(payload)) {
    Serial.printf("[SD-TEST] FAIL: short write %u of %u bytes\n",
                  (unsigned)written, (unsigned)strlen(payload));
    return false;
  }

  File in = SD.open(path, FILE_READ);
  if (!in) {
    Serial.println("[SD-TEST] FAIL: could not reopen test file");
    return false;
  }

  String readBack = in.readString();
  in.close();

  if (readBack != payload) {
    Serial.println("[SD-TEST] FAIL: readback mismatch");
    Serial.print("[SD-TEST] Read: ");
    Serial.println(readBack);
    return false;
  }

  Serial.println("[SD-TEST] PASS: write/read verified at /sd_module_test.txt");
  return true;
}

bool tryMount(uint32_t speed) {
  Serial.printf("[SD-TEST] Trying SD.begin at %lu Hz...\n", (unsigned long)speed);
  if (!SD.begin(SD_CS, SPI, speed)) {
    Serial.println("[SD-TEST] Mount failed");
    return false;
  }

  uint8_t cardType = SD.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[SD-TEST] FAIL: no card detected after mount");
    SD.end();
    return false;
  }

  printCardType(cardType);
  Serial.printf("[SD-TEST] Card size: %llu MB\n",
                (unsigned long long)(SD.cardSize() / (1024ULL * 1024ULL)));

  bool ok = writeReadTest();
  SD.end();
  return ok;
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("[SD-TEST] Heltec NRC SD module test starting");
  Serial.println("[SD-TEST] Pins: CS=38 SCK=39 MOSI=41 MISO=42");
  Serial.println("[SD-TEST] Power SD module from 5V/VBUS, with common GND.");

  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);
  pinMode(SD_MISO, INPUT_PULLUP);
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI);

  for (uint8_t i = 0; i < sizeof(kSpeeds) / sizeof(kSpeeds[0]); i++) {
    if (tryMount(kSpeeds[i])) {
      Serial.println("[SD-TEST] FINAL RESULT: PASS");
      return;
    }
    delay(300);
  }

  Serial.println("[SD-TEST] FINAL RESULT: FAIL");
  Serial.println("[SD-TEST] If errors mention CMD0, the card/module is not responding on SPI.");
  Serial.println("[SD-TEST] Recheck FAT32 format, CS/SCK/MOSI/MISO order, 5V/VBUS, and GND.");
}

void loop() {
  delay(1000);
}
