#include <Arduino.h>
#include <LoRa.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>

// PIN DEFINITIONS (Heltec LoRa v3)
#define SCK     5
#define MISO    6
#define MOSI    7
#define SS      8
#define RST     12
#define DIO0    14
#define BAND    868E6

Adafruit_BMP3XX bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(1); // Use UART1 for GPS

uint32_t pkt_id = 0;
float baseline_pressure = 1013.25;

void setup() {
    Serial.begin(115200);
    SerialGPS.begin(9600, SERIAL_8N1, 43, 44); // RX, TX pins for Heltec v3

    // Initialize LoRa
    LoRa.setPins(SS, RST, DIO0);
    if (!LoRa.begin(BAND)) {
        Serial.println("LoRa init failed!");
    }

    // Initialize BMP388
    if (bmp.begin_I2C()) {
        bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
        bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
        bmp.setOutputDataRate(BMP3_ODR_50_HZ);
    }
}

void loop() {
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    static uint32_t last_tx = 0;
    if (millis() - last_tx >= 1000) {
        last_tx = millis();
        pkt_id++;

        float temp = 0, press = 0, alt = 0;
        if (bmp.performReading()) {
            temp = bmp.temperature;
            press = bmp.pressure / 100.0;
            if (pkt_id <= 5) baseline_pressure = press;
            alt = bmp.readAltitude(baseline_pressure);
        }

        double lat = gps.location.isValid() ? gps.location.lat() : 0;
        double lon = gps.location.isValid() ? gps.location.lng() : 0;
        int rssi = LoRa.packetRssi();

        // Format: NRC:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>
        char buffer[128];
        snprintf(buffer, sizeof(buffer), "NRC:%u,%lu,%.2f,%.2f,%.2f,%.6f,%.6f,%d",
                 pkt_id, millis(), alt, temp, press, lat, lon, rssi);

        LoRa.beginPacket();
        LoRa.print(buffer);
        LoRa.endPacket();

        Serial.println(buffer);
    }
}
