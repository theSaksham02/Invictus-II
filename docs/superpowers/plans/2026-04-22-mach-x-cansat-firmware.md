# Mach-X CanSat Firmware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the C++ flight software for the STM32 Bluepill CanSat payload for the Mach-X competition. It must read all 5 hardware sensors, pack the data into a strict 37-byte binary struct, compute an XOR checksum, log to the local MicroSD card, and transmit at 433MHz via the RFM69HCW module at exactly 10Hz.

**Architecture:** A monolithic Arduino/C++ codebase tailored for the `STM32F103C8T6` (Bluepill). Uses a non-blocking `millis()` loop to govern the 100ms (10Hz) transmission interval. Employs hardware SPI for the Radio and SD card, hardware I2C for the BMP388, MPU6500, and LM75, and HardwareSerial for the NEO-6M GPS.

**Tech Stack:** PlatformIO / Arduino C++, RadioHead (RFM69), Adafruit BMP388, Adafruit MPU6500, TinyGPS++, SD, Wire, SPI.

---

### Task 1: Initialize PlatformIO Project and Structs

**Files:**
- Create: `firmware/cansat/platformio.ini`
- Create: `firmware/cansat/src/main.cpp`
- Create: `firmware/cansat/include/telemetry.h`

- [ ] **Step 1: Write platformio.ini config**

```ini
[env:bluepill_f103c8]
platform = ststm32
board = bluepill_f103c8
framework = arduino
upload_flags = -c set CPUTAPID 0x2ba01477
lib_deps =
    lowpowerlab/RadioHead @ ^1.120
    adafruit/Adafruit BMP3XX Library @ ^2.1.2
    adafruit/Adafruit MPU6050 @ ^2.2.6
    adafruit/Adafruit Unified Sensor @ ^1.1.14
    mikalhart/TinyGPSPlus @ ^1.0.3
```

- [ ] **Step 2: Define the exact 37-byte binary struct**

```cpp
// include/telemetry.h
#pragma once
#include <stdint.h>

#pragma pack(push, 1)
struct TelemetryPacket {
    uint16_t pkt_id;         // bytes 0-1
    uint32_t timestamp_ms;   // bytes 2-5
    float    altitude_m;     // bytes 6-9
    float    temp_c;         // bytes 10-13
    float    pressure_hpa;   // bytes 14-17
    float    accel_z;        // bytes 18-21
    float    gyro_x;         // bytes 22-25
    float    lat;            // bytes 26-29
    float    lon;            // bytes 30-33
    int8_t   rssi_dbm;       // byte 34
    uint8_t  flags;          // byte 35 (bit0=launched, bit1=apogee, bit2=gps_fix, bit3=bmp_ok, bit4=mpu_ok, bit5=sd_ok)
    uint8_t  checksum;       // byte 36
};
#pragma pack(pop)
```

- [ ] **Step 3: Setup the Main Loop skeleton**

```cpp
// src/main.cpp
#include <Arduino.h>
#include "telemetry.h"

TelemetryPacket pkt;
uint32_t last_tx = 0;
const uint32_t TX_INTERVAL = 100; // 10Hz

void setup() {
    Serial.begin(115200);
    pkt.pkt_id = 0;
}

void loop() {
    if (millis() - last_tx >= TX_INTERVAL) {
        last_tx = millis();
        pkt.pkt_id++;
        pkt.timestamp_ms = millis();
        
        // Checksum calculation (XOR bytes 0-35)
        uint8_t* ptr = (uint8_t*)&pkt;
        pkt.checksum = 0;
        for(int i = 0; i < 36; i++) {
            pkt.checksum ^= ptr[i];
        }
        
        // TODO: Transmit & SD Write
    }
}
```

- [ ] **Step 4: Commit**
```bash
git add firmware/cansat
git commit -m "feat: init CanSat platformio project and binary telemetry struct"
```

---

### Task 2: RFM69HCW Radio Implementation

**Files:**
- Modify: `firmware/cansat/src/main.cpp`

- [ ] **Step 1: Setup RadioHead**

```cpp
// Add to src/main.cpp at top
#include <RH_RF69.h>
#include <SPI.h>

#define RFM69_CS PA4
#define RFM69_INT PA3
#define RFM69_RST PA2
#define RF69_FREQ 433.0

RH_RF69 rf69(RFM69_CS, RFM69_INT);
```

- [ ] **Step 2: Init Radio in setup()**

```cpp
// Inside setup()
pinMode(RFM69_RST, OUTPUT);
digitalWrite(RFM69_RST, LOW);
delay(10);
digitalWrite(RFM69_RST, HIGH);
delay(10);
digitalWrite(RFM69_RST, LOW);
delay(10);

if (!rf69.init()) {
    Serial.println("RFM69 init failed");
} else {
    rf69.setFrequency(RF69_FREQ);
    rf69.setTxPower(20, true); 
    Serial.println("RFM69 initialized");
}
```

- [ ] **Step 3: Transmit Packet in loop()**

```cpp
// At the end of the TX_INTERVAL if-block
rf69.send((uint8_t*)&pkt, sizeof(TelemetryPacket));
rf69.waitPacketSent();
```

- [ ] **Step 4: Commit**
```bash
git add firmware/cansat/src/main.cpp
git commit -m "feat: add RFM69HCW 433MHz transmission"
```

---

### Task 3: Sensor Integration (BMP388, MPU-6500, NEO-6M)

**Files:**
- Modify: `firmware/cansat/src/main.cpp`

- [ ] **Step 1: Setup libraries**

```cpp
#include <Adafruit_BMP3XX.h>
#include <Adafruit_MPU6050.h>
#include <TinyGPSPlus.h>

Adafruit_BMP3XX bmp; 
Adafruit_MPU6050 mpu;
TinyGPSPlus gps;
HardwareSerial SerialGPS(USART2); // PA3 (RX), PA2 (TX) // Check pinouts

float baseline_pressure = 1013.25;
```

- [ ] **Step 2: Init sensors in setup()**

```cpp
// Inside setup()
if (!bmp.begin_I2C()) {
    Serial.println("BMP388 missing");
} else {
    pkt.flags |= 0x08; // bmp_ok
    bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_8X);
    bmp.setPressureOversampling(BMP3_OVERSAMPLING_4X);
    bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
    bmp.setOutputDataRate(BMP3_ODR_50_HZ);
}

if (!mpu.begin()) {
    Serial.println("MPU6500 missing");
} else {
    pkt.flags |= 0x10; // mpu_ok
    mpu.setAccelerometerRange(MPU6050_RANGE_16_G);
    mpu.setGyroRange(MPU6050_RANGE_2000_DEG);
    mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
}

SerialGPS.begin(9600);
```

- [ ] **Step 3: Poll sensors in loop()**

```cpp
// Top of loop()
while (SerialGPS.available() > 0) {
    gps.encode(SerialGPS.read());
}

if (gps.location.isUpdated() && gps.location.isValid()) {
    pkt.flags |= 0x04; // gps_fix
    pkt.lat = gps.location.lat();
    pkt.lon = gps.location.lng();
}

// Inside TX_INTERVAL if-block, before checksum calculation:
if (pkt.flags & 0x08) {
    if (bmp.performReading()) {
        pkt.temp_c = bmp.temperature;
        pkt.pressure_hpa = bmp.pressure / 100.0;
        if (pkt.pkt_id == 1) baseline_pressure = pkt.pressure_hpa;
        pkt.altitude_m = bmp.readAltitude(baseline_pressure);
    }
}

if (pkt.flags & 0x10) {
    sensors_event_t a, g, temp;
    mpu.getEvent(&a, &g, &temp);
    pkt.accel_z = a.acceleration.z / 9.81; // Convert m/s^2 to G's
    pkt.gyro_x = g.gyro.x * 57.2958;       // Convert rad/s to deg/s
}
```

- [ ] **Step 4: Commit**
```bash
git add firmware/cansat/src/main.cpp
git commit -m "feat: read IMU, BMP, and GPS sensors"
```

---

### Task 4: SD Card Data Logging

**Files:**
- Modify: `firmware/cansat/src/main.cpp`

- [ ] **Step 1: Setup SD Card**

```cpp
#include <SD.h>
#define SD_CS PA11
File logFile;
```

- [ ] **Step 2: Init SD in setup()**

```cpp
if (!SD.begin(SD_CS)) {
    Serial.println("SD init failed");
} else {
    pkt.flags |= 0x20; // sd_ok
    logFile = SD.open("flight.csv", FILE_WRITE);
    if (logFile) {
        logFile.println("pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags");
        logFile.flush();
    }
}
```

- [ ] **Step 3: Log CSV in loop()**

```cpp
// Inside TX_INTERVAL if-block, after checksum but before sending
if ((pkt.flags & 0x20) && logFile) {
    logFile.print(pkt.pkt_id); logFile.print(",");
    logFile.print(pkt.timestamp_ms); logFile.print(",");
    logFile.print(pkt.altitude_m, 2); logFile.print(",");
    logFile.print(pkt.temp_c, 2); logFile.print(",");
    logFile.print(pkt.pressure_hpa, 2); logFile.print(",");
    logFile.print(pkt.accel_z, 2); logFile.print(",");
    logFile.print(pkt.gyro_x, 2); logFile.print(",");
    logFile.print(pkt.lat, 5); logFile.print(",");
    logFile.print(pkt.lon, 5); logFile.print(",");
    logFile.println(pkt.flags);
    
    // Flush every 10 packets (1 second) to prevent data loss on impact
    if (pkt.pkt_id % 10 == 0) logFile.flush();
}
```

- [ ] **Step 4: Commit**
```bash
git add firmware/cansat/src/main.cpp
git commit -m "feat: add synchronous SD card flight logging"
```