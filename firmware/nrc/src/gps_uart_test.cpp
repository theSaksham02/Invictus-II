/*
 * Minimal GPS UART test for the Heltec WiFi LoRa 32 V3 NRC payload.
 *
 * Upload with:
 *   pio run -e gps_uart_test -t upload --upload-port /dev/cu.usbserial-0001
 *   pio device monitor -p /dev/cu.usbserial-0001 -b 115200
 */

#include <Arduino.h>

HardwareSerial GPS(1);

static const int kRxPins[] = {6, 7};
static const uint32_t kBauds[] = {9600, 38400, 57600, 115200, 4800};

void probeGps(int rxPin, uint32_t baud) {
  GPS.end();
  GPS.setRxBufferSize(2048);
  GPS.begin(baud, SERIAL_8N1, rxPin, -1);

  uint32_t started = millis();
  uint32_t chars = 0;
  uint32_t dollars = 0;
  char sample[121];
  size_t sampleLen = 0;

  while (millis() - started < 2500) {
    while (GPS.available()) {
      char c = GPS.read();
      chars++;
      if (c == '$') {
        dollars++;
      }
      if (sampleLen < sizeof(sample) - 1) {
        sample[sampleLen++] = (c >= 32 && c <= 126) ? c : '.';
      }
    }
  }

  sample[sampleLen] = '\0';
  Serial.printf("[GPS-TEST] RX=GPIO%d baud=%lu chars=%lu dollars=%lu\n",
                rxPin, (unsigned long)baud, (unsigned long)chars, (unsigned long)dollars);
  if (sampleLen > 0) {
    Serial.printf("[GPS-TEST] sample: %s\n", sample);
  }
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("[GPS-TEST] Heltec NRC raw GPS UART test starting");
  Serial.println("[GPS-TEST] Connect GPS GND to Heltec GND and GPS TXD to the tested RX GPIO.");
  Serial.println("[GPS-TEST] This test does not need satellite lock; it only checks serial bytes.");

  for (size_t pin = 0; pin < sizeof(kRxPins) / sizeof(kRxPins[0]); pin++) {
    for (size_t baud = 0; baud < sizeof(kBauds) / sizeof(kBauds[0]); baud++) {
      probeGps(kRxPins[pin], kBauds[baud]);
      delay(250);
    }
  }

  Serial.println("[GPS-TEST] Scan complete. Any line with chars > 0 means the GPS UART is being received.");
}

void loop() {
  delay(1000);
}
