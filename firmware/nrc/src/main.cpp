#include <Arduino.h>
#include <LoRa.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>
#include <Wire.h>

// PIN DEFINITIONS (Heltec LoRa v3)
#define SCK     5
#define MISO    6
#define MOSI    7
#define SS      8
#define RST     12
#define DIO0    14
#define BAND    868E6
#define I2C_SDA 1
#define I2C_SCL 2
#define GPS_RX  46 // LoRa GPIO46 connected to NEO-6M TX per PAYLOAD_CIRCUIT.md
#define GPS_TX  45 // LoRa GPIO45 connected to NEO-6M RX per PAYLOAD_CIRCUIT.md

#define FLAG_GPS_FIX 0x04
#define FLAG_BARO_OK 0x08
#define FLAG_STALE_SENSOR 0x40

Adafruit_BMP3XX bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(1); // Use UART1 for GPS

uint32_t pkt_id = 0;
float baseline_pressure = 1013.25;
uint32_t last_baro_ms = 0;
uint32_t last_gps_ms = 0;
bool baro_ok = false;

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
    Serial.begin(115200);
    SerialGPS.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
    Wire.begin(I2C_SDA, I2C_SCL);

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
        baro_ok = true;
        last_baro_ms = millis();
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

        uint32_t now = millis();
        float temp = 0, press = 0, alt = 0;
        uint8_t flags = 0;
        if (baro_ok && bmp.performReading()) {
            temp = bmp.temperature;
            press = bmp.pressure / 100.0;
            if (pkt_id <= 5) baseline_pressure = press;
            alt = bmp.readAltitude(baseline_pressure);
            last_baro_ms = now;
            flags |= FLAG_BARO_OK;
        }

        double lat = 0;
        double lon = 0;
        if (gps.location.isValid() && gps.location.age() < 2000) {
            lat = gps.location.lat();
            lon = gps.location.lng();
            last_gps_ms = now;
            flags |= FLAG_GPS_FIX;
        }
        if ((now - last_baro_ms) > 3000) flags |= FLAG_STALE_SENSOR;
        int rssi = LoRa.packetRssi();

        // Format: NRC2:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_hex>
        char buffer[128];
        char body[112];
        snprintf(body, sizeof(body), "%u,%lu,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u",
                 pkt_id, now, alt, temp, press, lat, lon, rssi, flags);
        uint16_t crc = crc16Ccitt(reinterpret_cast<const uint8_t*>(body), strlen(body));
        snprintf(buffer, sizeof(buffer), "NRC2:%s,%04X", body, crc);

        LoRa.beginPacket();
        LoRa.print(buffer);
        LoRa.endPacket();

        Serial.println(buffer);
    }
}
