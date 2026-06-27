/*
 * INVICTUS II — Mach-X Rideshare Payload Firmware
 * ──────────────────────────────────────────
 * Hardware : Heltec WiFi LoRa 32 V3 (ESP32-S3 + SX1262 LoRa + SSD1306 OLED)
 * Sensors  : BMP280 (I2C), NEO-6M GPS (UART), LM75 (I2C), SD Card (SPI)
 * Camera   : ESP32-CAM (standalone on 5V_BUS, records to its own SD card)
 * Radio    : SX1262 LoRa @ 868 MHz (built into Heltec board, live telemetry)
 * Display  : SSD1306 0.96" OLED (built into Heltec board)
 *
 * Live telemetry contract (MXR3 — v3 with CRC16):
 *   MXR3:<pkt_id>,<ts_ms>,<alt_m>,<temp_c>,<lm75_temp_c>,<press_hpa>,<lat>,<lon>,<rssi>,<flags>,<CRC16_HEX>\n
 *
 * Pin mapping — per physical circuit (verified 2026-05-30):
 *   BMP280  → I2C:  SDA=GPIO1,  SCL=GPIO2   (addr 0x76, SDO→GND)
 *   LM75    → I2C:  SDA=GPIO1,  SCL=GPIO2   (addr 0x48, shared bus)
 *   NEO-6M  → UART: RX=GPIO6  (ESP TX→GPS RX), TX=GPIO7  (GPS TX→ESP RX)
 *   SD Card → SPI:  CS=GPIO38, SCK=GPIO39, MOSI=GPIO41, MISO=GPIO42
 *   LoRa    → (internal) NSS=8, DIO1=14, RST=12, BUSY=13, SCK=9, MISO=11, MOSI=10
 *   OLED    → (internal) SDA=17, SCL=18, RST=21
 */

#include <Arduino.h>
#include <RadioLib.h>
#include <Adafruit_BMP280.h>
#include <TinyGPSPlus.h>
#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <U8g2lib.h>
#include <esp_task_wdt.h>

#ifndef ENABLE_RIDESHARE_LIVE
  #ifdef ENABLE_NRC_LIVE
    #define ENABLE_RIDESHARE_LIVE ENABLE_NRC_LIVE
  #else
    #define ENABLE_RIDESHARE_LIVE 1
  #endif
#endif

// ═══════════════════════════════════════════════════════════════════════════
//  HARDWARE CONFIGURATION OPTIONS
// ═══════════════════════════════════════════════════════════════════════════
#define HAS_SD_CARD     1   // Set to 1 if SD card module is physically connected
#define HAS_LM75        1   // Set to 1 if LM75 temperature sensor is physically connected

// ═══════════════════════════════════════════════════════════════════════════
//  PIN DEFINITIONS — Heltec WiFi LoRa 32 V3 (verified against circuit)
// ═══════════════════════════════════════════════════════════════════════════

// I2C bus for BMP280 + LM75
#define I2C_SDA         1
#define I2C_SCL         2

// GPS on UART (ESP32-S3 UART1)
// NEO-6M TX → GPIO7 (ESP reads FROM GPS on this pin)
// NEO-6M RX → GPIO6 (ESP writes TO GPS on this pin)
#define GPS_RX_PIN      7   // ESP32 receives GPS data on this GPIO
#define GPS_TX_PIN      6   // ESP32 transmits to GPS on this GPIO

// SD Card on SPI
#define SD_CS           38
#define SD_SCK          39
#define SD_MOSI         41
#define SD_MISO         42

// LoRa SX1262 (internal to Heltec V3 board — do NOT change)
#define LORA_NSS        8
#define LORA_DIO1       14
#define LORA_RST        12
#define LORA_BUSY       13
#define LORA_SCK        9
#define LORA_MISO       11
#define LORA_MOSI       10

// OLED SSD1306 (internal to Heltec V3 board)
#define OLED_SDA        17
#define OLED_SCL        18
#define OLED_RST        21
#define VEXT_PIN        36   // Controls 3.3V power to OLED + external sensors

// LoRa frequency — UK Ofcom IR2030 compliant
#define LORA_FREQ       868.0  // MHz
#define LORA_BW         125.0  // kHz
#define LORA_SF         9      // Spreading factor (range vs speed tradeoff)
#define LORA_CR         5      // Coding rate 4/5 (aligned with reference guide)
#define LORA_SW         0x12   // Sync word (private network)
#define LORA_POWER      14     // dBm (max allowed under ETSI)
#define LORA_PREAMBLE   8

// ═══════════════════════════════════════════════════════════════════════════
//  TELEMETRY FLAGS — must match backend parser.js / cansat-hardware.js
// ═══════════════════════════════════════════════════════════════════════════
#define FLAG_LAUNCHED       0x01
#define FLAG_APOGEE         0x02
#define FLAG_GPS_FIX        0x04
#define FLAG_BARO_OK        0x08
#define FLAG_SD_OK          0x20
#define FLAG_STALE_SENSOR   0x40

// Flight detection thresholds
#define LAUNCH_ALT_DELTA_M    10.0f    // Must gain 10m above baseline
#define LAUNCH_CONFIRM_COUNT   3       // For 3 consecutive readings
#define APOGEE_DROP_M          5.0f    // 5m drop from max = apogee
#define SENSOR_STALE_MS     3000       // 3s without baro reading = stale
#define BASELINE_SAMPLES      20       // Average first 20 readings for baseline
#define WDT_TIMEOUT_S          5       // Watchdog timeout in seconds
#define LOG_FLUSH_EVERY        5       // Flush SD log every N samples

// ═══════════════════════════════════════════════════════════════════════════
//  GLOBAL OBJECTS
// ═══════════════════════════════════════════════════════════════════════════

// LoRa radio — SX1262 via RadioLib
SPIClass loraSPI(FSPI);
SX1262 radio = new Module(LORA_NSS, LORA_DIO1, LORA_RST, LORA_BUSY, loraSPI);

// OLED display — U8g2, HW I2C on internal OLED bus
U8G2_SSD1306_128X64_NONAME_F_HW_I2C display(U8G2_R0, OLED_RST, OLED_SCL, OLED_SDA);

// Sensors
TwoWire sensorI2C(1);            // Separate I2C controller for BMP280 + LM75; OLED uses the default controller.
Adafruit_BMP280 bmp(&sensorI2C);
TinyGPSPlus gps;
HardwareSerial SerialGPS(1);     // UART1 for GPS

// SD Card — custom SPI bus
SPIClass sdSPI(HSPI);
File logFile;

// ═══════════════════════════════════════════════════════════════════════════
//  STATE VARIABLES
// ═══════════════════════════════════════════════════════════════════════════
uint32_t pkt_id = 0;
float baseline_pressure = 1013.25f;
float baseline_pressure_sum = 0.0f;
uint8_t baseline_count = 0;
float baseline_altitude = 0.0f;
float max_altitude = 0.0f;
uint8_t launch_consecutive = 0;
bool launched = false;
bool apogee_detected = false;
float apogee_altitude_m = NAN;

uint32_t last_baro_ms = 0;
uint32_t last_gps_ms = 0;
bool baro_ok = false;
bool sd_ok = false;
bool lora_ok = false;

int16_t last_rssi = 0;   // Updated after each LoRa TX
char log_filename[24] = "/mxr_flight_001.csv";

// ═══════════════════════════════════════════════════════════════════════════
//  CRC16-CCITT — must match backend cansat-hardware.js crc16Ccitt()
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
//  LM75 TEMPERATURE FALLBACK & I2C SCANNING
// ═══════════════════════════════════════════════════════════════════════════
uint8_t lm75_actual_addr = 0x48;

float readLM75() {
    sensorI2C.beginTransmission(lm75_actual_addr);
    if (sensorI2C.endTransmission() != 0) return NAN;
    sensorI2C.requestFrom((uint8_t)lm75_actual_addr, (uint8_t)2);
    if (sensorI2C.available() < 2) return NAN;
    int16_t raw = (sensorI2C.read() << 8) | sensorI2C.read();
    return (float)(raw >> 5) * 0.125f;
}

void scanI2CBus(TwoWire &i2c) {
    Serial.println("[MXR] Scanning I2C bus...");
    int nDevices = 0;
    for (byte address = 1; address < 127; address++) {
        i2c.beginTransmission(address);
        byte error = i2c.endTransmission();
        if (error == 0) {
            Serial.printf("[MXR] I2C device found at address 0x%02X\n", address);
            nDevices++;
        }
    }
    if (nDevices == 0) {
        Serial.println("[MXR] No I2C devices found");
    }
}

bool openFreshLogFile() {
    for (uint16_t index = 1; index <= 999; index++) {
        snprintf(log_filename, sizeof(log_filename), "/mxr_flight_%03u.csv", (unsigned)index);
        if (SD.exists(log_filename)) continue;

        logFile = SD.open(log_filename, FILE_WRITE);
        if (!logFile) return false;

        logFile.println(
            "pkt_id,timestamp_ms,altitude_m,altitude_ft,temp_c,lm75_temp_c,pressure_hpa,"
            "lat,lon,gps_fix,flags,bmp_ok,sd_ok,max_altitude_m,max_altitude_ft,"
            "apogee_detected,apogee_altitude_m,apogee_altitude_ft"
        );
        logFile.flush();
        return true;
    }
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
//  OLED DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════════════════
void displayStatus(float alt, float maxAlt, float apogeeAlt, uint8_t flags, uint32_t pktCount) {
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);

    if (flags & FLAG_APOGEE) {
        display.drawStr(0, 10, "MXR APOGEE");
        display.setFont(u8g2_font_logisoso22_tf);
        char apogeeLine[24];
        float shownApogee = isfinite(apogeeAlt) ? apogeeAlt : maxAlt;
        snprintf(apogeeLine, sizeof(apogeeLine), "%.0f ft", shownApogee * 3.28084f);
        display.drawStr(0, 39, apogeeLine);

        display.setFont(u8g2_font_6x10_tf);
        char statusLine[32];
        snprintf(statusLine, sizeof(statusLine), "P:%lu %s%s",
            (unsigned long)pktCount,
            (flags & FLAG_BARO_OK) ? "BAR " : "--- ",
            (flags & FLAG_SD_OK) ? "SD" : "--");
        display.drawStr(0, 58, statusLine);
        display.sendBuffer();
        return;
    }

    // Line 1: Mission phase
    display.drawStr(0, 10, "MACH-X RIDESHARE");

    // Line 2: Current altitude in feet
    char line[32];
    snprintf(line, sizeof(line), "ALT: %.1f ft", alt * 3.28084f);
    display.drawStr(0, 24, line);

    // Line 3: Max altitude (apogee) in feet — THIS is what judges read
    display.setFont(u8g2_font_9x18B_tf);
    snprintf(line, sizeof(line), "MAX:%.0fft", maxAlt * 3.28084f);
    display.drawStr(0, 44, line);

    // Line 4: Status flags
    display.setFont(u8g2_font_6x10_tf);
    snprintf(line, sizeof(line), "P:%lu %s%s%s", pktCount,
        (flags & FLAG_GPS_FIX)  ? "GPS " : "--- ",
        (flags & FLAG_BARO_OK)  ? "BAR " : "--- ",
        (flags & FLAG_SD_OK)    ? "SD"   : "--");
    display.drawStr(0, 58, line);

    display.sendBuffer();
}

void displayBootStep(const char* line1, const char* line2 = "") {
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "MXR BOOTING...");
    display.drawStr(0, 28, line1);
    if (line2 && line2[0] != '\0') display.drawStr(0, 42, line2);
    display.sendBuffer();
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════════════════
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("[MXR] Booting...");

    // ── Power on OLED + Vext rail ────────────────────────────────────
    pinMode(VEXT_PIN, OUTPUT);
    digitalWrite(VEXT_PIN, LOW);   // LOW = Vext ON for Heltec V3
    delay(50);

    // ── OLED display init ────────────────────────────────────────────
    display.begin();
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "MXR BOOTING...");
    display.sendBuffer();

#if ENABLE_RIDESHARE_LIVE
    // ── LoRa SX1262 init (live telemetry) ───────────────────────────
    Serial.println("[MXR] Initializing LoRa SX1262...");
    displayBootStep("INIT LORA");
    loraSPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
    // Initialize LoRa radio with default parameters, then configure individually
    int state = radio.begin();
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
            lora_ok = true;
            Serial.println("[MXR] LoRa SX1262 OK @ 868 MHz");
            displayBootStep("LORA OK");
        }
    }
    if (!lora_ok) {
        Serial.printf("[MXR] LoRa FAILED (err %d)\n", state);
        displayBootStep("LORA FAILED");
    }
#else
    Serial.println("[MXR] Live LoRa telemetry disabled (ENABLE_RIDESHARE_LIVE=0)");
#endif

    // ── GPS on UART1 ─────────────────────────────────────────────────
    Serial.println("[MXR] Initializing GPS UART1...");
    displayBootStep("INIT GPS");
    SerialGPS.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
    Serial.println("[MXR] GPS UART1 started");

    // ── I2C bus for BMP280 + LM75 ────────────────────────────────────
    Serial.println("[MXR] Initializing sensor I2C...");
    displayBootStep("INIT I2C");
    sensorI2C.begin(I2C_SDA, I2C_SCL);

    // ── BMP280 barometer (try 0x76 first, then 0x77) ──────────────────
    if (bmp.begin(0x76) || bmp.begin(0x77)) {
        bmp.setSampling(
            Adafruit_BMP280::MODE_NORMAL,
            Adafruit_BMP280::SAMPLING_X8,       // temp oversampling
            Adafruit_BMP280::SAMPLING_X4,       // pressure oversampling
            Adafruit_BMP280::FILTER_X4,         // IIR filter
            Adafruit_BMP280::STANDBY_MS_63
        );
        baro_ok = true;
        last_baro_ms = millis();
        Serial.println("[MXR] BMP280 OK");
    } else {
        Serial.println("[MXR] BMP280 FAILED @ 0x76 AND 0x77");
        displayBootStep("BMP280 FAILED");
    }

#if HAS_LM75
    // ── LM75 probe & auto-address resolution ─────────────────────────
    displayBootStep("CHECK LM75");
    bool lm75_found = false;
    // LM75 uses address range 0x48 to 0x4F. Let's auto-detect it.
    for (uint8_t addr = 0x48; addr <= 0x4F; addr++) {
        sensorI2C.beginTransmission(addr);
        if (sensorI2C.endTransmission() == 0) {
            lm75_actual_addr = addr;
            lm75_found = true;
            break;
        }
    }

    if (lm75_found) {
        float lm75_test = readLM75();
        Serial.printf("[MXR] LM75 OK at address 0x%02X (%.1f°C)\n", lm75_actual_addr, lm75_test);
    } else {
        Serial.println("[MXR] LM75 FAILED to respond (checked 0x48-0x4F)");
        scanI2CBus(sensorI2C);
    }
#else
    Serial.println("[MXR] LM75 temperature sensor disabled in config");
#endif

#if HAS_SD_CARD
    // ── SD Card on custom SPI bus ────────────────────────────────────
    Serial.println("[MXR] Initializing SD card...");
    displayBootStep("INIT SD");
    
    // Explicitly set CS pin as output and pull high to avoid bus float before init
    pinMode(SD_CS, OUTPUT);
    digitalWrite(SD_CS, HIGH);
    
    // Initialize SPI bus without claiming CS pin directly, let SD library control it
    sdSPI.begin(SD_SCK, SD_MISO, SD_MOSI, -1);
    
    // Lower frequency to 4MHz for stability over jumper wires / matrix routing
    if (SD.begin(SD_CS, sdSPI, 4000000)) {
        if (openFreshLogFile()) {
            sd_ok = true;
            Serial.printf("[MXR] SD card OK, logging to %s\n", log_filename);
        }
    } else {
        Serial.println("[MXR] SD card FAILED");
    }
#else
    Serial.println("[MXR] SD card disabled in config");
    sd_ok = false;
#endif

    // ── Boot status on OLED ──────────────────────────────────────────
    display.clearBuffer();
    display.setFont(u8g2_font_6x10_tf);
    display.drawStr(0, 10, "MACH-X RIDESHARE");
    char line[32];
    snprintf(line, sizeof(line), "LIVE:%s BMP:%s",
        ENABLE_RIDESHARE_LIVE ? (lora_ok ? "OK" : "XX") : "OFF",
        baro_ok ? "OK" : "XX");
    display.drawStr(0, 24, line);
    snprintf(line, sizeof(line), "SD:%s GPS:WAIT",
        sd_ok ? "OK" : "XX");
    display.drawStr(0, 38, line);
    display.drawStr(0, 52, "READY");
    display.sendBuffer();

    // ── Watchdog: auto-reboot if loop() hangs > 5 seconds ────────────
    esp_task_wdt_init(WDT_TIMEOUT_S, true);
    esp_task_wdt_add(NULL);

    Serial.println("[MXR] Setup complete — live telemetry and SD logging at 1 Hz");
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════════════════════════════
void loop() {
    esp_task_wdt_reset();

    // ── Continuously feed GPS parser ─────────────────────────────────
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    static uint32_t last_tx = 0;
    if (millis() - last_tx >= 1000) {
        last_tx = millis();
        pkt_id++;
        uint32_t now = millis();

        // ── Read barometer ───────────────────────────────────────────
        float temp = 0, press = 0, alt = 0;
        float bmp_temp = NAN;
        float lm75_temp = NAN;
        uint8_t flags = 0;
        bool bmp_ok_this_sample = false;

        if (baro_ok) {
            float t = bmp.readTemperature();
            float p = bmp.readPressure() / 100.0f;  // Pa → hPa

            if (isfinite(t) && isfinite(p) && p > 100.0f) {
                temp = t;
                bmp_temp = t;
                press = p;
                bmp_ok_this_sample = true;

                // Averaged baseline calibration (first N readings)
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
        }

#if HAS_LM75
        // If BMP280 temp failed, try LM75 as fallback
        lm75_temp = readLM75();
        if (!isfinite(bmp_temp) && isfinite(lm75_temp)) {
            temp = lm75_temp;
        }
#endif

        // ── Read GPS ─────────────────────────────────────────────────
        double lat = 0, lon = 0;
        bool gps_fix = false;
        if (gps.location.isValid() && gps.location.age() < 2000) {
            lat = gps.location.lat();
            lon = gps.location.lng();
            last_gps_ms = now;
            flags |= FLAG_GPS_FIX;
            gps_fix = true;
        }

        // ── Launch detection (altitude-only, no IMU) ─────────────────
        if (!launched) {
            float gain = alt - baseline_altitude;
            launch_consecutive = (gain > LAUNCH_ALT_DELTA_M) ? launch_consecutive + 1 : 0;
            if (launch_consecutive >= LAUNCH_CONFIRM_COUNT) launched = true;
        }
        if (launched) flags |= FLAG_LAUNCHED;

        // ── Apogee detection ─────────────────────────────────────────
        if (launched && !apogee_detected) {
            if ((max_altitude - alt) > APOGEE_DROP_M) {
                apogee_detected = true;
                apogee_altitude_m = max_altitude;
            }
        }
        if (apogee_detected) flags |= FLAG_APOGEE;

        // ── Health flags ─────────────────────────────────────────────
        if ((now - last_baro_ms) > SENSOR_STALE_MS) flags |= FLAG_STALE_SENSOR;
        if (sd_ok && logFile) flags |= FLAG_SD_OK;

#if ENABLE_RIDESHARE_LIVE
        // ── Build MXR3 packet string (live telemetry) ────────────────
        char body[160];
        char buffer[192];
        const float liveLm75 = isfinite(lm75_temp) ? lm75_temp : -999.0f;
        snprintf(body, sizeof(body), "%u,%lu,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%d,%u",
                 (unsigned)pkt_id, (unsigned long)now, alt, temp, liveLm75, press,
                 lat, lon, (int)last_rssi, (unsigned)flags);
        uint16_t crc = crc16Ccitt(
            reinterpret_cast<const uint8_t*>(body), strlen(body));
        snprintf(buffer, sizeof(buffer), "MXR3:%s,%04X", body, crc);

        // ── Transmit via LoRa ────────────────────────────────────────
        if (lora_ok) {
            int txState = radio.transmit(buffer);
            if (txState == RADIOLIB_ERR_NONE) {
                last_rssi = radio.getRSSI();
            }
        }

        // ── USB Serial debug ─────────────────────────────────────────
        Serial.println(buffer);
#endif

#if HAS_SD_CARD
        // ── Log to SD card ───────────────────────────────────────────
        if (sd_ok && logFile) {
            char lm75Field[16] = "";
            char apogeeField[16] = "";
            if (isfinite(lm75_temp)) snprintf(lm75Field, sizeof(lm75Field), "%.2f", lm75_temp);
            if (isfinite(apogee_altitude_m)) snprintf(apogeeField, sizeof(apogeeField), "%.2f", apogee_altitude_m);

            char apogeeFieldFt[16] = "";
            if (isfinite(apogee_altitude_m)) snprintf(apogeeFieldFt, sizeof(apogeeFieldFt), "%.2f", apogee_altitude_m * 3.28084f);
            logFile.printf("%u,%lu,%.2f,%.2f,%.2f,%s,%.2f,%.6f,%.6f,%u,%u,%u,%u,%.2f,%.2f,%u,%s,%s\n",
                (unsigned)pkt_id, (unsigned long)now, alt, alt * 3.28084f, temp, lm75Field, press,
                lat, lon, gps_fix ? 1u : 0u, (unsigned)flags,
                bmp_ok_this_sample ? 1u : 0u,
                (sd_ok && logFile) ? 1u : 0u,
                max_altitude, max_altitude * 3.28084f, apogee_detected ? 1u : 0u, apogeeField, apogeeFieldFt);
            if (pkt_id % LOG_FLUSH_EVERY == 0) logFile.flush();
        }
#endif

        // ── Update OLED ──────────────────────────────────────────────
        displayStatus(alt, max_altitude, apogee_altitude_m, flags, pkt_id);

        // ── Pet watchdog ─────────────────────────────────────────────
        esp_task_wdt_reset();
    }
}
