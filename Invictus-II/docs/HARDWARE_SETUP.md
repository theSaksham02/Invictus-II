<!--
  ██╗███╗   ██╗██╗   ██╗██╗ ██████╗████████╗██╗   ██╗███████╗
  ██║████╗  ██║██║   ██║██║██╔════╝╚══██╔══╝██║   ██║██╔════╝
  ██║██╔██╗ ██║██║   ██║██║██║        ██║   ██║   ██║███████╗
  ██║██║╚██╗██║╚██╗ ██╔╝██║██║        ██║   ██║   ██║╚════██║
  ██║██║ ╚████║ ╚████╔╝ ██║╚██████╗   ██║   ╚██████╔╝███████║
  ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚══════╝
  MACH-26 · UKSEDS NRC 2025–26 — University of Birmingham Dubai
-->

<div align="center">

# 🛠️ HARDWARE SETUP GUIDE

### Complete Integration Reference for All Three Flight Systems

*Rover · NRC Satellite · CANSAT — Written for engineers with little prior hardware/software experience*

---

> **Read this document top to bottom at least once before touching any wire.**
> Every pinout, every wiring table, every code snippet, and every "gotcha" warning is here.
> If something is not working, the answer is almost certainly in this file.

</div>

---

## 📋 Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Global Power Rules — Read First](#2-global-power-rules--read-first)
3. [🤖 Rover System (Raspberry Pi 4B)](#3--rover-system-raspberry-pi-4b)
   - [Raspberry Pi 4 Model B](#31-raspberry-pi-4-model-b)
   - [LM2596 Buck Converter](#32-lm2596-buck-converter)
   - [BTS7960 Motor Driver (×2)](#33-bts7960-motor-driver-ibt-2--2)
   - [Raspberry Pi Camera Module 3](#34-raspberry-pi-camera-module-3)
   - [Rover Full Wiring Diagram](#35-rover-full-wiring-diagram)
   - [Rover Software Setup](#36-rover-software-setup)
4. [🛰️ NRC Satellite System (Heltec LoRa v3)](#4-️-nrc-satellite-system-heltec-lora-v3)
   - [Heltec WiFi LoRa 32 v3](#41-heltec-wifi-lora-32-v3)
   - [ESP32-CAM (AI-Thinker)](#42-esp32-cam-ai-thinker)
   - [NEO-6M GPS Module](#43-neo-6m-gps-module)
   - [BMP388 Pressure & Altitude Sensor](#44-bmp388-pressure--altitude-sensor)
   - [LM75 Temperature Sensor](#45-lm75-temperature-sensor)
   - [TP4056 Battery Charger](#46-tp4056-battery-charger)
   - [XL6009 Boost Converter](#47-xl6009-boost-converter)
   - [NRC Full Wiring Diagram](#48-nrc-full-wiring-diagram)
   - [NRC Software Setup](#49-nrc-software-setup)
5. [🚀 CANSAT System (STM32 Bluepill)](#5--cansat-system-stm32-bluepill)
   - [STM32F103C8T6 Bluepill](#51-stm32f103c8t6-bluepill)
   - [RFM69HCW 433 MHz Radio](#52-rfm69hcw-433-mhz-radio)
   - [MPU-6500 IMU](#53-mpu-6500-imu-6-axis)
   - [BMP388 (CANSAT)](#54-bmp388-cansat-instance)
   - [NEO-6M GPS (CANSAT)](#55-neo-6m-gps-cansat-instance)
   - [LM75 (CANSAT)](#56-lm75-cansat-instance)
   - [ESP32-CAM (CANSAT)](#57-esp32-cam-cansat-instance)
   - [MicroSD Card Module](#58-microsd-card-module)
   - [AMS1117-3.3 LDO Regulator](#59-ams1117-33-ldo-regulator)
   - [TP4056 (CANSAT)](#510-tp4056-cansat-instance)
   - [XL6009 (CANSAT)](#511-xl6009-cansat-instance)
   - [CANSAT Full Wiring Diagram](#512-cansat-full-wiring-diagram)
   - [CANSAT Software Setup](#513-cansat-software-setup)
6. [📡 Packet Formats & Data Flow](#6--packet-formats--data-flow)
7. [🔌 Master Pin Reference Tables](#7--master-pin-reference-tables)
8. [⚡ Power Budget & Battery Sizing](#8--power-budget--battery-sizing)
9. [🛠️ Tools, Libraries & IDE Setup](#9-️-tools-libraries--ide-setup)
10. [🐛 Troubleshooting Guide](#10--troubleshooting-guide)

---

## 1. System Architecture Overview

There are **three independent hardware systems** in this project. Each is physically separate but they all feed data into the same ground station software.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MACH-26 — COMPLETE SYSTEM                          │
├─────────────────────────┬──────────────────────────┬────────────────────────┤
│     🚀 CANSAT            │    🛰️ NRC SATELLITE       │    🤖 ORT ROVER        │
│                         │                          │                        │
│  STM32 Bluepill         │  Heltec LoRa v3          │  Raspberry Pi 4B       │
│  ┌──────────────────┐   │  ┌───────────────────┐   │  ┌──────────────────┐  │
│  │ BMP388  (alt/prs)│   │  │ BMP388 (alt/prs)  │   │  │ BTS7960 × 2      │  │
│  │ MPU-6500 (IMU)   │   │  │ NEO-6M  (GPS)     │   │  │ 6 DC Motors      │  │
│  │ LM75    (temp)   │   │  │ LM75    (temp)    │   │  │ Camera Module 3  │  │
│  │ NEO-6M  (GPS)    │   │  │ ESP32-CAM         │   │  │ LM2596 (5V PSU)  │  │
│  │ RFM69HCW (433MHz)│   │  │ XL6009 (boost)    │   │  └──────────────────┘  │
│  │ ESP32-CAM        │   │  │ TP4056 (charger)  │   │                        │
│  │ SD Card          │   │  └───────────────────┘   │  WiFi → Ground Station │
│  │ AMS1117 (3.3V)   │   │                          │                        │
│  │ XL6009 (boost)   │   │  868 MHz LoRa            │                        │
│  │ TP4056 (charger) │   │  "NRC:..." ASCII CSV      │                        │
│  └──────────────────┘   └──────────────────────────┘                        │
│                                                                              │
│  433 MHz RFM69           ↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓↓                                 │
│  37-byte binary packet   GROUND STATION                                      │
│                          Node.js · SQLite · Socket.io                        │
│                          http://localhost:3000                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### What Each System Does

| System | Mission Role | Radio | Data Rate | Range |
|--------|-------------|-------|-----------|-------|
| **CANSAT** | Measures flight dynamics: altitude, acceleration, orientation, temperature, GPS position. Transmits via RFM69 at 433 MHz. | RFM69HCW 433 MHz | 1 packet/sec | ~1 km LOS |
| **NRC Satellite** | Independent atmospheric sensor payload. Transmits ASCII telemetry over LoRa 868 MHz. | SX1262 868 MHz LoRa | 1 packet/sec | ~5 km LOS |
| **ORT Rover** | Ground rover deployed after rocket recovery. Controlled via WiFi. Pi camera streams video. | WiFi 2.4 GHz | Real-time | ~100 m WiFi |

---

## 2. Global Power Rules — Read First

> ⚠️ **Violating these rules will destroy your hardware. Read them. Remember them.**

### The Three Voltage Worlds

```
3.3V World ─── STM32 Bluepill GPIO, MPU-6500, BMP388 logic, RFM69 logic
5V World   ─── Raspberry Pi power input, ESP32-CAM power, NEO-6M module power
Battery    ─── LiPo 3.7V (cell), 2S = 7.4V, motor supply (6–27V)
```

### Critical Rules

1. **Raspberry Pi GPIO = 3.3V ONLY.**
   Never connect a 5V signal to any Pi GPIO pin. It will permanently damage the BCM2711 SoC. There is no fuse. No recovery.

2. **STM32 Bluepill runs at 3.3V logic.**
   Most pins are 5V tolerant on *input only* — but do NOT feed 5V into I2C or SPI pins.

3. **ESP32-CAM needs 5V power but uses 3.3V logic.**
   Power it from 5V. Connect UART lines to 3.3V-level signals only.

4. **Always share GND between all components in the same system.**
   Every module's GND must connect to a common ground rail. Floating grounds cause mysterious failures.

5. **Never connect battery directly to microcontroller boards.**
   Always go through a regulator (LM2596 for step-down, XL6009 for step-up, AMS1117 for low-drop 3.3V).

6. **TP4056 charges. XL6009/LM2596 delivers power. They are different things.**
   TP4056 charges the LiPo cell. The cell then powers everything else through regulators.

7. **Set XL6009/LM2596 output voltage with a multimeter BEFORE connecting any load.**
   An incorrectly set boost/buck converter will destroy whatever is connected.

---

## 3. 🤖 Rover System (Raspberry Pi 4B)

### Components in This System

| # | Component | Quantity | Role |
|---|-----------|----------|------|
| 1 | Raspberry Pi 4 Model B | 1 | Main computer, runs Flask server, controls motors |
| 2 | LM2596 Buck Converter | 1 | Steps down battery voltage to 5.1V for Pi |
| 3 | BTS7960 Motor Driver (IBT-2) | 2 | Drives 3 motors each, full H-bridge |
| 4 | DC Geared Motors | 6 | 3 per side (left/right drive) |
| 5 | Raspberry Pi Camera Module 3 | 1 | Live video stream, Sony IMX708 |

---

### 3.1 Raspberry Pi 4 Model B

#### What It Is
The Pi 4B is a full Linux computer (quad-core ARM Cortex-A72, 1.8 GHz) running Raspberry Pi OS. It is the "brain" of the rover — it runs the Flask web server, receives motor commands over WiFi from the ground station, drives the BTS7960 chips via GPIO PWM signals, and streams camera video.

#### What Data It Produces
- Forwards motor control commands to BTS7960
- Streams MJPEG video from Camera Module 3 over HTTP
- Sends rover telemetry (wheel speeds, camera status) back to ground station via WiFi

#### GPIO Pinout (40-Pin Header — BCM numbering)

```
                    ┌─────────────────────────┐
              3.3V ─┤ 1   2 ├─ 5V
   GPIO2 (SDA1/I2C)─┤ 3   4 ├─ 5V
   GPIO3 (SCL1/I2C)─┤ 5   6 ├─ GND
           GPIO4   ─┤ 7   8 ├─ GPIO14 (TXD0)
               GND ─┤ 9  10 ├─ GPIO15 (RXD0)
          GPIO17   ─┤11  12 ├─ GPIO18 (PWM0) ◄── RPWM Motor A
          GPIO27   ─┤13  14 ├─ GND
          GPIO22   ─┤15  16 ├─ GPIO23
            3.3V   ─┤17  18 ├─ GPIO24
   GPIO10 (MOSI)   ─┤19  20 ├─ GND
   GPIO9  (MISO)   ─┤21  22 ├─ GPIO25
   GPIO11 (SCLK)   ─┤23  24 ├─ GPIO8  (CE0)
               GND ─┤25  26 ├─ GPIO7  (CE1)
           ID_SD   ─┤27  28 ├─ ID_SC
          GPIO5    ─┤29  30 ├─ GND
          GPIO6    ─┤31  32 ├─ GPIO12 (PWM0) ◄── LPWM Motor A
  GPIO13 (PWM1)   ─┤33  34 ├─ GND
  GPIO19 (MISO1)  ─┤35  36 ├─ GPIO16
          GPIO26   ─┤37  38 ├─ GPIO20
               GND ─┤39  40 ├─ GPIO21
                    └─────────────────────────┘
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| SoC | Broadcom BCM2711, Quad-core Cortex-A72 |
| Clock | 1.8 GHz |
| GPIO logic level | **3.3V only — NOT 5V tolerant** |
| GPIO max current per pin | 16 mA |
| Input power | 5V via USB-C or GPIO pins 2/4 (minimum 3A / 15W) |
| WiFi | 802.11ac dual-band, Bluetooth 5.0 |
| Camera port | MIPI CSI-2 (15-pin FPC) |

---

### 3.2 LM2596 Buck Converter

#### What It Is
A step-down (buck) switching power supply module. It takes your higher battery voltage (e.g., 12V from a LiPo pack) and converts it to a stable 5.1V to safely power the Raspberry Pi. It has zero software interface — it is set once by turning a small potentiometer on the board.

#### What Data It Produces
None. It is purely a power component.

#### Wiring

```
Battery Pack (+) ──────────► LM2596 [IN+]
Battery Pack (−) ──────────► LM2596 [IN−]
LM2596 [OUT+]   ──────────► Raspberry Pi GPIO Pin 4 (5V)
LM2596 [OUT−]   ──────────► Raspberry Pi GPIO Pin 6 (GND)
```

#### How to Set the Voltage

1. Connect the battery to `IN+` and `IN−`.
2. Connect a multimeter between `OUT+` and `OUT−`.
3. Use a small flat-head screwdriver to turn the **blue potentiometer** clockwise to increase voltage, counter-clockwise to decrease.
4. Adjust until the multimeter reads exactly **5.10V** (slightly over 5.0V accounts for the slight voltage drop under load).
5. **Only then** connect the Raspberry Pi.

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Input voltage | 4.5V – 40V |
| Output voltage | 1.23V – 37V (adjustable) |
| Output current | 3A continuous |
| Efficiency | ~80–92% |
| Switching frequency | 150 kHz (no EMI on GPS band) |

---

### 3.3 BTS7960 Motor Driver (IBT-2) × 2

#### What It Is
A full H-bridge motor driver capable of driving one DC motor bidirectionally at very high current (up to 43A continuous). You need **two** of these — one for the **left** set of 3 motors and one for the **right** set. It receives PWM signals from the Pi's GPIO pins and converts them into variable-voltage motor drive signals.

#### What Data It Produces
None (the current sense `IS` pins are not used in this project). It is a power actuator only.

#### How It Works
- Send PWM on `RPWM` → motor spins **forward** (duty cycle 0–100% = speed 0–100%)
- Send PWM on `LPWM` → motor spins **reverse**
- Never set both `RPWM` and `LPWM` high at the same time — this causes a shoot-through short circuit

#### Pinout

| Module Pin | Direction | Description |
|-----------|-----------|-------------|
| `RPWM` | Input (from Pi) | Forward PWM signal |
| `LPWM` | Input (from Pi) | Reverse PWM signal |
| `R_EN` | Input (from Pi) | Enable right half-bridge (set HIGH always) |
| `L_EN` | Input (from Pi) | Enable left half-bridge (set HIGH always) |
| `VCC` | Power (5V) | Logic supply for the driver ICs |
| `GND` | Ground | Logic ground (shared with Pi GND) |
| `B+` / `M+` | Motor output | Connect all motor (+) wires here |
| `B−` / `M−` | Motor output | Connect all motor (−) wires here |
| Large screw terminals | Motor power in | Battery supply (6–27V, direct from battery) |

#### Wiring — Left BTS7960 (IBT-2 #1)

```
Raspberry Pi BCM GPIO          BTS7960 #1 (LEFT motors)
─────────────────────          ─────────────────────────
GPIO18  (Pin 12) PWM  ────────► RPWM    (forward)
GPIO12  (Pin 32) PWM  ────────► LPWM    (reverse)
GPIO17  (Pin 11)      ────────► R_EN    (HIGH = enable)
GPIO27  (Pin 13)      ────────► L_EN    (HIGH = enable)
5V      (Pin  4)      ────────► VCC
GND     (Pin  6)      ────────► GND
                               B+ ───► Motor 1 (+), Motor 2 (+), Motor 3 (+)
                               B− ───► Motor 1 (−), Motor 2 (−), Motor 3 (−)
Battery (+) ──────────────────► Large terminal (+)
Battery (−) ──────────────────► Large terminal (−)
```

#### Wiring — Right BTS7960 (IBT-2 #2)

```
Raspberry Pi BCM GPIO          BTS7960 #2 (RIGHT motors)
─────────────────────          ──────────────────────────
GPIO13  (Pin 33) PWM  ────────► RPWM    (forward)
GPIO19  (Pin 35) PWM  ────────► LPWM    (reverse)
GPIO22  (Pin 15)      ────────► R_EN    (HIGH = enable)
GPIO23  (Pin 16)      ────────► L_EN    (HIGH = enable)
5V      (Pin  4)      ────────► VCC
GND     (Pin  6)      ────────► GND
                               B+ ───► Motor 4 (+), Motor 5 (+), Motor 6 (+)
                               B− ───► Motor 4 (−), Motor 5 (−), Motor 6 (−)
Battery (+) ──────────────────► Large terminal (+)
Battery (−) ──────────────────► Large terminal (−)
```

> ⚠️ **Critical ground rule:** Connect Battery(−) to Pi GND and both BTS7960 GND pins. All three must share one common ground rail.

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Motor supply | 6V – 27V |
| Logic supply | 5V |
| Continuous motor current | **43A** |
| Peak current | 50A |
| Max PWM frequency | 25 kHz |
| Logic input compatible | 3.3V or 5V |
| Protections | Overcurrent, over-temperature, over-voltage, shoot-through |

---

### 3.4 Raspberry Pi Camera Module 3

#### What It Is
A 12-megapixel camera module using the Sony IMX708 sensor, with built-in Phase Detection Autofocus (PDAF). It connects via a 15-pin FPC ribbon cable directly into the Pi's dedicated MIPI CSI camera port. No separate power supply or wiring is needed beyond the ribbon cable.

#### What Data It Produces
- Still images: JPEG up to 4608×2592
- Video stream: H.264 or MJPEG at 1080p50, 720p100
- For the rover: an MJPEG stream is served over HTTP for viewing in the browser dashboard

#### How to Connect

1. Locate the **CAMERA** port on the Raspberry Pi 4 (between the USB and HDMI ports).
2. Gently pull up the plastic locking clip.
3. Slide the 15-pin blue FPC ribbon cable into the slot — **blue stripe faces the USB/Ethernet ports side**.
4. Press the locking clip back down firmly until it clicks.
5. No software configuration needed — `libcamera` detects it automatically.

#### How Data Is Collected and Processed

```
Sony IMX708 sensor
      │  (MIPI CSI-2 raw data — 2 data lanes at ~1 Gbps)
      ▼
Raspberry Pi ISP (Image Signal Processor, built into BCM2711)
      │  (debayer, noise reduction, auto-exposure, auto-white-balance)
      ▼
libcamera (kernel driver + userspace library)
      │  (exposes camera as /dev/video0)
      ▼
picamera2 (Python library)
      │  (captures frames as NumPy arrays or saves JPEG/H264)
      ▼
Flask server
      │  (compresses to JPEG, wraps in multipart MIME stream)
      ▼
Browser dashboard (MJPEG display via <img> tag)
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Sensor | Sony IMX708 (back-illuminated, stacked CMOS) |
| Resolution | 11.9 MP (4608 × 2592) |
| Max video | 1080p @ 50fps, 720p @ 100fps |
| Autofocus | Phase Detection (PDAF), ≤200ms |
| Interface | MIPI CSI-2 (15-pin FPC ribbon) |
| Power | 3.3V via Pi (no extra wiring) |
| Operating temp | 0°C to 50°C |

> ⚠️ **GPS interference warning:** The Camera Module 3 CSI clock can emit RFI near 1575 MHz (GPS L1 frequency). If you are logging GPS on the rover, physically separate the camera ribbon from the GPS antenna by at least 5 cm, or wrap the ribbon cable in copper tape connected to GND.

---

### 3.5 Rover Full Wiring Diagram

```
                       ┌─────────────────────┐
  12V LiPo Pack        │   LM2596 BUCK       │
  ─────────────        │   IN+  ◄── BAT+     │
  BAT+  ──────────────►│   IN−  ◄── BAT−     │
  BAT−  ──────────────►│   OUT+ ──► Pi Pin4  │ 5.1V
                        │   OUT− ──► Pi Pin6  │ GND
                        └─────────────────────┘

  BAT+ (direct) ──────────────────────────────────────────► BTS7960 #1 Motor+
  BAT+ (direct) ──────────────────────────────────────────► BTS7960 #2 Motor+
  BAT− (direct) ──────────────────────────────────────────► BTS7960 #1 Motor−
  BAT− (direct) ──────────────────────────────────────────► BTS7960 #2 Motor−

  ┌──────────────────── RASPBERRY PI 4B ────────────────────┐
  │  Pin  2/4 (5V)  ──► BTS7960 #1 VCC, BTS7960 #2 VCC     │
  │  Pin  6/14 (GND)──► BTS7960 #1 GND, BTS7960 #2 GND     │
  │                     BAT−  (common ground rail)           │
  │                                                          │
  │  GPIO18 (Pin12) PWM ──► IBT2 #1 RPWM  (Left Fwd)        │
  │  GPIO12 (Pin32) PWM ──► IBT2 #1 LPWM  (Left Rev)        │
  │  GPIO17 (Pin11)     ──► IBT2 #1 R_EN                    │
  │  GPIO27 (Pin13)     ──► IBT2 #1 L_EN                    │
  │                                                          │
  │  GPIO13 (Pin33) PWM ──► IBT2 #2 RPWM  (Right Fwd)       │
  │  GPIO19 (Pin35) PWM ──► IBT2 #2 LPWM  (Right Rev)       │
  │  GPIO22 (Pin15)     ──► IBT2 #2 R_EN                    │
  │  GPIO23 (Pin16)     ──► IBT2 #2 L_EN                    │
  │                                                          │
  │  CAMERA port (15-pin FPC) ──► Camera Module 3            │
  │                                                          │
  │  WiFi (built-in) ──────────── Ground Station Browser     │
  └──────────────────────────────────────────────────────────┘

  BTS7960 #1 B+ ──► Motor1(+), Motor2(+), Motor3(+)  [LEFT 3 motors]
  BTS7960 #1 B− ──► Motor1(−), Motor2(−), Motor3(−)

  BTS7960 #2 B+ ──► Motor4(+), Motor5(+), Motor6(+)  [RIGHT 3 motors]
  BTS7960 #2 B− ──► Motor4(−), Motor5(−), Motor6(−)
```

---

### 3.6 Rover Software Setup

#### Step 1 — Prepare the Pi

```bash
# On a fresh Raspberry Pi OS Bookworm (64-bit recommended)
sudo apt update && sudo apt upgrade -y

# Enable I2C and SPI interfaces
sudo raspi-config nonint do_i2c 0
sudo raspi-config nonint do_spi 0

# Install pigpio (hardware PWM daemon — much better than software PWM)
sudo apt install -y pigpio python3-pigpio
sudo systemctl enable pigpiod
sudo systemctl start pigpiod

# Install Flask and camera libraries
sudo apt install -y python3-flask python3-picamera2
pip3 install RPi.GPIO
```

#### Step 2 — Motor Control Code (Python)

```python
# firmware/rover/motor.py
import pigpio
import time

pi = pigpio.pi()  # connect to pigpiod daemon

# BTS7960 #1 — LEFT MOTORS
LEFT_RPWM = 18   # BCM GPIO18 = physical pin 12
LEFT_LPWM = 12   # BCM GPIO12 = physical pin 32
LEFT_REN  = 17
LEFT_LEN  = 27

# BTS7960 #2 — RIGHT MOTORS
RIGHT_RPWM = 13   # BCM GPIO13 = physical pin 33
RIGHT_LPWM = 19   # BCM GPIO19 = physical pin 35
RIGHT_REN  = 22
RIGHT_LEN  = 23

PWM_FREQ = 20000  # 20 kHz — inaudible and smooth

def _setup():
    for pin in [LEFT_REN, LEFT_LEN, RIGHT_REN, RIGHT_LEN]:
        pi.set_mode(pin, pigpio.OUTPUT)
        pi.write(pin, 1)   # Enable all half-bridges
    for pin in [LEFT_RPWM, LEFT_LPWM, RIGHT_RPWM, RIGHT_LPWM]:
        pi.set_PWM_frequency(pin, PWM_FREQ)

def set_motor(rpwm_pin, lpwm_pin, speed):
    """
    speed: -255 (full reverse) to +255 (full forward)
    0 = stop
    """
    duty = min(abs(speed), 255)
    pct = int(duty * 1000000 / 255)   # pigpio uses 0–1,000,000
    if speed > 0:
        pi.hardware_PWM(rpwm_pin, PWM_FREQ, pct)
        pi.hardware_PWM(lpwm_pin, PWM_FREQ, 0)
    elif speed < 0:
        pi.hardware_PWM(rpwm_pin, PWM_FREQ, 0)
        pi.hardware_PWM(lpwm_pin, PWM_FREQ, pct)
    else:
        pi.hardware_PWM(rpwm_pin, PWM_FREQ, 0)
        pi.hardware_PWM(lpwm_pin, PWM_FREQ, 0)

def drive(left_speed, right_speed):
    set_motor(LEFT_RPWM,  LEFT_LPWM,  left_speed)
    set_motor(RIGHT_RPWM, RIGHT_LPWM, right_speed)

def stop():
    drive(0, 0)

_setup()
```

#### Step 3 — Camera Streaming Code

```python
# firmware/rover/camera_stream.py
from picamera2 import Picamera2
from picamera2.encoders import JpegEncoder
from picamera2.outputs import FileOutput
import io
import threading
from flask import Response

picam2 = Picamera2()
config = picam2.create_video_configuration(
    main={"size": (640, 480), "format": "RGB888"},
    controls={"FrameRate": 30, "AfMode": 2}   # 2 = continuous autofocus
)
picam2.configure(config)

class StreamingOutput(io.BufferedIOBase):
    def __init__(self):
        self.frame = None
        self.lock = threading.Condition()

    def write(self, buf):
        with self.lock:
            self.frame = buf
            self.lock.notify_all()

output = StreamingOutput()

def start_stream():
    picam2.start_recording(JpegEncoder(), FileOutput(output))

def generate_frames():
    while True:
        with output.lock:
            output.lock.wait()
            frame = output.frame
        yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')

def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')
```

---

## 4. 🛰️ NRC Satellite System (Heltec LoRa v3)

### Components in This System

| # | Component | Quantity | Role |
|---|-----------|----------|------|
| 1 | Heltec WiFi LoRa 32 v3 | 1 | Main MCU + LoRa 868 MHz transmitter, OLED display |
| 2 | ESP32-CAM (AI-Thinker) | 1 | In-flight imaging over WiFi |
| 3 | NEO-6M GPS Module | 1 | Position and altitude from GPS |
| 4 | BMP388 | 1 | Barometric altitude and temperature |
| 5 | LM75 | 1 | Ambient temperature monitoring |
| 6 | TP4056 | 1 | LiPo battery charger |
| 7 | XL6009 | 1 | Boost converter (3.7V LiPo → 5V for ESP32-CAM/GPS) |

---

### 4.1 Heltec WiFi LoRa 32 v3

#### What It Is
The "brain" of the NRC satellite. It is an all-in-one board featuring an **ESP32-S3** MCU, a **Semtech SX1262** LoRa radio chip (868 MHz), a built-in **0.96" OLED display** (128×64, SSD1306), a LiPo battery connector with charging circuit, and a `Vext` rail for powering external sensors. Programming is done via the built-in USB-C port.

#### What Data It Produces
Transmits formatted ASCII CSV packets prefixed with `NRC:` over 868 MHz LoRa. Also displays live flight data on its OLED screen.

#### Packet Format (NRC Telemetry)

```
NRC:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>\n

Example:
NRC:0042,173452,612.3,18.5,940.21,51.501476,-0.140634,-87
```

#### Internal GPIO Assignments (Already Wired On-Board — Do Not Change)

| Function | GPIO | Note |
|----------|------|------|
| LoRa SPI SCK | 9 | On-board SX1262 |
| LoRa SPI MOSI | 10 | On-board SX1262 |
| LoRa SPI MISO | 11 | On-board SX1262 |
| LoRa NSS (CS) | 8 | On-board SX1262 |
| LoRa RST | 12 | On-board SX1262 |
| LoRa BUSY | 13 | On-board SX1262 |
| LoRa DIO1 (IRQ) | 14 | On-board SX1262 |
| OLED SDA | 17 | On-board SSD1306 |
| OLED SCL | 18 | On-board SSD1306 |
| OLED RST | 21 | On-board SSD1306 |
| PRG Button | 0 | Onboard button |
| White LED | 35 | Onboard LED |
| Battery ADC | 1 | Battery voltage monitoring |
| Vext FET | 36 | Controls 3.3V/350mA external power rail |

#### External Sensor Connections (Free GPIO Pins)

| Function | GPIO | Physical Header | Connect To |
|----------|------|-----------------|------------|
| I2C SDA (sensors) | 42 | — | BMP388 SDA, LM75 SDA |
| I2C SCL (sensors) | 41 | — | BMP388 SCL, LM75 SCL |
| GPS UART RX | 38 | — | NEO-6M TxD |
| GPS UART TX | 39 | — | NEO-6M RxD |
| Vext (3.3V out) | — | Vext pin | Powers BMP388, LM75 |

> 💡 Use `GPIO36` (Vext control) to switch sensors on/off. Set it LOW to enable the 3.3V Vext rail (FET is inverted). Set HIGH to cut power and save battery.

#### Key Specs

| Parameter | Value |
|-----------|-------|
| MCU | ESP32-S3, dual Xtensa LX7, 240 MHz |
| Flash | 8 MB |
| SRAM | 512 KB + 8 MB PSRAM |
| LoRa chip | Semtech SX1262 |
| LoRa frequency | 868 MHz (EU ISM band) |
| LoRa TX power | up to 21 dBm |
| LoRa sensitivity | −148 dBm |
| WiFi | 802.11 b/g/n, 2.4 GHz |
| Bluetooth | 5.0 LE |
| Supply | 5V USB-C or 3.7V LiPo |
| Vext rail | 3.3V / 350 mA (GPIO36-controlled) |
| Deep sleep | 147 µA |

#### Arduino IDE Setup

```
Board Manager URL:
  https://espressif.github.io/arduino-esp32/package_esp32_index.json

Board Name (exact):
  Heltec WiFi LoRa 32(V3) / Wireless shell(V3)

Required Libraries (install from Library Manager):
  - "Heltec ESP32 Dev-Boards" by ropg (search: heltec_esp32)
  - RadioLib (auto-installed as dependency)
  - Adafruit BMP3XX Library
  - TinyGPSPlus
  - Wire (built-in)
```

#### NRC Firmware Skeleton

```cpp
// firmware/nrc/nrc_main.ino
#define HELTEC_POWER_BUTTON
#include <heltec_unofficial.h>
#include <Adafruit_BMP3XX.h>
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>
#include <Wire.h>

// ── Sensor objects
Adafruit_BMP3XX bmp;
TinyGPSPlus     gps;
HardwareSerial  gpsSerial(1);   // UART1

// ── Packet counter
uint16_t pktId = 0;

// ── LoRa config
#define LORA_FREQ   868.0
#define LORA_BW     125.0
#define LORA_SF     9
#define LORA_CR     5
#define LORA_POWER  14          // dBm — check local regs

void setup() {
  heltec_setup();               // init Serial, OLED, Vext

  // Power up external sensors via Vext
  digitalWrite(Vext, LOW);      // LOW = Vext ON
  delay(100);

  // Init I2C for sensors (SDA=42, SCL=41 on v3)
  Wire.begin(42, 41);

  // Init BMP388
  if (!bmp.begin_I2C(0x77, &Wire)) {
    display.println("BMP388 FAIL");
  } else {
    bmp.setPressureOversampling(BMP3_OVERSAMPLING_8X);
    bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_2X);
    bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
    bmp.setOutputDataRate(BMP3_ODR_12_5_HZ);
  }

  // Init GPS UART (RX=38, TX=39, baud=9600)
  gpsSerial.begin(9600, SERIAL_8N1, 38, 39);

  // Init LoRa radio
  RADIOLIB_OR_HALT(radio.begin());
  RADIOLIB_OR_HALT(radio.setFrequency(LORA_FREQ));
  RADIOLIB_OR_HALT(radio.setBandwidth(LORA_BW));
  RADIOLIB_OR_HALT(radio.setSpreadingFactor(LORA_SF));
  RADIOLIB_OR_HALT(radio.setCodingRate(LORA_CR));
  RADIOLIB_OR_HALT(radio.setOutputPower(LORA_POWER));
  RADIOLIB_OR_HALT(radio.setSyncWord(0x12));  // private network

  display.println("NRC READY");
}

void loop() {
  heltec_loop();

  // Feed GPS
  while (gpsSerial.available()) gps.encode(gpsSerial.read());

  // Read BMP388
  bmp.performReading();
  float alt_m      = bmp.readAltitude(1013.25);
  float temp_c     = bmp.temperature;
  float press_hpa  = bmp.pressure / 100.0F;

  // Build NRC ASCII packet
  String pkt = "NRC:";
  pkt += pktId++;           pkt += ",";
  pkt += millis();          pkt += ",";
  pkt += String(alt_m, 1);  pkt += ",";
  pkt += String(temp_c, 2); pkt += ",";
  pkt += String(press_hpa, 2); pkt += ",";
  pkt += String(gps.location.lat(), 6); pkt += ",";
  pkt += String(gps.location.lng(), 6); pkt += ",";
  pkt += String((int)radio.getRSSI());

  // Transmit over LoRa
  radio.transmit(pkt);

  // Update OLED
  display.clear();
  display.printf("PKT  #%d\n",   pktId);
  display.printf("ALT  %.1fm\n", alt_m);
  display.printf("TEMP %.1fC\n", temp_c);
  display.printf("SAT  %d\n",    gps.satellites.value());

  heltec_delay(1000);   // 1 Hz telemetry
}
```

---

### 4.2 ESP32-CAM (AI-Thinker)

#### What It Is
A module combining an ESP32-S MCU with an OV2640 2MP camera sensor and 8 MB PSRAM. In the NRC satellite, it creates a WiFi access point and streams JPEG images or video that can be captured post-flight or live if within WiFi range.

#### What Data It Produces
- JPEG still images (up to 1600×1200)
- MJPEG video stream over HTTP
- Images can also be saved to an internal microSD card

#### How to Program It (No USB Port — Needs FTDI)

You need a USB-to-UART adapter (FTDI or CP2102 module):

```
ESP32-CAM          FTDI Adapter (set to 3.3V logic, 5V power)
─────────────      ─────────────────────────────────────────
GND      ────────► GND
5V       ────────► VCC (5V output — FTDI must supply 5V here)
U0R (RX) ────────► TX  (FTDI's TX → ESP32's RX)
U0T (TX) ────────► RX  (FTDI's RX ← ESP32's TX)
GPIO0    ────────► GND  ← THIS IS ESSENTIAL FOR FLASH MODE
```

Upload your sketch in Arduino IDE. **Then:**
1. Remove the GPIO0 → GND wire
2. Press the RST button on the ESP32-CAM
3. Camera runs normally

#### Internal Camera Pin Definitions (Copy Exactly)

```cpp
// These are hardwired inside the module — declare them but do not change
#define PWDN_GPIO_NUM    32
#define RESET_GPIO_NUM   -1
#define XCLK_GPIO_NUM     0
#define SIOD_GPIO_NUM    26
#define SIOC_GPIO_NUM    27
#define Y9_GPIO_NUM      35
#define Y8_GPIO_NUM      34
#define Y7_GPIO_NUM      39
#define Y6_GPIO_NUM      36
#define Y5_GPIO_NUM      21
#define Y4_GPIO_NUM      19
#define Y3_GPIO_NUM      18
#define Y2_GPIO_NUM       5
#define VSYNC_GPIO_NUM   25
#define HREF_GPIO_NUM    23
#define PCLK_GPIO_NUM    22
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| MCU | ESP32-S, dual LX6, 240 MHz |
| Camera | OV2640, 2MP (1600×1200 max) |
| Supply | **5V** (critical — 3.3V will not work) |
| Current | ~180 mA normal, ~310 mA with flash LED |
| WiFi | 802.11 b/g/n, 2.4 GHz |
| MicroSD | Up to 4 GB FAT32 (SPI) |
| Output | JPEG, BMP, Grayscale |

---

### 4.3 NEO-6M GPS Module

#### What It Is
A u-blox 6 GPS receiver module that tracks up to 22 satellites and outputs standard **NMEA 0183** sentences over UART at 9600 baud. A small backup battery retains almanac data between power cycles, enabling faster subsequent position fixes.

#### What Data It Produces (NMEA Sentences)

| Sentence | Contents |
|----------|----------|
| `$GPRMC` | Time, date, latitude, longitude, speed, heading — **use this one** |
| `$GPGGA` | Fix data, altitude above MSL, satellite count, HDOP |
| `$GPGSV` | Satellites in view, signal strength per satellite |

```
Example $GPGGA sentence:
$GPGGA,123519,5150.87,N,00008.44,W,1,08,0.9,534.4,M,46.9,M,,*47
         ↑time ↑lat         ↑lon      ↑fix ↑sats  ↑alt
```

#### Wiring (to Heltec LoRa v3)

```
NEO-6M             Heltec LoRa v3
──────             ──────────────
VCC  ────────────► Vext (3.3V output, enabled via GPIO36)
GND  ────────────► GND
TxD  ────────────► GPIO38 (UART1 RX on Heltec)
RxD  ────────────► GPIO39 (UART1 TX on Heltec) [optional — for config only]
```

> 💡 The NEO-6M module has an onboard 3.3V LDO regulator, so it can accept 5V or 3.3V on VCC. UART pins are also 5V-tolerant. Connect it to the Vext 3.3V rail to keep it powered by the Heltec's battery management system.

#### The Onboard LED
The blue LED on the NEO-6M blinks **once per second** when a GPS fix is acquired. If it is not blinking, the module does not have a fix yet — wait up to 60 seconds outdoors for cold start.

#### Code (TinyGPSPlus on ESP32 UART1)

```cpp
#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

TinyGPSPlus gps;
HardwareSerial gpsSerial(1);

void setupGPS() {
    gpsSerial.begin(9600, SERIAL_8N1, 38, 39);  // RX=38, TX=39
}

void readGPS() {
    while (gpsSerial.available()) {
        gps.encode(gpsSerial.read());
    }
}

// In your main loop, call readGPS() frequently.
// Access data like this:
float lat      = gps.location.lat();        // decimal degrees
float lon      = gps.location.lng();
float alt_m    = gps.altitude.meters();
float speed_kph = gps.speed.kmph();
int   sats     = gps.satellites.value();
bool  has_fix  = gps.location.isValid() && (gps.location.age() < 2000);
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| GPS chip | u-blox NEO-6M |
| Channels | 50 tracking / 22 simultaneous |
| Frequency | GPS L1 (1575.42 MHz) |
| Module supply | 3.3V or 5V |
| Current | ~45 mA |
| UART baud | **9600 bps** default |
| Position accuracy | 2.5 m CEP |
| Update rate | 1 Hz default (5 Hz max) |
| Cold start TTFF | ~27 seconds |
| Hot start TTFF | ~1 second |
| Operating temp | −40°C to +85°C |

---

### 4.4 BMP388 Pressure & Altitude Sensor

#### What It Is
A Bosch precision barometric pressure and temperature sensor. It measures air pressure with very high accuracy, which the firmware converts into altitude using the barometric altitude formula. It is the primary altitude sensor in both the NRC satellite and the CANSAT.

#### How Altitude Is Derived From Pressure

```
Altitude (metres) = 44330 × (1 − (P / P₀)^(1/5.255))

Where:
  P  = current pressure reading from BMP388 in hPa
  P₀ = sea-level pressure at launch site in hPa (typically 1013.25 hPa)

IMPORTANT: Set P₀ at the launch site by reading a local weather station
or averaging 60 seconds of BMP388 readings on the ground.
```

#### Wiring (I2C — Recommended)

```
BMP388 Module      Microcontroller (3.3V)
─────────────      ─────────────────────
VIN   ──────────► 3.3V
GND   ──────────► GND
SDA   ──────────► I2C SDA  [with 4.7kΩ pull-up to 3.3V]
SCL   ──────────► I2C SCL  [with 4.7kΩ pull-up to 3.3V]
SDO   ──────────► GND      → I2C address = 0x76
                  OR 3.3V  → I2C address = 0x77 (default when floating)
CS    ──────────► Leave unconnected (I2C mode)
```

> ℹ️ If you have two BMP388s on the same I2C bus, tie one's SDO to GND (address 0x76) and the other's SDO to 3.3V (address 0x77).

#### I2C Addresses

| SDO pin | I2C Address |
|---------|-------------|
| GND or LOW | 0x76 |
| 3.3V or HIGH (default/floating) | **0x77** |

#### Oversampling Modes vs Altitude Resolution

| OSR Setting | Altitude Noise (±) | Sample Rate |
|------------|-------------------|-------------|
| ×1 (low power) | ±0.22 m | 145 Hz |
| ×4 | ±0.055 m | 77 Hz |
| **×8 (recommended)** | **±0.027 m** | **47 Hz** |
| ×16 | ±0.014 m | 24 Hz |
| ×32 (highest) | ±0.007 m | 13 Hz |

#### How Data Is Collected and Processed

```
BMP388 internal piezo-resistive pressure cell
      │  (24-bit raw ADC output)
      ▼
BMP388 internal compensation engine
      │  (applies 21 factory calibration coefficients from NVM)
      ▼
Output: compensated pressure in hPa (e.g., 940.21 hPa at 600m altitude)
      │
      ▼
Firmware: barometric formula → altitude in metres
      │
      ▼
Packed into telemetry packet → transmitted over radio
```

#### Code (Adafruit BMP3XX Library)

```cpp
#include <Wire.h>
#include <Adafruit_BMP3XX.h>

Adafruit_BMP3XX bmp;

void setupBMP388() {
    // Wire.begin(SDA, SCL) must be called first
    if (!bmp.begin_I2C(0x77)) {
        Serial.println("ERROR: BMP388 not found — check wiring and I2C address");
        while (1);
    }
    bmp.setTemperatureOversampling(BMP3_OVERSAMPLING_2X);
    bmp.setPressureOversampling(BMP3_OVERSAMPLING_8X);
    bmp.setIIRFilterCoeff(BMP3_IIR_FILTER_COEFF_3);
    bmp.setOutputDataRate(BMP3_ODR_12_5_HZ);
}

struct AltData {
    float altitude_m;
    float temperature_c;
    float pressure_hpa;
};

AltData readBMP388(float seaLevelHpa = 1013.25) {
    bmp.performReading();
    return {
        bmp.readAltitude(seaLevelHpa),
        bmp.temperature,
        bmp.pressure / 100.0F
    };
}
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Supply voltage | **1.65V – 3.6V** |
| Current (1 Hz normal mode) | 3.4 µA |
| Pressure range | 300 – 1250 hPa |
| Relative accuracy (0–65°C) | **±8 Pa ≈ ±0.66 m** |
| Absolute accuracy | ±50 Pa |
| Temperature accuracy | ±0.5°C |
| I2C speed | up to 3.4 MHz |
| Package | LGA-10, 2×2×0.75 mm |

---

### 4.5 LM75 Temperature Sensor

#### What It Is
A simple, low-power digital thermometer with I2C interface. It continuously measures temperature and makes the result available in its registers. Up to 8 LM75 devices can share the same I2C bus (they have 3 address pins). In this project, it monitors the electronics bay temperature to catch overheating.

#### What Data It Produces
Temperature as a 16-bit value (11 significant bits, 0.125°C per step). Range: −55°C to +125°C.

#### How Data Is Collected

```
Sigma-Delta ADC + on-chip bandgap reference
      │  (measures ~10 samples/second continuously)
      ▼
Internal 16-bit register [Pointer 0x00]
      │  (11 bits: 1 sign + 10 magnitude, 0.125°C LSB)
      ▼
MCU reads via I2C → convert raw to float:
  raw = (MSB << 8 | LSB) >> 5;
  temp_C = raw * 0.125f;
```

#### Wiring (I2C)

```
LM75 (SOP-8)       Microcontroller
────────────       ───────────────
VCC (Pin 8)  ────► 3.3V (or 5V — both work)
GND (Pin 4)  ────► GND
SDA (Pin 1)  ────► I2C SDA  [4.7kΩ pull-up to VCC]
SCL (Pin 2)  ────► I2C SCL  [4.7kΩ pull-up to VCC]
A0  (Pin 7)  ────► GND   ─┐
A1  (Pin 6)  ────► GND   ─┤── address = 0x48 (default)
A2  (Pin 5)  ────► GND   ─┘
OS  (Pin 3)  ────► Optional GPIO (thermal alert, open-drain)
```

#### I2C Address Table

| A2 | A1 | A0 | Address |
|----|----|----|----|
| 0 | 0 | 0 | **0x48** (default) |
| 0 | 0 | 1 | 0x49 |
| 0 | 1 | 0 | 0x4A |
| ... | ... | ... | up to 0x4F |

#### Code (bare I2C — no library needed)

```cpp
#include <Wire.h>
#define LM75_ADDR 0x48

float readLM75() {
    Wire.beginTransmission(LM75_ADDR);
    Wire.write(0x00);               // point to temperature register
    Wire.endTransmission(false);    // repeated START (don't release bus)
    Wire.requestFrom(LM75_ADDR, 2);
    uint8_t msb = Wire.read();
    uint8_t lsb = Wire.read();
    int16_t raw = ((int16_t)(msb << 8 | lsb)) >> 5;  // 11-bit signed
    return raw * 0.125f;            // convert to °C
}
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Supply | 2.8V – 5.5V |
| Current | 250 µA operating, 3.5 µA shutdown |
| Resolution | **0.125°C / LSB** (11-bit) |
| Range | −55°C to +125°C |
| Accuracy | ±2°C (−25°C to +100°C) |
| I2C speed | up to 400 kHz |
| Addresses | 8 possible (0x48–0x4F) |

---

### 4.6 TP4056 Battery Charger

#### What It Is
A standalone lithium-ion/LiPo battery charger IC. It requires no software — it handles the complete charge cycle (trickle → constant current → constant voltage → auto-termination) automatically. It is powered from a 5V USB source (or any 4–8V input) and charges a single-cell 3.7V LiPo to exactly 4.2V.

#### What Data It Produces
None (unless you read the CHRG/STDBY status pins with a microcontroller, which is optional).

#### How It Works

```
5V USB input  ──► TP4056 (VCC pin)
                      │
                      │  Phase 1: Trickle (battery < 2.9V)
                      │  Phase 2: Constant Current  (up to 1A)
                      │  Phase 3: Constant Voltage  (4.2V ± 1.5%)
                      │  Phase 4: Auto-terminate     (current < C/10)
                      │
                      ▼
              LiPo battery (+) ──► TP4056 BAT pin
              LiPo battery (−) ──► GND
```

#### LED Status Indicators (on pre-built modules)

| Red LED | Blue LED | Status |
|---------|----------|--------|
| ON | OFF | **Charging** |
| OFF | ON | **Charge complete** |
| OFF | OFF | No input power / no battery |

#### Setting Charge Current with RPROG

```
RPROG resistor value determines charge current:
  I_charge (mA) = 1000 / RPROG (kΩ)

  RPROG = 10 kΩ  →  100 mA   (small/thin batteries)
  RPROG = 5 kΩ   →  200 mA
  RPROG = 2 kΩ   →  500 mA   ← typical safe choice
  RPROG = 1 kΩ   → 1000 mA   (maximum — ensure good airflow)
```

> ⚠️ **During flight:** Disconnect USB input. The TP4056 will not do anything harmful without input, but the CE pin can be pulled LOW by the MCU to explicitly disable it. Never charge a battery inside a rocket on a pad.

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Input voltage | 4.0V – 8.0V |
| Charge voltage | **4.2V ±1.5%** |
| Max charge current | 1000 mA |
| Thermal shutdown | ~145°C |
| Battery chemistry | Li-Ion / LiPo (3.7V nominal, 4.2V full) |

---

### 4.7 XL6009 Boost Converter

#### What It Is
A step-up (boost) switching converter. It takes the 3.7V LiPo cell output and boosts it to a higher voltage (5V, 9V, 12V — whatever you need). In the NRC satellite, it provides the 5V rail needed by the ESP32-CAM and GPS module from the LiPo cell.

#### What Data It Produces
None. Power only.

#### How to Set Output Voltage

1. Connect input (`IN+` / `IN−`) to the LiPo battery.
2. Connect a multimeter to `OUT+` / `OUT−`.
3. Turn the potentiometer until you read your target voltage.
4. **Verify the voltage is stable before connecting any load.**

```
VOUT = 1.25 × (1 + R2 / R1)
(On pre-built modules, R2 is the blue trim potentiometer)

Common targets:
  Pot position → 5.0V   (for ESP32-CAM and NEO-6M)
  Pot position → 9.0V   (for other peripherals if needed)
```

#### Wiring

```
LiPo (+)  ──────► XL6009 IN+
LiPo (−)  ──────► XL6009 IN−
XL6009 OUT+ ────► ESP32-CAM 5V, NEO-6M VCC (if on 5V variant)
XL6009 OUT− ────► ESP32-CAM GND, NEO-6M GND
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Input voltage | 5V – 32V (handles down to 3.6V in practice) |
| FB reference | 1.25V |
| Max switch current | 4A |
| Switching frequency | 400 kHz |
| Max efficiency | ~94% |
| Output voltage | adjustable via pot |

---

### 4.8 NRC Full Wiring Diagram

```
  ┌──────────────────────────────────────────────────────────────┐
  │                  LiPo 3.7V Cell                              │
  │                       │                                      │
  │          ┌────────────┴──────────────┐                       │
  │          │ TP4056                    │                        │
  │   USB 5V─┤VCC    BAT├──► LiPo (+)   │                        │
  │          │ GND  GND ├──► LiPo (−)   │ ← Charges when USB in  │
  │          └───────────────────────────┘                        │
  │                                                              │
  │  LiPo (−) ──────────────────────────────────────── GND rail  │
  │  LiPo (+) ──── XL6009 IN+ → OUT+ (5.0V) ──┐                 │
  │                XL6009 IN− → OUT− ──────────┤                 │
  │                                             │                 │
  │  ┌──────────────────────────────────────────┘                 │
  │  │  5V Rail ──► ESP32-CAM 5V                                  │
  │  │  5V Rail ──► NEO-6M VCC (if using 5V supply for GPS)      │
  │  │                                                            │
  │  ┌──────────────── HELTEC LORA v3 ──────────────────┐        │
  │  │  LiPo (+) ──► BAT+ connector (onboard charger)  │        │
  │  │  LiPo (−) ──► GND                               │        │
  │  │                                                  │        │
  │  │  GPIO36 (Vext FET) → Vext pin ──► BMP388 VIN   │        │
  │  │                                  LM75 VCC       │        │
  │  │  GPIO42 (SDA) ──────────────────► BMP388 SDA   │        │
  │  │                                  LM75 SDA       │        │
  │  │  GPIO41 (SCL) ──────────────────► BMP388 SCL   │        │
  │  │                                  LM75 SCL       │        │
  │  │  GPIO38 (UART1 RX) ─────────────► NEO-6M TxD   │        │
  │  │  GPIO39 (UART1 TX) ─────────────► NEO-6M RxD   │        │
  │  │                                                  │        │
  │  │  Onboard SX1262 ─► IPEX antenna (868 MHz)       │        │
  │  │  Onboard OLED   ─► (displays telemetry values)  │        │
  │  └──────────────────────────────────────────────────┘        │
  │                                                              │
  │  BMP388:  VIN─Vext  GND─GND  SDA─GPIO42  SCL─GPIO41         │
  │  LM75:    VCC─Vext  GND─GND  SDA─GPIO42  SCL─GPIO41         │
  │  NEO-6M:  VCC─5V    GND─GND  TxD─GPIO38                     │
  │  ESP32-CAM: 5V─5V   GND─GND  (WiFi image upload)            │
  │                                                              │
  │  Pull-up resistors: 4.7kΩ from SDA→Vext and SCL→Vext       │
  └──────────────────────────────────────────────────────────────┘
```

---

### 4.9 NRC Software Setup

#### PlatformIO Configuration

```ini
; firmware/nrc/platformio.ini
[env:heltec_wifi_lora_32_V3]
platform  = espressif32
board     = heltec_wifi_lora_32_V3
framework = arduino
lib_deps  =
    ropg/heltec_esp32_lora_v3
    jgromes/RadioLib
    adafruit/Adafruit BMP3XX Library
    mikalhart/TinyGPSPlus
```

#### Recommended LoRa Parameters for 868 MHz Rocketry

| Parameter | Value | Why |
|-----------|-------|-----|
| Frequency | 868.0 MHz | EU ISM band, Ofcom IR2030 compliant |
| Bandwidth | 125 kHz | Balance of range and data rate |
| Spreading Factor | 9 | ~1 km range, ~1.7 kbps |
| Coding Rate | 5 (4/5) | Good error correction |
| TX Power | 14 dBm | Well within UK legal limit |
| Sync Word | 0x12 | Private network (not LoRaWAN) |

---

## 5. 🚀 CANSAT System (STM32 Bluepill)

### Components in This System

| # | Component | Quantity | Role |
|---|-----------|----------|------|
| 1 | STM32F103C8T6 Bluepill | 1 | Main flight computer, 72 MHz ARM Cortex-M3 |
| 2 | RFM69HCW | 1 | 433 MHz radio transmitter |
| 3 | MPU-6500 | 1 | 6-axis IMU (accelerometer + gyroscope) |
| 4 | BMP388 | 1 | Barometric altitude and pressure |
| 5 | NEO-6M | 1 | GPS position and altitude |
| 6 | LM75 | 1 | Electronics bay temperature |
| 7 | ESP32-CAM | 1 | In-flight imaging |
| 8 | MicroSD Card Module | 1 | Local data logging backup |
| 9 | AMS1117-3.3 | 1 | 3.3V LDO regulator |
| 10 | TP4056 | 1 | LiPo battery charger |
| 11 | XL6009 | 1 | Boost converter (cell → 5V for ESP32-CAM) |

---

### 5.1 STM32F103C8T6 Bluepill

#### What It Is
A small development board based on the STM32F103C8T6 ARM Cortex-M3 microcontroller running at 72 MHz. It is the central flight computer of the CANSAT — it polls all sensors, builds binary telemetry packets, drives the RFM69 radio, and writes data to the SD card.

#### Critical: It Runs at 3.3V Logic
All GPIO pins output **3.3V**. Most pins tolerate 5V on *input* only. Do not connect 5V signals to I2C or SPI pins.

#### Key Peripheral Pin Map

| Peripheral | Pins | Notes |
|-----------|------|-------|
| **SPI1** (Radio + SD) | PA5(SCK), PA6(MISO), PA7(MOSI) | Shared bus, separate CS pins |
| **I2C1** (MPU-6500, BMP388, LM75) | PB6(SCL), PB7(SDA) | Add 4.7kΩ pull-ups |
| **USART1** (GPS) | PA9(TX→NEO RxD), PA10(RX←NEO TxD) | 9600 baud |
| **USART2** (debug) | PA2(TX), PA3(RX) | Connect to ST-Link Virtual COM |
| **SWD** (programming) | PA13(SWDIO), PA14(SWCLK) | **Never use as GPIO!** |
| **RFM69 CS** | PA4 | Chip-select for radio |
| **RFM69 RST** | PC15 | Reset for radio |
| **RFM69 DIO0** | PC14 | IRQ from radio (PacketSent / PayloadReady) |
| **SD Card CS** | PB12 | Chip-select for SD module |

#### How to Program It (Use ST-Link V2)

```
ST-Link V2           STM32 Bluepill
──────────           ──────────────
SWDIO  ────────────► PA13
SWCLK  ────────────► PA14
GND    ────────────► GND
3.3V   ────────────► 3.3V
```

**In Arduino IDE (STM32duino):**
- Install board package: `https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json`
- Board: `Generic STM32F1 series` → `BluePill F103C8`
- Upload method: `STM32CubeProgrammer (SWD)`

> ⚠️ **BOOT0 jumper:** Must be set to **0 (GND)** for normal operation. Set to 1 only for UART bootloader mode (not recommended — use ST-Link instead).

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Core | ARM Cortex-M3 @ **72 MHz** |
| Flash | 64 KB (some marked 128 KB — verify) |
| RAM | **20 KB** SRAM |
| GPIO logic | **3.3V** (5V tolerant input only on some pins) |
| ADC | 2× 12-bit, up to 1 MSPS |
| I2C | 2× (I2C1: PB6/7, I2C2: PB10/11) |
| SPI | 2× (SPI1: PA4-7, SPI2: PB12-15) |
| USART | 3× |
| Supply | 2.0V – 3.6V (use AMS1117 for 3.3V) |
| Package | 48-pin LQFP |

---

### 5.2 RFM69HCW 433 MHz Radio

#### What It Is
A HopeRF FSK/GFSK/OOK radio transceiver operating at 433 MHz. It is controlled entirely via SPI register reads and writes. It has a 66-byte FIFO buffer, hardware AES-128 encryption, CRC-16 error checking, and can output up to +20 dBm TX power (requiring a special register unlock sequence).

#### What Data It Produces
It transmits the CANSAT's 37-byte binary telemetry packet via 433 MHz FSK and receives an `PacketSent` interrupt on DIO0 when done. On the ground station side (a matching RFM69 receiver or USB dongle), it outputs the raw 37-byte packet.

#### 37-Byte CANSAT Packet Structure

```
Offset  Size  Type     Field
──────  ────  ───────  ─────────────────────────────
  0       2   uint16   pkt_id
  2       4   uint32   timestamp_ms
  6       4   float32  altitude_m
 10       4   float32  temp_c
 14       4   float32  pressure_hpa
 18       4   float32  accel_z   (g-force)
 22       4   float32  gyro_x    (degrees/sec)
 26       4   float32  lat       (decimal degrees)
 30       4   float32  lon       (decimal degrees)
 34       1   int8     rssi_dbm
 35       1   uint8    flags     (bit0=launched, bit1=apogee)
 36       1   uint8    checksum  (XOR of bytes 0–35)
```

#### Wiring (SPI1 on STM32 Bluepill)

```
RFM69HCW       STM32 Bluepill
────────────   ──────────────
VCC  ────────► 3.3V
GND  ────────► GND
MOSI ────────► PA7  (SPI1 MOSI)
MISO ────────► PA6  (SPI1 MISO)
SCK  ────────► PA5  (SPI1 SCK)
NSS  ────────► PA4  (SPI1 NSS / CS — can also be any GPIO)
DIO0 ────────► PC14 (IRQ input)
RST  ────────► PC15 (reset output from STM32)
ANT  ────────► 17.3 cm wire antenna (λ/4 at 433 MHz)
```

> ⚠️ **Current spike on TX:** The RFM69HCW draws up to **130 mA peak** during +20 dBm transmission. Add a **100 µF electrolytic capacitor** close to the VCC pin to absorb this spike and prevent voltage drooping.

#### Antenna
At 433 MHz, a quarter-wave monopole antenna is exactly **17.3 cm** of plain copper wire soldered to the ANT pad. Orient it vertically (perpendicular to the ground) for omnidirectional coverage.

#### Key Registers

| Address | Register | Value/Purpose |
|---------|---------|---------------|
| 0x10 | REG_VERSION | Must read **0x24** — verifies module is alive |
| 0x01 | REG_OPMODE | 0x04=TX, 0x10=RX, 0x00=Sleep |
| 0x07-0x09 | REG_FRF | Carrier frequency (433 MHz = 0x6C, 0x80, 0x00) |
| 0x11 | REG_PALEVEL | TX power and amp selection |
| 0x5A | REG_TESTPA1 | Write 0x55 to unlock +20 dBm |
| 0x5C | REG_TESTPA2 | Write 0x70 to unlock +20 dBm |

#### Code (RadioHead RH_RF69 library)

```cpp
#include <SPI.h>
#include <RH_RF69.h>

#define RF69_CS   PA4
#define RF69_RST  PC15
#define RF69_INT  PC14
#define RF69_FREQ 433.0

RH_RF69 rf69(RF69_CS, RF69_INT);

void setupRadio() {
    pinMode(RF69_RST, OUTPUT);
    digitalWrite(RF69_RST, HIGH);
    delay(10);
    digitalWrite(RF69_RST, LOW);
    delay(10);

    if (!rf69.init()) {
        Serial.println("RFM69 init FAILED — check wiring");
        while (1);
    }
    if (!rf69.setFrequency(RF69_FREQ)) {
        Serial.println("RFM69 setFrequency FAILED");
    }

    // +17 dBm (safe default — unlock sequence needed for +20 dBm)
    rf69.setTxPower(17, true);

    Serial.println("RFM69 ready at 433 MHz");
}

void transmitPacket(uint8_t* buf, uint8_t len) {
    rf69.send(buf, len);
    rf69.waitPacketSent(100);  // 100ms timeout
}
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Frequency | 433 MHz (+ 315, 868, 915 MHz variants) |
| TX power | +13 to +20 dBm (configurable) |
| RX sensitivity | −120 dBm @ 1.2 kbps |
| SPI | Mode 0, up to 10 MHz |
| FIFO depth | 66 bytes |
| Encryption | AES-128 (hardware) |
| Current (TX +20 dBm) | 130 mA peak |
| Current (RX) | 16 mA |
| Supply | 1.8V – 3.6V |

---

### 5.3 MPU-6500 IMU (6-Axis)

#### What It Is
An InvenSense 6-axis Inertial Measurement Unit (IMU) with a 3-axis accelerometer and 3-axis gyroscope in a single IC. It is the primary flight dynamics sensor — it detects launch (high-g acceleration), tracks orientation during flight, and helps detect apogee.

#### What Data It Produces
- **Accelerometer:** X, Y, Z axis acceleration in g-force (configured to ±16g for rocketry)
- **Gyroscope:** X, Y, Z axis angular rate in degrees per second (configured to ±2000 dps)
- **Temperature:** internal die temperature (not used for environmental measurement)

Each axis produces a **16-bit signed integer** from the sensor registers.

#### How Data Is Collected

```
Physical motion (acceleration / rotation)
      │
      ▼
MEMS sensor elements inside MPU-6500
      │  (capacitive sensing, differential measurement)
      ▼
Internal 16-bit ADC (separate for each of 6 axes)
      │
      ▼
Registers 0x3B–0x48 (14 bytes total: 6 accel + 2 temp + 6 gyro)
      │  (burst-read via I2C or SPI)
      ▼
Firmware converts raw to physical units:
  accel_g   = (int16_t)raw / 2048.0f  (at ±16g range)
  gyro_dps  = (int16_t)raw / 16.4f    (at ±2000 dps range)
```

#### Critical Configuration Registers

| Register | Address | Value | Effect |
|---------|---------|-------|--------|
| PWR_MGMT_1 | 0x6B | **0x00** | WAKE UP (default is sleep — MUST clear this!) |
| ACCEL_CONFIG | 0x1C | **0x18** | ±16g range (AFS_SEL = 3) |
| GYRO_CONFIG | 0x1B | **0x18** | ±2000 dps range (FS_SEL = 3) |
| WHO_AM_I | 0x75 | reads **0x70** | Verify device identity |

> ⚠️ **MPU-6500 vs MPU-6050:** The WHO_AM_I register returns **0x70** for MPU-6500 and **0x68** for MPU-6050. Some libraries default to 6050 behaviour — verify your library supports 6500 explicitly or check this register.

#### Wiring (I2C)

```
MPU-6500 Module    STM32 Bluepill
───────────────    ──────────────
VCC  ──────────► 3.3V   (strictly 3.3V — max 3.46V)
GND  ──────────► GND
SDA  ──────────► PB7  (I2C1 SDA)  [4.7kΩ pull-up to 3.3V]
SCL  ──────────► PB6  (I2C1 SCL)  [4.7kΩ pull-up to 3.3V]
AD0  ──────────► GND → I2C address 0x68
               OR 3.3V → I2C address 0x69
```

#### Code

```cpp
#include <Wire.h>
#define MPU_ADDR 0x68

struct IMUData {
    float accel_x, accel_y, accel_z;   // g
    float gyro_x, gyro_y, gyro_z;      // deg/s
    float temp_c;
};

void setupMPU6500() {
    Wire.begin();
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x6B); Wire.write(0x00);  // wake up
    Wire.endTransmission(true);
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1C); Wire.write(0x18);  // accel ±16g
    Wire.endTransmission(true);
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x1B); Wire.write(0x18);  // gyro ±2000 dps
    Wire.endTransmission(true);
}

IMUData readMPU6500() {
    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);  // ACCEL_XOUT_H
    Wire.endTransmission(false);
    Wire.requestFrom(MPU_ADDR, 14);

    int16_t ax = Wire.read()<<8 | Wire.read();
    int16_t ay = Wire.read()<<8 | Wire.read();
    int16_t az = Wire.read()<<8 | Wire.read();
    int16_t t  = Wire.read()<<8 | Wire.read();
    int16_t gx = Wire.read()<<8 | Wire.read();
    int16_t gy = Wire.read()<<8 | Wire.read();
    int16_t gz = Wire.read()<<8 | Wire.read();

    return {
        ax/2048.0f, ay/2048.0f, az/2048.0f,
        gx/16.4f,   gy/16.4f,   gz/16.4f,
        t/333.87f + 21.0f
    };
}
```

#### Launch Detection Logic

```cpp
// Detect launch when sustained high-g acceleration detected
#define LAUNCH_THRESHOLD_G    2.5f   // g's above 1g gravity
#define LAUNCH_CONSEC_READS   3      // must see it 3 times in a row

int launchCount = 0;
bool launched = false;

void checkLaunch(float accel_z) {
    if (!launched && accel_z > LAUNCH_THRESHOLD_G) {
        launchCount++;
        if (launchCount >= LAUNCH_CONSEC_READS) {
            launched = true;
            // Set bit0 of flags in next packet
        }
    } else {
        launchCount = 0;
    }
}
```

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Supply | **2.375V – 3.46V** (strictly 3.3V) |
| Accelerometer range | ±2g, ±4g, ±8g, **±16g** (configurable) |
| Gyroscope range | ±250, ±500, ±1000, **±2000 dps** (configurable) |
| ADC resolution | 16-bit for each axis |
| I2C address | 0x68 (AD0=0) or 0x69 (AD0=1) |
| WHO_AM_I returns | **0x70** |
| I2C speed | up to 400 kHz |
| Package | QFN-24, 3×3×0.9 mm |

---

### 5.4 BMP388 (CANSAT Instance)

Same component as Section 4.4. In the CANSAT, connect via I2C1 on the STM32:

```
BMP388        STM32 Bluepill (I2C1)
──────        ──────────────────────
VIN  ────────► 3.3V
GND  ────────► GND
SDA  ────────► PB7  [4.7kΩ pull-up]
SCL  ────────► PB6  [4.7kΩ pull-up]
SDO  ────────► GND  → address 0x76  (so it doesn't clash with other devices)
```

> Since LM75 is at 0x48 and MPU-6500 is at 0x68, BMP388 at 0x76 — all three I2C devices have unique addresses.

---

### 5.5 NEO-6M GPS (CANSAT Instance)

Same component as Section 4.3. In the CANSAT, connect via USART1 on the STM32:

```
NEO-6M         STM32 Bluepill
──────────     ──────────────
VCC  ────────► 3.3V (or via XL6009 5V rail with module's LDO)
GND  ────────► GND
TxD  ────────► PA10 (USART1 RX on STM32)
RxD  ────────► PA9  (USART1 TX on STM32)  [optional for config]
```

---

### 5.6 LM75 (CANSAT Instance)

Same component as Section 4.5. In the CANSAT, connect via I2C1 on the STM32:

```
LM75         STM32 Bluepill (I2C1)
────         ──────────────────────
VCC ────────► 3.3V
GND ────────► GND
SDA ────────► PB7  [shares 4.7kΩ pull-up with BMP388 and MPU-6500]
SCL ────────► PB6
A0  ────────► GND  → address 0x48
A1  ────────► GND
A2  ────────► GND
```

---

### 5.7 ESP32-CAM (CANSAT Instance)

Same module as Section 4.2. In the CANSAT, it powers on, creates a WiFi AP, and streams/saves images independently. It communicates with the STM32 optionally via UART2 to receive a trigger signal.

```
ESP32-CAM       Power & Optional UART
────────────    ──────────────────────
5V  ──────────► XL6009 OUT+ (5V)
GND ──────────► GND (common rail)
U0R ──────────► STM32 PA2 (USART2 TX → ESP32 RX)  [optional trigger]
U0T ──────────► STM32 PA3 (USART2 RX ← ESP32 TX)  [optional status]
```

---

### 5.8 MicroSD Card Module

#### What It Is
A breakout board that interfaces a standard microSD card with a microcontroller via SPI. It includes a **3.3V LDO** and **74LVC125A level shifter** on-board, making it compatible with both 3.3V and 5V systems. Used in the CANSAT for local flight data backup — if radio telemetry is lost, all data is on the SD card.

#### What Data It Stores
A CSV file written during flight:
```
timestamp_ms,alt_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags
1234,612.3,18.5,940.21,2.1,0.04,51.501,−0.140,3
```

#### Wiring (SPI1 on STM32 — Shared with RFM69)

```
SD Module       STM32 Bluepill
─────────────   ──────────────
VCC  ────────► 5V  (module's LDO handles 3.3V internally)
GND  ────────► GND
MISO ────────► PA6  (SPI1 MISO — shared with RFM69)
MOSI ────────► PA7  (SPI1 MOSI — shared with RFM69)
SCK  ────────► PA5  (SPI1 SCK  — shared with RFM69)
CS   ────────► PB12 (GPIO output — separate CS from RFM69's PA4)
```

> ℹ️ SPI bus sharing works correctly because only one CS pin is active (LOW) at a time. When talking to RFM69: PB12 is HIGH and PA4 is LOW. When talking to SD: PA4 is HIGH and PB12 is LOW.

#### Critical SD Rules

1. Always initialize SPI at **400 kHz** for SD card detection, then switch to 18 MHz.
2. Always call `file.close()` after every write. Power loss with an open file = corrupted FAT table = all data lost.
3. Use FAT32 format. Card size: 4–32 GB.
4. Pre-create the data file before flight to avoid allocation overhead during launch.

#### Code (Arduino SD.h)

```cpp
#include <SPI.h>
#include <SD.h>

#define SD_CS PB12

File logFile;

void setupSD() {
    SPI.begin();
    if (!SD.begin(SD_CS)) {
        Serial.println("SD card init FAILED");
        return;
    }
    logFile = SD.open("FLIGHT.CSV", FILE_WRITE);
    if (!logFile) {
        Serial.println("Failed to open FLIGHT.CSV");
    } else {
        logFile.println("ts_ms,alt_m,temp_c,press_hpa,accel_z,gyro_x,lat,lon,flags");
    }
}

void logData(float alt, float temp, float press,
             float az, float gx, float lat, float lon, uint8_t flags) {
    if (!logFile) return;
    logFile.printf("%lu,%.1f,%.2f,%.2f,%.3f,%.3f,%.6f,%.6f,%d\n",
                   millis(), alt, temp, press, az, gx, lat, lon, flags);
    logFile.flush();   // write to card immediately — don't buffer
}
```

---

### 5.9 AMS1117-3.3 LDO Regulator

#### What It Is
A low-dropout (LDO) linear voltage regulator that produces a stable 3.3V output from a higher input voltage. It provides the 3.3V rail that powers the STM32, RFM69, MPU-6500, BMP388, and LM75. It requires no software.

#### Wiring (SOT-223 package — 3 pins)

```
SOT-223 pin:  Name    Connect to
Pin 1 (left): GND   ──► GND
Pin 2 (adj/out): VOUT ──► 3.3V rail (also connect 10µF cap to GND)
Pin 3 (right): VIN  ──► Input from battery/XL6009 (4.5V – 12V)
Thermal tab:  VOUT  ──► Solder to copper pour for heat dissipation
```

> ⚠️ **Capacitor requirement:** Place a **10µF tantalum** (or 10µF ceramic + 1Ω series resistor) capacitor on the output and a **10µF** electrolytic on the input. Without proper capacitors, the AMS1117 can oscillate.

> ⚠️ **Thermal:** At 7.4V input, 330mA load: P_dissipated = (7.4 - 3.3) × 0.33 = **1.35W**. The SOT-223 package will get hot. Solder the tab to a large copper area on your PCB or add a small heatsink.

#### Key Specs

| Parameter | Value |
|-----------|-------|
| Output voltage | **3.3V ±2%** |
| Max input voltage | 15V (12V recommended) |
| Max output current | **1A** |
| Dropout voltage | 1.2V @ 1A (VIN must be ≥ 4.5V) |
| Output capacitor | 10µF tantalum minimum |
| Operating temp | −40°C to +125°C |

---

### 5.10 TP4056 (CANSAT Instance)

Same as Section 4.6. Charges the CANSAT's LiPo cell. Disconnect USB (and disable CE pin) before arming on the pad.

---

### 5.11 XL6009 (CANSAT Instance)

Same as Section 4.7. Set to 5V to power ESP32-CAM and NEO-6M module (which has onboard LDO). Input is from the 3.7V LiPo cell after the TP4056.

---

### 5.12 CANSAT Full Wiring Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CANSAT POWER CHAIN                                    │
│                                                                              │
│  LiPo 3.7V Cell                                                              │
│      │                                                                       │
│      ├──► TP4056 [BAT] ← [VCC] ← USB 5V (charge only on ground)            │
│      │                                                                       │
│      ├──► AMS1117-3.3 [VIN]                                                  │
│      │         [VOUT] ──────────────────────────────────────► 3.3V RAIL     │
│      │                                                                       │
│      └──► XL6009 [IN+]                                                       │
│               [OUT+] ─────────────────────────────────────► 5V RAIL        │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                        STM32 BLUEPILL CONNECTIONS                            │
│                                                                              │
│  3.3V RAIL ────► STM32 3.3V pin                                              │
│  GND       ────► STM32 GND                                                   │
│                                                                              │
│  SPI1 (PA4-CS, PA5-SCK, PA6-MISO, PA7-MOSI):                                │
│    PA4  (CS)   ──────────────────────────────────────► RFM69HCW NSS         │
│    PA5  (SCK)  ──────────────────────────────────────► RFM69HCW SCK         │
│                                                         SD Card   SCK        │
│    PA6  (MISO) ──────────────────────────────────────► RFM69HCW MISO        │
│                                                         SD Card   MISO       │
│    PA7  (MOSI) ──────────────────────────────────────► RFM69HCW MOSI        │
│                                                         SD Card   MOSI       │
│    PC14        ──────────────────────────────────────► RFM69HCW DIO0        │
│    PC15        ──────────────────────────────────────► RFM69HCW RST         │
│    PB12        ──────────────────────────────────────► SD Card   CS         │
│                                                                              │
│  I2C1 (PB6-SCL, PB7-SDA) — 4.7kΩ pull-ups to 3.3V:                        │
│    PB6 (SCL) ──────────────────────────────────────► MPU-6500 SCL           │
│                                                       BMP388   SCL           │
│                                                       LM75     SCL           │
│    PB7 (SDA) ──────────────────────────────────────► MPU-6500 SDA           │
│                                                       BMP388   SDA           │
│                                                       LM75     SDA           │
│  I2C addresses on same bus:                                                  │
│    MPU-6500 → 0x68 (AD0=GND)                                                │
│    BMP388   → 0x76 (SDO=GND)                                                │
│    LM75     → 0x48 (A0=A1=A2=GND)                                           │
│                                                                              │
│  USART1 (PA9-TX, PA10-RX):                                                   │
│    PA10 (RX) ──────────────────────────────────────► NEO-6M  TxD            │
│    PA9  (TX) ──────────────────────────────────────► NEO-6M  RxD [opt]      │
│                                                                              │
│  Power to sensors:                                                            │
│    3.3V RAIL ──► MPU-6500 VCC, BMP388 VIN, LM75 VCC                         │
│    5V RAIL   ──► NEO-6M VCC, SD Card VCC, ESP32-CAM 5V                      │
│    GND       ──► ALL module GNDs                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                        ANTENNA                                                │
│  RFM69HCW ANT pin ──► 17.3 cm wire (vertical, λ/4 at 433 MHz)               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5.13 CANSAT Software Setup

#### Arduino IDE Setup for STM32duino

```
1. File → Preferences → Additional Boards Manager URLs, add:
   https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json

2. Tools → Board → Boards Manager → search "STM32" → install "STM32 MCU based boards"

3. Tools → Board → STM32 boards → "Generic STM32F1 series"
4. Tools → Board part number → "BluePill F103C8"
5. Tools → Upload method → "STM32CubeProgrammer (SWD)"
6. Tools → Optimize → "Smallest (-Os default)"
```

#### Required Libraries

```
Install via Library Manager:
- RadioHead          (by Mike McCauley — for RFM69HCW)
- Adafruit BMP3XX    (by Adafruit — for BMP388)
- TinyGPSPlus        (by Mikal Hart — for NEO-6M)
- MPU6500 library    (by Electronic Cats or similar)
  OR use raw I2C code from Section 5.3
```

#### CANSAT Main Loop Structure

```cpp
// firmware/cansat/cansat_main.ino (conceptual structure)

void loop() {
    uint32_t loopStart = millis();

    // 1. Read all sensors
    IMUData imu    = readMPU6500();
    AltData baro   = readBMP388(seaLevelHpa);
    readGPS();  // feeds TinyGPSPlus parser

    // 2. Check flight state
    checkLaunch(imu.accel_z);
    if (launched) checkApogee(baro.altitude_m);

    // 3. Build 37-byte binary packet
    uint8_t pkt[37];
    buildPacket(pkt, imu, baro, gps);  // includes XOR checksum

    // 4. Transmit via RFM69 (433 MHz)
    transmitPacket(pkt, 37);

    // 5. Log to SD card
    logData(baro.altitude_m, baro.temperature_c, baro.pressure_hpa,
            imu.accel_z, imu.gyro_x,
            gps.location.lat(), gps.location.lng(), flags);

    // 6. Maintain 1 Hz rate
    while (millis() - loopStart < 1000);
}
```

---

## 6. 📡 Packet Formats & Data Flow

### End-to-End Data Flow

```
SENSORS (on rocket/satellite)
      │
      ▼
MICROCONTROLLER (STM32 / Heltec ESP32)
  → reads sensors every 1 second
  → assembles packet
  → transmits via radio
      │
      │ (RF link through air)
      │
      ▼
GROUND STATION RECEIVER
  → USB dongle (RFM69 or LoRa receiver)
  → /dev/ttyUSB0 or COMx at 115200 baud
      │
      ▼
backend/serial.js
  → reads raw bytes from serial port
  → passes to parser.js
      │
      ▼
backend/parser.js
  → identifies source (CANSAT or NRC) from packet header
  → decodes binary (CANSAT) or splits CSV (NRC)
  → validates checksum
  → emits structured JSON object
      │
      ▼
backend/phase-tracker.js
  → determines flight phase from altitude + accel data
  → emits mission_event if phase changes
      │
      ▼
backend/db.js
  → stores every packet in SQLite (flight.db)
      │
      ▼
backend/server.js (Socket.io)
  → broadcasts 'packet' event to all browser clients
      │
      ▼
dashboard/ground-station.html
  → Chart.js: live altitude/temperature/pressure graphs
  → Leaflet.js: GPS track on map
  → 3D attitude indicator: accel/gyro data
  → Console: raw packet log
```

### CANSAT Binary Packet (37 bytes, little-endian)

```
Field          Offset  Bytes  Type      Example Value
─────────────  ──────  ─────  ────────  ─────────────
pkt_id            0      2    uint16    42
timestamp_ms      2      4    uint32    173452
altitude_m        6      4    float32   612.3
temp_c           10      4    float32   18.5
pressure_hpa     14      4    float32   940.21
accel_z          18      4    float32   1.02   (g)
gyro_x           22      4    float32   0.41   (deg/s)
lat              26      4    float32   51.501476
lon              30      4    float32   -0.140634
rssi_dbm         34      1    int8      -87
flags            35      1    uint8     0x03   (launched + apogee)
checksum         36      1    uint8     XOR of bytes 0–35
```

**Checksum calculation:**
```cpp
uint8_t calcChecksum(uint8_t* buf, int len) {
    uint8_t cs = 0;
    for (int i = 0; i < len; i++) cs ^= buf[i];
    return cs;
}
```

### NRC ASCII Packet

```
Format: NRC:<id>,<ts_ms>,<alt_m>,<temp_c>,<press_hpa>,<lat>,<lon>,<rssi>\n

Example:
NRC:0042,173452,612.3,18.50,940.21,51.501476,-0.140634,-87
```

---

## 7. 🔌 Master Pin Reference Tables

### Raspberry Pi 4B — Rover Pin Assignments

| BCM GPIO | Physical Pin | Function | Connect To |
|----------|-------------|----------|------------|
| GPIO18 | 12 | PWM0 — Left Forward | BTS7960 #1 RPWM |
| GPIO12 | 32 | PWM0 — Left Reverse | BTS7960 #1 LPWM |
| GPIO17 | 11 | Left R_EN | BTS7960 #1 R_EN |
| GPIO27 | 13 | Left L_EN | BTS7960 #1 L_EN |
| GPIO13 | 33 | PWM1 — Right Forward | BTS7960 #2 RPWM |
| GPIO19 | 35 | Right Reverse | BTS7960 #2 LPWM |
| GPIO22 | 15 | Right R_EN | BTS7960 #2 R_EN |
| GPIO23 | 16 | Right L_EN | BTS7960 #2 L_EN |
| — | CAMERA | CSI-2 FPC | Camera Module 3 |
| — | 2 (5V) | 5V power out | BTS7960 VCC |
| — | 4 (5V) | 5V power in | LM2596 OUT+ |
| — | 6 (GND) | Ground | Common GND rail |

### STM32 Bluepill — CANSAT Pin Assignments

| STM32 Pin | Function | Connect To |
|----------|----------|------------|
| PA4 | SPI1 CS (RFM69) | RFM69HCW NSS |
| PA5 | SPI1 SCK | RFM69HCW SCK, SD Card SCK |
| PA6 | SPI1 MISO | RFM69HCW MISO, SD Card MISO |
| PA7 | SPI1 MOSI | RFM69HCW MOSI, SD Card MOSI |
| PB12 | GPIO Output (SD CS) | SD Card CS |
| PC14 | GPIO Input (Radio IRQ) | RFM69HCW DIO0 |
| PC15 | GPIO Output (Radio RST) | RFM69HCW RST |
| PB6 | I2C1 SCL | MPU-6500, BMP388, LM75 |
| PB7 | I2C1 SDA | MPU-6500, BMP388, LM75 |
| PA9 | USART1 TX | NEO-6M RxD |
| PA10 | USART1 RX | NEO-6M TxD |
| PA13 | SWD DATA | ST-Link (programming only) |
| PA14 | SWD CLK | ST-Link (programming only) |
| 3.3V | Power | All 3.3V devices |
| GND | Ground | All GNDs |

### I2C Address Map (Both Systems)

| Device | I2C Address | Address Pin Config |
|--------|------------|-------------------|
| MPU-6500 | **0x68** | AD0 = GND |
| BMP388 | **0x76** | SDO = GND |
| LM75 | **0x48** | A2=A1=A0 = GND |
| BMP388 (alt) | 0x77 | SDO = 3.3V |

---

## 8. ⚡ Power Budget & Battery Sizing

### CANSAT Power Budget

| Component | Voltage | Current (typical) | Power |
|-----------|---------|-------------------|-------|
| STM32 Bluepill | 3.3V | 50 mA | 0.17W |
| RFM69HCW (TX) | 3.3V | 130 mA peak | 0.43W |
| RFM69HCW (RX) | 3.3V | 16 mA | 0.05W |
| MPU-6500 | 3.3V | 3.5 mA | 0.01W |
| BMP388 | 3.3V | 3.4 µA | ~0W |
| LM75 | 3.3V | 0.25 mA | ~0W |
| NEO-6M | 5V/3.3V | 45 mA | 0.15W |
| SD Card | 3.3V | 100 mA (write) | 0.33W |
| ESP32-CAM | 5V | 180 mA | 0.90W |
| AMS1117 (loss) | — | — | ~0.3W |
| **Total** | | | **~2.3W** |

**Battery sizing for 45 min:** 2.3W / 3.7V × 0.75hr × 1.3 (safety factor) ≈ **620 mAh minimum**. Use a **1000 mAh** 3.7V LiPo.

### NRC Satellite Power Budget

| Component | Current (typical) | Power |
|-----------|-------------------|-------|
| Heltec LoRa v3 (TX) | 150 mA | 0.55W |
| Heltec LoRa v3 (idle) | 80 mA | 0.30W |
| NEO-6M | 45 mA | 0.17W |
| BMP388 + LM75 | 4 mA | 0.01W |
| ESP32-CAM | 180 mA | 0.67W |
| XL6009 (boost loss) | — | ~0.1W |
| **Total** | | **~1.8W** |

**Battery for 45 min:** ~600 mAh minimum. Use **1000 mAh** 3.7V LiPo.

### Rover Power Budget

| Component | Current | Notes |
|-----------|---------|-------|
| Raspberry Pi 4B | 700 mA @ 5V | Idle; up to 2A under load |
| Camera Module 3 | 200 mA | During streaming |
| 6× DC Motors | 500–4000 mA | Depends heavily on motor specs |
| BTS7960 × 2 logic | 14 mA | |
| **Control (Pi + Camera)** | **~1A @ 5V** | Via LM2596 |
| **Motor supply** | **Variable** | Direct from battery |

Use at least a **5000 mAh, 3S or 4S LiPo** for the rover motor supply. Set LM2596 to 5.1V for the Pi from the same battery.

---

## 9. 🛠️ Tools, Libraries & IDE Setup

### Software Tools

| Tool | Purpose | Download |
|------|---------|---------|
| Arduino IDE 2.x | STM32 and ESP32 firmware | arduino.cc |
| STM32CubeProgrammer | Flash STM32 via ST-Link | st.com |
| ST-Link V2 driver | Program STM32 Bluepill | st.com |
| u-center (Windows) | Configure NEO-6M GPS | u-blox.com |
| FTDI driver | Program ESP32-CAM | ftdichip.com |
| Node.js v20 LTS | Run ground station backend | nodejs.org |
| Raspberry Pi Imager | Flash Pi OS to SD card | raspberrypi.com |
| PlatformIO (VS Code) | Alternative to Arduino IDE | platformio.org |

### Arduino Board Package URLs

```
For ESP32 (Heltec LoRa v3 + ESP32-CAM):
  https://espressif.github.io/arduino-esp32/package_esp32_index.json

For STM32 (Bluepill):
  https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json
```

### Required Arduino Libraries

```
Install via Sketch → Include Library → Manage Libraries:

For CANSAT (STM32):
  ┌──────────────────────────────────────────────────────┐
  │ RadioHead          by Mike McCauley   (RFM69HCW)     │
  │ Adafruit BMP3XX    by Adafruit        (BMP388)       │
  │ TinyGPSPlus        by Mikal Hart      (NEO-6M GPS)   │
  │ Wire               (built-in I2C)                    │
  │ SPI                (built-in SPI)                    │
  │ SD                 (built-in SD card)                │
  └──────────────────────────────────────────────────────┘

For NRC Satellite (Heltec LoRa v3):
  ┌──────────────────────────────────────────────────────┐
  │ Heltec ESP32 Dev-Boards (ropg) — search: heltec_esp32│
  │ RadioLib           (auto-installed with above)       │
  │ Adafruit BMP3XX    by Adafruit        (BMP388)       │
  │ TinyGPSPlus        by Mikal Hart      (NEO-6M GPS)   │
  └──────────────────────────────────────────────────────┘

For Rover (Raspberry Pi — Python packages):
  sudo apt install -y pigpio python3-pigpio python3-picamera2 python3-flask
```

### Ground Station Setup

```bash
# Clone repository
git clone https://github.com/theSaksham02/Invictus-II.git
cd Invictus-II/backend

# Install Node.js dependencies
npm install

# Configure serial port
cp .env.example .env
# Edit .env and set:
# SERIAL_PORT=/dev/ttyUSB0   (Linux/Mac)
# SERIAL_PORT=COM3            (Windows)
# BAUD_RATE=115200

# Start in simulation mode (no hardware needed)
npm run sim

# Start with real hardware
npm start

# Open in browser
# http://localhost:3000
```

---

## 10. 🐛 Troubleshooting Guide

### 🚨 Common Problems and Solutions

---

#### Problem: STM32 won't program via ST-Link

| Check | Solution |
|-------|----------|
| BOOT0 jumper position | Set BOOT0 to **0 (GND position)** for SWD programming |
| SWD wire connections | Verify PA13=SWDIO, PA14=SWCLK — these are NOT I/O during use |
| Power | ST-Link can power the board via its 3.3V pin |
| STM32CubeProgrammer | Select "SWD" interface, click "Connect" before uploading |

---

#### Problem: RFM69 not initialising (returns wrong VERSION register)

| Check | Solution |
|-------|----------|
| SPI wiring | Swap MOSI/MISO if reversed |
| CS pin | Verify the CS pin is defined correctly and set LOW during SPI transfer |
| Power | RFM69 needs 3.3V — check if AMS1117 output is correct |
| Read VERSION | `rf69.init()` should return true; add `Serial.println(rf69.version())` — must print `0x24` |

---

#### Problem: GPS not getting a fix

| Check | Solution |
|-------|----------|
| Outdoors? | GPS will not work indoors — go outside or near a window |
| Antenna connected? | Ensure the small ceramic patch antenna is plugged into the U.FL connector |
| Baud rate | Default is 9600 — ensure your serial matches |
| LED blinking? | Blue LED blinks 1Hz when fix acquired. Continuous = searching |
| Cold start | First fix outdoors can take 60–90 seconds — be patient |
| RFI from camera | Keep Camera Module 3 ribbon cable at least 5 cm from GPS antenna |

---

#### Problem: BMP388 not found on I2C (i2c_scanner shows nothing)

| Check | Solution |
|-------|----------|
| Pull-up resistors | **Must have** 4.7kΩ from SDA→3.3V and SCL→3.3V. No pull-ups = no I2C |
| I2C address | Default 0x77 (SDO floating/3.3V). If SDO=GND, use 0x76 |
| Wire.begin() | Call `Wire.begin(SDA, SCL)` with correct pin numbers before `bmp.begin_I2C()` |
| Power | BMP388 needs 1.65V–3.6V — connect to 3.3V |

---

#### Problem: Motors not moving or moving erratically

| Check | Solution |
|-------|----------|
| R_EN / L_EN | Both must be HIGH to enable the H-bridge — check these pins |
| Common ground | Pi GND, BTS7960 logic GND, and motor battery GND MUST be joined |
| PWM frequency | Use pigpio hardware PWM at 20 kHz — software PWM causes jitter |
| Motor power | Check battery voltage at BTS7960 large screw terminals under load |
| Shoot-through | Never set RPWM and LPWM both HIGH — this causes a short |

---

#### Problem: Camera Module 3 not detected (libcamera-hello fails)

| Check | Solution |
|-------|----------|
| Ribbon cable orientation | Blue stripe faces USB ports on Pi 4 |
| Locking clip | Fully seated and locked — give it an extra push |
| Pi OS version | Use Bookworm (2023+) — Bullseye has older camera support |
| Verify: | `libcamera-hello --list-cameras` should list `imx708` |

---

#### Problem: SD card not mounting or file corruption

| Check | Solution |
|-------|----------|
| Format | Format as FAT32 on PC before use. exFAT will not work |
| SPI speed | Start at 400 kHz for init — SD.begin() handles this automatically |
| CS pin | Verify SD_CS (PB12) is separate from RFM69_CS (PA4) |
| file.close() | Always close the file after writing. Power loss with open file = corruption |
| Card size | Use cards ≤32 GB. Larger cards may need exFAT (unsupported) |

---

#### Problem: No data appearing on ground station browser

| Check | Solution |
|-------|----------|
| Serial port | Check `.env` SERIAL_PORT matches the actual port (`ls /dev/tty*`) |
| Baud rate | Ground station expects 115200 — match your transmitter |
| Radio receiver | The USB dongle (ground-side radio) must be plugged in |
| Simulation mode | Run `npm run sim` to see data without hardware |
| Browser | Open `http://localhost:3000` (not HTTPS, not a different port) |
| Socket.io | Check browser console for WebSocket connection errors |

---

#### Problem: Heltec LoRa v3 radio not working (state error on radio.begin())

| Check | Solution |
|-------|----------|
| TCXO voltage | If using raw RadioLib without heltec_unofficial: set `tcxoVoltage = 1.8` in `radio.begin()` |
| Library | Use `ropg/heltec_esp32_lora_v3` — Heltec's own library has bugs |
| Frequency | Set to 868.0 MHz for EU. 915.0 MHz for US hardware (order-specific) |
| Antenna | IPEX/U.FL LoRa antenna must be connected before TX |

---

#### Problem: ESP32-CAM not connecting to WiFi or camera init fails

| Check | Solution |
|-------|----------|
| Power supply | Must be **5V at 300+ mA** — 3.3V will not boot camera |
| GPIO0 | Remove GPIO0→GND wire after flashing before normal boot |
| Partition scheme | Use "Huge APP (3MB No OTA)" in Arduino IDE |
| PSRAM | Enable PSRAM in board settings — camera needs it for frame buffers |
| fb_count | Set `fb_count = 1` if no PSRAM available |

---

### 📐 Quick Sanity Checks Before Each Test

```
□  All GNDs connected to common rail
□  LM2596/XL6009 output voltage verified with multimeter BEFORE connecting loads
□  AMS1117 output reads 3.30V ± 0.07V
□  STM32 BOOT0 jumper in 0 (normal run) position
□  RFM69 VERSION register returns 0x24
□  MPU-6500 WHO_AM_I register returns 0x70
□  BMP388 reads plausible temperature (~20°C in room)
□  NEO-6M blue LED blinking (GPS fix acquired)
□  SD card mounted (file.open() succeeds)
□  LoRa antenna connected (transmitting without antenna damages SX1262)
□  Camera Module 3 ribbon cable fully seated and locked
□  All I2C lines have 4.7kΩ pull-up resistors to 3.3V
□  Ground station serial port set correctly in .env
□  npm install completed without errors
```

---

<div align="center">

---

```
     .       *          .        .       *
*        .      🚀           .       .
     .       ·    ·    ·           *       .
.        *       ·  · ·  ·    .       .
     .       ·  ·    · · · ·      *
*        ·  ·   · · · · · · ·        .
     · ·  · · · · · · · · · · · · ·
· · · · · · · · · · · · · · · · · · · ·
▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
```

**INVICTUS II — MACH-26 · UKSEDS NRC 2025–26**

*University of Birmingham Dubai*

*Per aspera ad astra — through hardship to the stars* 🌟

---

| Rover | NRC Satellite | CANSAT |
|:-----:|:-------------:|:------:|
| Raspberry Pi 4B | Heltec LoRa v3 | STM32 Bluepill |
| BTS7960 × 2 | SX1262 868 MHz | RFM69HCW 433 MHz |
| Camera Module 3 | BMP388 · NEO-6M | BMP388 · MPU-6500 |
| LM2596 5V PSU | LM75 · ESP32-CAM | NEO-6M · LM75 |
| 6 DC Motors | TP4056 · XL6009 | SD Card · AMS1117 |

</div>
```

Now let me save this file and push it to the repository: