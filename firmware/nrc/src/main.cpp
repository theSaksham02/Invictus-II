/*
 * INVICTUS II — NRC Rocket Payload Firmware
 * Hardware: ESP-WROOM-32 + BMP280 + NEO-6M + LM75 + SD Card
 *
 * Telemetry link: Bluetooth Serial (SPP)
 *   - ESP-WROOM-32 advertises as "INVICTUS_NRC"
 *   - Ground laptop pairs via Bluetooth and reads the virtual serial port
 *   - The Node.js backend (serial.js) reads NRC2: lines identically
 *
 * ⚠️  Bluetooth Classic range is ~30-100m in open air.
 *     During flight (target altitude 670m), Bluetooth WILL disconnect.
 *     SD card logging is therefore the PRIMARY data source for NRC.
 *     Bluetooth provides pre-launch verification and post-landing recovery.
 *
 * Pin mapping — ESP-WROOM-32 DevKit:
 *   BMP280    → I2C:  SDA=GPIO21, SCL=GPIO22
 *   LM75      → I2C:  SDA=GPIO21, SCL=GPIO22 (shared bus)
 *   NEO-6M    → UART2: RX=GPIO16 (← GPS TX), TX=GPIO17 (→ GPS RX)
 *   SD Card   → VSPI:  MOSI=GPIO23, MISO=GPIO19, SCK=GPIO18, CS=GPIO5
 */

#include <Arduino.h>
#include <BluetoothSerial.h>
#include <Adafruit_BMP280.h>
#include <TinyGPSPlus.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <esp_task_wdt.h>

// ── Pin definitions (ESP-WROOM-32 defaults) ─────────────────────────────────
#define I2C_SDA       21
#define I2C_SCL       22
#define GPS_RX        16    // ESP32 UART2 RX ← NEO-6M TX
#define GPS_TX        17    // ESP32 UART2 TX → NEO-6M RX
#define SD_CS          5    // VSPI chip select for SD card
// VSPI uses default pins: MOSI=23, MISO=19, SCK=18

// ── Telemetry flags (must match backend cansat-hardware.js / parser.js) ─────
#define FLAG_LAUNCHED       0x01
#define FLAG_APOGEE         0x02
#define FLAG_GPS_FIX        0x04
#define FLAG_BARO_OK        0x08
#define FLAG_SD_OK          0x20
#define FLAG_STALE_SENSOR   0x40

// ── Flight detection thresholds ─────────────────────────────────────────────
#define LAUNCH_ALT_DELTA_M    10.0f
#define LAUNCH_CONFIRM_COUNT   3
#define APOGEE_DROP_M          5.0f
#define SENSOR_STALE_MS     3000
#define BASELINE_SAMPLES      20
#define WDT_TIMEOUT_S          5

BluetoothSerial SerialBT;
Adafruit_BMP280 bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(2);   // UART2 for GPS

File logFile;

uint32_t pkt_id = 0;
float baseline_pressure = 1013.25f;
float baseline_pressure_sum = 0.0f;
uint8_t baseline_count = 0;
float baseline_altitude = 0.0f;
float max_altitude = 0.0f;
uint8_t launch_consecutive = 0;

uint32_t last_baro_ms = 0;
uint32_t last_gps_ms = 0;
bool baro_ok = false;
bool sd_ok = false;

// ── CRC16-CCITT (must match backend crc16Ccitt in cansat-hardware.js) ───────
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

// ── LM75 temperature fallback ───────────────────────────────────────────────
#define LM75_ADDR 0x48   // Default I2C address (A0=A1=A2=GND)

float readLM75() {
    Wire.beginTransmission(LM75_ADDR);
    if (Wire.endTransmission() != 0) return NAN;

    Wire.requestFrom((uint8_t)LM75_ADDR, (uint8_t)2);
    if (Wire.available() < 2) return NAN;

    int16_t raw = (Wire.read() << 8) | Wire.read();
    return (float)(raw >> 5) * 0.125f;
}

// ── Setup ───────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    // Watchdog: auto-reboot if loop() hangs for > 5 seconds
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(NULL);

    // Bluetooth Serial — advertise as "INVICTUS_NRC"
    SerialBT.begin("INVICTUS_NRC");
    Serial.println("NRC: Bluetooth started — INVICTUS_NRC");

    // GPS on UART2
    SerialGPS.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

    // I2C bus for BMP280 + LM75
    Wire.begin(I2C_SDA, I2C_SCL);

    // BMP280 barometer
    if (bmp.begin(0x76)) {  // BMP280 default addr with SDO=GND
        bmp.setSampling(
            Adafruit_BMP280::MODE_NORMAL,
            Adafruit_BMP280::SAMPLING_X8,   // temperature oversampling
            Adafruit_BMP280::SAMPLING_X4,   // pressure oversampling
            Adafruit_BMP280::FILTER_X4,     // IIR filter
            Adafruit_BMP280::STANDBY_MS_62_5
        );
        baro_ok = true;
        last_baro_ms = millis();
        Serial.println("NRC: BMP280 OK");
    } else {
        Serial.println("NRC: BMP280 FAILED");
    }

    // SD Card
    if (SD.begin(SD_CS)) {
        logFile = SD.open("/flight.csv", FILE_WRITE);
        if (logFile) {
            logFile.println("pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,rssi_dbm,flags");
            logFile.flush();
            sd_ok = true;
            Serial.println("NRC: SD card OK");
        }
    } else {
        Serial.println("NRC: SD card FAILED");
    }
}

// ── Main Loop ───────────────────────────────────────────────────────────────

void loop() {
    // Continuously feed GPS parser
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    static uint32_t last_tx = 0;
    if (millis() - last_tx >= 1000) {
        last_tx = millis();
        pkt_id++;
        uint32_t now = millis();

        // ── Read barometer ──────────────────────────────────────────────
        float temp = 0, press = 0, alt = 0;
        uint8_t flags = 0;

        if (baro_ok) {
            temp = bmp.readTemperature();
            press = bmp.readPressure() / 100.0f;  // Pa → hPa

            if (isfinite(temp) && isfinite(press) && press > 100.0f) {
                // Averaged baseline calibration (first 20 readings)
                if (baseline_count < BASELINE_SAMPLES) {
                    baseline_pressure_sum += press;
                    baseline_count++;
                    baseline_pressure = baseline_pressure_sum / baseline_count;
                }
                alt = bmp.readAltitude(baseline_pressure);
                if (baseline_count <= BASELINE_SAMPLES) baseline_altitude = alt;
                if (alt > max_altitude) max_altitude = alt;

                last_baro_ms = now;
                flags |= FLAG_BARO_OK;
            }
        } else {
            // BMP280 temperature fallback → LM75
            float lm75_temp = readLM75();
            if (isfinite(lm75_temp)) temp = lm75_temp;
        }

        // ── Read GPS ────────────────────────────────────────────────────
        double lat = 0, lon = 0;
        if (gps.location.isValid() && gps.location.age() < 2000) {
            lat = gps.location.lat();
            lon = gps.location.lng();
            last_gps_ms = now;
            flags |= FLAG_GPS_FIX;
        }

        // ── Launch / Apogee detection (altitude-only, no IMU) ───────────
        if (!(flags & FLAG_LAUNCHED)) {
            bool alt_launch = (alt - baseline_altitude) > LAUNCH_ALT_DELTA_M;
            launch_consecutive = alt_launch ? launch_consecutive + 1 : 0;
            if (launch_consecutive >= LAUNCH_CONFIRM_COUNT) {
                flags |= FLAG_LAUNCHED;
            }
        }
        // Persist launch flag once set
        static bool launched = false;
        if (flags & FLAG_LAUNCHED) launched = true;
        if (launched) flags |= FLAG_LAUNCHED;

        static bool apogee_detected = false;
        if (launched && !apogee_detected) {
            if ((max_altitude - alt) > APOGEE_DROP_M) {
                apogee_detected = true;
            }
        }
        if (apogee_detected) flags |= FLAG_APOGEE;

        // ── Health flags ────────────────────────────────────────────────
        if ((now - last_baro_ms) > SENSOR_STALE_MS) flags |= FLAG_STALE_SENSOR;
        if (sd_ok && logFile) flags |= FLAG_SD_OK;

        // ── RSSI placeholder (Bluetooth doesn't expose RSSI easily) ────
        int rssi = 0;

        // ── Build NRC2 packet string ────────────────────────────────────
        char body[128];
        char buffer[160];
        snprintf(body, sizeof(body), "%u,%lu,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u",
                 pkt_id, now, alt, temp, press, lat, lon, rssi, (unsigned)flags);
        uint16_t crc = crc16Ccitt(
            reinterpret_cast<const uint8_t*>(body), strlen(body));
        snprintf(buffer, sizeof(buffer), "NRC2:%s,%04X", body, crc);

        // ── Transmit over Bluetooth Serial ──────────────────────────────
        SerialBT.println(buffer);

        // ── Also print to USB Serial (debug) ────────────────────────────
        Serial.println(buffer);

        // ── Log to SD card (PRIMARY data source during flight) ──────────
        if (sd_ok && logFile) {
            logFile.printf("%u,%lu,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u\n",
                pkt_id, now, alt, temp, press, lat, lon, rssi, (unsigned)flags);
            if (pkt_id % 5 == 0) logFile.flush();
        }

        // ── Watchdog pet ────────────────────────────────────────────────
        esp_task_wdt_reset();
    }
}
