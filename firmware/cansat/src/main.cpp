#include <Arduino.h>
#include <RH_RF69.h>
#include <SPI.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>
#include <SdFat.h>
#include <IWatchdog.h>
#include "telemetry.h"

// Pin definitions from backend/CANSAT_CIRCUIT.md.
#define RFM69_CS    PA15
#define RFM69_INT   PB5
#define MPU6500_CS  PB12
#define SD_CS       PA4

#define FLAG_LAUNCHED     0x01
#define FLAG_APOGEE       0x02
#define FLAG_GPS_FIX      0x04
#define FLAG_BMP_OK       0x08
#define FLAG_IMU_OK       0x10
#define FLAG_SD_OK        0x20
#define FLAG_STALE_SENSOR 0x40

#define MPU_REG_WHO_AM_I      0x75
#define MPU_REG_PWR_MGMT_1    0x6B
#define MPU_REG_CONFIG        0x1A
#define MPU_REG_GYRO_CONFIG   0x1B
#define MPU_REG_ACCEL_CONFIG  0x1C
#define MPU_REG_ACCEL_ZOUT_H  0x3F
#define MPU_REG_GYRO_XOUT_H   0x43

RH_RF69 rf69(RFM69_CS, RFM69_INT);
Adafruit_BMP3XX bmp;
TinyGPSPlus gps;
HardwareSerial SerialGPS(PB11, PB10);
SPIClass sdSPI(PA7, PA6, PA5);
SdFat sd;
FsFile logFile;
TelemetryPacket pkt;

const uint32_t TX_INTERVAL_MS = 1000;
const uint32_t GPS_FIX_MAX_AGE_MS = 2000;
const uint32_t SENSOR_STALE_MS = 3000;
const uint8_t LAUNCH_CONFIRM_SAMPLES = 3;
const float LAUNCH_ACCEL_G = 2.5f;
const float LAUNCH_ALT_DELTA_M = 10.0f;
const float APOGEE_DROP_M = 5.0f;

uint32_t lastTxMs = 0;
uint32_t lastBmpMs = 0;
uint32_t lastImuMs = 0;
uint32_t lastGpsMs = 0;
float baselinePressure = 1013.25f;
float baselinePressureSum = 0.0f;
uint8_t baselineSamples = 0;
float baselineAltitude = 0.0f;
float maxAltitude = 0.0f;
uint8_t launchConsecutive = 0;
bool rfOk = false;
bool bmpOk = false;
bool imuOk = false;
bool sdOk = false;

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

uint8_t mpuRead8(uint8_t reg) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg | 0x80);
    uint8_t value = SPI.transfer(0x00);
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();
    return value;
}

void mpuWrite8(uint8_t reg, uint8_t value) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg & 0x7F);
    SPI.transfer(value);
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();
}

int16_t mpuRead16(uint8_t reg) {
    SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
    digitalWrite(MPU6500_CS, LOW);
    SPI.transfer(reg | 0x80);
    uint8_t high = SPI.transfer(0x00);
    uint8_t low = SPI.transfer(0x00);
    digitalWrite(MPU6500_CS, HIGH);
    SPI.endTransaction();
    return static_cast<int16_t>((high << 8) | low);
}

bool initMpu6500() {
    pinMode(MPU6500_CS, OUTPUT);
    digitalWrite(MPU6500_CS, HIGH);
    delay(100);
    uint8_t who = mpuRead8(MPU_REG_WHO_AM_I);
    if (who != 0x70 && who != 0x71 && who != 0x68) return false;

    mpuWrite8(MPU_REG_PWR_MGMT_1, 0x00);
    delay(50);
    mpuWrite8(MPU_REG_CONFIG, 0x03);
    mpuWrite8(MPU_REG_ACCEL_CONFIG, 0x18); // +/-16g
    mpuWrite8(MPU_REG_GYRO_CONFIG, 0x08);  // +/-500 dps
    return true;
}

bool readMpu6500(float& accelZG, float& gyroXDps) {
    if (!imuOk) return false;
    int16_t accelZRaw = mpuRead16(MPU_REG_ACCEL_ZOUT_H);
    int16_t gyroXRaw = mpuRead16(MPU_REG_GYRO_XOUT_H);
    accelZG = static_cast<float>(accelZRaw) / 2048.0f;
    gyroXDps = static_cast<float>(gyroXRaw) / 65.5f;
    return isfinite(accelZG) && isfinite(gyroXDps);
}

void setFlag(uint8_t flag, bool enabled) {
    if (enabled) pkt.flags |= flag;
    else pkt.flags &= static_cast<uint8_t>(~flag);
}

void initializePacket() {
    memset(&pkt, 0, sizeof(TelemetryPacket));
    pkt.sync = TELEMETRY_SYNC;
    pkt.version = TELEMETRY_VERSION;
    pkt.source_id = TELEMETRY_SOURCE_CANSAT;
    pkt.payload_len = TELEMETRY_PAYLOAD_LEN;
}

void updateGps(uint32_t now) {
    while (SerialGPS.available() > 0) {
        gps.encode(SerialGPS.read());
    }

    if (gps.location.isValid() && gps.location.age() <= GPS_FIX_MAX_AGE_MS) {
        pkt.lat = gps.location.lat();
        pkt.lon = gps.location.lng();
        lastGpsMs = now;
        setFlag(FLAG_GPS_FIX, true);
    } else {
        setFlag(FLAG_GPS_FIX, false);
    }
}

void updateBarometer(uint32_t now) {
    if (!bmpOk) return;
    if (!bmp.performReading()) {
        if (now - lastBmpMs > SENSOR_STALE_MS) setFlag(FLAG_BMP_OK, false);
        return;
    }

    pkt.temp_c = bmp.temperature;
    pkt.pressure_hpa = bmp.pressure / 100.0f;
    if (baselineSamples < 20) {
        baselinePressureSum += pkt.pressure_hpa;
        baselineSamples++;
        baselinePressure = baselinePressureSum / baselineSamples;
    }
    pkt.altitude_m = bmp.readAltitude(baselinePressure);
    if (baselineSamples <= 20) baselineAltitude = pkt.altitude_m;
    if (pkt.altitude_m > maxAltitude) maxAltitude = pkt.altitude_m;
    lastBmpMs = now;
    setFlag(FLAG_BMP_OK, true);
}

void updateImu(uint32_t now) {
    float accelZG = 0.0f;
    float gyroXDps = 0.0f;
    if (!readMpu6500(accelZG, gyroXDps)) {
        if (now - lastImuMs > SENSOR_STALE_MS) setFlag(FLAG_IMU_OK, false);
        return;
    }
    pkt.accel_z = accelZG;
    pkt.gyro_x = gyroXDps;
    lastImuMs = now;
    setFlag(FLAG_IMU_OK, true);
}

void updateMissionState() {
    if (!(pkt.flags & FLAG_LAUNCHED)) {
        bool accelLaunch = pkt.accel_z > LAUNCH_ACCEL_G;
        bool altLaunch = (pkt.altitude_m - baselineAltitude) > LAUNCH_ALT_DELTA_M;
        launchConsecutive = (accelLaunch || altLaunch) ? launchConsecutive + 1 : 0;
        if (launchConsecutive >= LAUNCH_CONFIRM_SAMPLES) {
            setFlag(FLAG_LAUNCHED, true);
        }
    }

    if ((pkt.flags & FLAG_LAUNCHED) && !(pkt.flags & FLAG_APOGEE)) {
        if ((maxAltitude - pkt.altitude_m) > APOGEE_DROP_M) {
            setFlag(FLAG_APOGEE, true);
        }
    }
}

void updateHealthFlags(uint32_t now) {
    setFlag(FLAG_STALE_SENSOR, (now - lastBmpMs > SENSOR_STALE_MS) || (imuOk && now - lastImuMs > SENSOR_STALE_MS));
    setFlag(FLAG_SD_OK, sdOk && static_cast<bool>(logFile));
}

void writeLog() {
    if (!logFile) return;
    logFile.printf("%u,%u,%.2f,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%u\n",
        pkt.pkt_id, pkt.timestamp_ms, pkt.altitude_m, pkt.temp_c,
        pkt.pressure_hpa, pkt.accel_z, pkt.gyro_x, pkt.lat, pkt.lon, pkt.flags);
    if (pkt.pkt_id % 5 == 0) logFile.flush();
}

void transmitTelemetry() {
    if (rfOk) pkt.rssi_dbm = rf69.lastRssi();
    pkt.crc16 = 0;
    pkt.crc16 = crc16Ccitt(reinterpret_cast<uint8_t*>(&pkt), sizeof(TelemetryPacket) - sizeof(pkt.crc16));
    if (!rfOk) return;
    rf69.send(reinterpret_cast<uint8_t*>(&pkt), sizeof(TelemetryPacket));
    rf69.waitPacketSent(100);
}

void handleUsbCommands() {
    static char command[32];
    static size_t index = 0;

    while (Serial.available() > 0) {
        char ch = static_cast<char>(Serial.read());
        if (ch == '\r') continue;

        if (ch == '\n') {
            command[index] = '\0';
            if (strcmp(command, "CMD:LAUNCH") == 0) {
                setFlag(FLAG_LAUNCHED, true);
                launchConsecutive = LAUNCH_CONFIRM_SAMPLES;
                Serial.println("ACK:LAUNCH,CANSAT");
            }
            index = 0;
            continue;
        }

        if (index < sizeof(command) - 1) {
            command[index++] = ch;
        } else {
            index = 0;
        }
    }
}

void setup() {
    Serial.begin(115200);
    SerialGPS.begin(9600);
    initializePacket();

    IWatchdog.begin(4000000);

    SPI.setMOSI(PB15);
    SPI.setMISO(PB14);
    SPI.setSCLK(PB13);
    SPI.begin();

    rfOk = rf69.init();
    if (rfOk) {
        rf69.setFrequency(433.0);
        rf69.setTxPower(17, true);
    }

    bmpOk = bmp.begin_I2C();
    if (bmpOk) {
        bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
        bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
        bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
        bmp.setOutputDataRate(BMP3_ODR_50_HZ);
        setFlag(FLAG_BMP_OK, true);
        lastBmpMs = millis();
    }

    imuOk = initMpu6500();
    if (imuOk) {
        setFlag(FLAG_IMU_OK, true);
        lastImuMs = millis();
    }

    if (sd.begin(SdSpiConfig(SD_CS, DEDICATED_SPI, SD_SCK_MHZ(4), &sdSPI))) {
        logFile = sd.open("flight.csv", O_WRONLY | O_CREAT | O_APPEND);
        if (logFile) {
            logFile.println("pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags");
            sdOk = true;
            setFlag(FLAG_SD_OK, true);
        }
    }
}

void loop() {
    uint32_t now = millis();
    handleUsbCommands();
    updateGps(now);

    if (now - lastTxMs >= TX_INTERVAL_MS) {
        lastTxMs += TX_INTERVAL_MS;
        if (now - lastTxMs >= TX_INTERVAL_MS) lastTxMs = now;

        pkt.pkt_id++;
        pkt.timestamp_ms = now;

        updateBarometer(now);
        updateImu(now);
        updateMissionState();
        updateHealthFlags(now);
        writeLog();
        transmitTelemetry();

        Serial.print("PKT: ");
        Serial.println(pkt.pkt_id);
        IWatchdog.reload();
    }
}
