<div align="center">

```
 ██╗███╗   ██╗██╗   ██╗██╗ ██████╗████████╗██╗   ██╗███████╗    ██╗ ██╗
 ██║████╗  ██║██║   ██║██║██╔════╝╚══██╔══╝██║   ██║██╔════╝    ██╗ ██╗
 ██║██╔██╗ ██║██║   ██║██║██║        ██║   ██║   ██║███████╗    ██╗ ██╗
 ██║██║╚██╗██║╚██╗ ██╔╝██║██║        ██║   ██║   ██║╚════██║    ██╗ ██╗
 ██║██║ ╚████║ ╚████╔╝ ██║╚██████╗   ██║   ╚██████╔╝███████║    ██╗ ██╗
 ╚═╝╚═╝  ╚═══╝  ╚═══╝  ╚═╝ ╚═════╝   ╚═╝    ╚═════╝ ╚══════╝    ██╗ ██╗
```

# 🚀 MACH-26 · UKSEDS NRC 2025–26

**Competition rocketry avionics · Flight data logging · Ground station software**

*University of Birmingham Dubai*

---

![Stars](https://img.shields.io/github/stars/theSaksham02/Invictus-II?style=for-the-badge&color=FFD700&logo=starship&label=⭐%20STARS)
![Node.js](https://img.shields.io/badge/Node.js-20_LTS-3C873A?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-010101?style=for-the-badge&logo=socketdotio&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-3-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![STM32](https://img.shields.io/badge/STM32-Bluepill-03234B?style=for-the-badge&logo=stmicroelectronics&logoColor=white)
![Raspberry Pi](https://img.shields.io/badge/RPi-4B-C51A4A?style=for-the-badge&logo=raspberrypi&logoColor=white)
![Mission](https://img.shields.io/badge/Mission-ACTIVE-00FF88?style=for-the-badge&logoColor=white)

</div>

---

<div align="center">

```
     *        .              .      .       *       .
  .        .    *     .   🪐          .       .         *
      .              *        .    ✨        *     .
  *      .    ✨         .         .    *          .
    .        .     *        .  🌟      .     *        .
         *       .     .        *           .     *
```

</div>

---

## 🌌 Mission Overview

> *"One flight. Live rideshare telemetry. SD recovery backup."*

**INVICTUS II** is the complete avionics and ground station stack for three UKSEDS competitions:

| Competition | Vehicle | Avionics |
|---|---|---|
| **MachX** | Bigger rocket + CanSat inside | STM32 Bluepill · RFM69HCW 433MHz |
| **Mach-X Rideshare** | Smaller standalone rocket payload | Heltec LoRa V3 · live telemetry + SD/OLED backup |
| **NRC Rover** | Rocket + Rover deployment (later) | RPi 4B · Flask · BTS7960 |

```
Target Altitude  →  2,200 ft (670 m)
Telemetry Rate   →  1 Hz live telemetry + SD logging
Radio Links      →  433 MHz RFM69 for MachX CanSat, 868 MHz SX1262 for Mach-X Rideshare
Ground Station   →  Node.js · SQLite · Socket.io for MachX CanSat + Mach-X Rideshare
Rover            →  Raspberry Pi 4B · Flask · BTS7960 · Camera Module 3
```

---

## 🛰️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        🚀  IN FLIGHT                            │
│                                                                 │
│   ┌──────────────────┐         ┌─────────────────────────┐     │
│   │  STM32 BLUEPILL  │         │   HELTEC LoRa V3        │     │
│   │  (MachX CanSat)  │         │   (Mach-X Rideshare)    │     │
│   │  BMP388 · MPU6500│         │   BMP280 · NEO-6M       │     │
│   │  RFM69HCW 433MHz │         │   SD card + OLED        │     │
│   └────────┬─────────┘         └──────────┬──────────────┘     │
│            │ 43-byte binary v2             │  MXR3 live ASCII   │
│            │ CRC16-CCITT                   │  CRC16 + SD/OLED backup │
└────────────┼───────────────────────────────┼────────────────────┘
             │                               │
             ▼                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    💻  GROUND STATION                           │
│                                                                 │
│   MachX USB ──► serial.js ──► parser.js ──► phase-tracker.js   │
│   Rideshare ──► serial.js ──► parser.js ──► phase-tracker.js   │
│   SD CSV ─────► upload API ─► SQLite ─────► recovery fallback   │
│                                    │                            │
│                         ┌──────────┼──────────┐                │
│                         ▼          ▼           ▼                │
│                      db.js    socket.io    REST API             │
│                     SQLite    broadcast    Express 4            │
│                         │          │           │                │
│                         └──────────┴───────────┘                │
│                                    │                            │
│                                    ▼                            │
│              ┌──────────────────────────────────────┐          │
│              │   🖥️  BROWSER DASHBOARD               │          │
│              │   MachX CanSat · Mach-X Rideshare · ROVER │       │
│              └──────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
             ▲
             │ WiFi HTTP
┌────────────┴────────────┐
│  🤖  ORT ROVER (RPi 4B) │
│  Flask · BTS7960 x2     │
│  6 Motors · Camera M3   │
└─────────────────────────┘
```

---

## 🔧 Hardware Stack

<div align="center">

| System | Brain | Radio | Sensors | Notes |
|---|---|---|---|---|
| 🚀 **MachX CanSat** | STM32 Bluepill | RFM69HCW 433MHz | BMP388, MPU-6500, NEO-6M, LM75 | 43-byte binary v2 packet |
| 🛰️ **Mach-X Rideshare** | Heltec LoRa V3 (ESP32-S3) | SX1262 868MHz + SD card | BMP280, NEO-6M, LM75 | Live `MXR3:` telemetry + SD/OLED backup |
| 🤖 **NRC Rover** *(later)* | Raspberry Pi 4B | WiFi | BTS7960 x2, Camera M3 | Flask HTTP server |
| ⚡ **Power** | TP4056 → XL6009 → AMS1117 | — | — | 45 min endurance |

</div>

---

## ⚡ Quick Start

### Prerequisites

```bash
node --version   # v20 LTS required
npm --version    # v9+ required
```

### 🖥️ Ground Station — 3 Commands

```bash
# 1. Clone & install
git clone https://github.com/theSaksham02/Invictus-II.git
cd Invictus-II/backend
npm install

# 2. Configure
cp .env.example .env
# → Set SERIAL_PORT_CANSAT and SERIAL_PORT_RIDESHARE to different active receivers. Mach-X Rideshare live ingest is on by default.

# 3. Start the monitoring software
npm start
# → http://localhost:3000
# Launch is controlled by an external device; this software only receives and displays telemetry.
```

### 🧪 Simulation Mode (No Hardware Needed)

```bash
npm run sim
# Streams a full parabolic flight at 1Hz
# Open http://localhost:3000 — watch altitude climb to 670m and back
```

### 🤖 ORT Rover (Raspberry Pi)

```bash
pip install flask picamera2 RPi.GPIO
python3 firmware/rover/app.py
# → Accessible at 192.168.4.1:5000
```

---

## 📡 API Reference

### REST Endpoints

```
GET  /api/health          →  System status, uptime, signal state
GET  /api/packets         →  ?source=CANSAT&limit=200&since=0
GET  /api/stats           →  Max alt, min temp, packet counts per source
GET  /api/export          →  ?source=CANSAT → downloads flight.csv
POST /api/upload-sd       →  Multipart: SD card CSV file
GET  /api/sd-uploads/:id/packets → Full packet set for an uploaded SD file
POST /api/rover/control   →  { left: 100, right: -100 }
POST /api/rover/stop      →  Emergency stop
GET  /api/rover/data      →  Rover sensor readings
```

### Socket.io Events

```
← packet              Live MachX CanSat and Mach-X Rideshare telemetry packets
← mission_event       IDLE→LAUNCHED→ASCENDING→APOGEE→DESCENDING→LANDED
← signal_lost         No packet received for 5 seconds
← signal_recovered    Signal resumed after gap
← sd_upload_complete  SD card CSV processed
← history             Sent on connect: last 60 packets + all events

→ subscribe_source    { source: "CANSAT" | "RIDESHARE" | "MACHX" | "ALL" }
→ request_history     { source, limit }
```

---

## 📦 Packet Specification

### CANSAT — 43-byte Binary v2 (Little-Endian)

```
Offset  Size  Type     Field
──────  ────  ───────  ─────────────────────────────
0       2     uint16   sync = 0xA55A
2       1     uint8    version = 2
3       1     uint8    source_id = 1
4       1     uint8    payload_len = 36
5       2     uint16   pkt_id
7       4     uint32   timestamp_ms
11      4     float32  altitude_m
15      4     float32  temp_c
19      4     float32  pressure_hpa
23      4     float32  accel_z
27      4     float32  gyro_x
31      4     float32  lat
35      4     float32  lon
39      1     int8     rssi_dbm
40      1     uint8    flags
41      2     uint16   crc16_ccitt over bytes 0-40
```

### Mach-X Rideshare — Live MXR3 + SD Recovery CSV

Live packets from the Heltec payload use `MXR3:` over SX1262 LoRa to a second Heltec ground receiver, which forwards valid lines to USB serial. Legacy `MXR2:`, `NRC:`, and `NRC2:` captures are still accepted as compatibility aliases.

```text
MXR3:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<lm75_temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_hex>
```

CanSat and rideshare use completely separate live receivers and both must be connected to the backend host when both sources are active. Rideshare ESP32-CAM video is saved locally on the camera SD card; it is not transmitted live.

The same payload also writes a recovery CSV to SD:

```
pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,flags,max_altitude_m,apogee_detected
```

Set `ENABLE_RIDESHARE_LIVE=false` only when intentionally disabling the Mach-X Rideshare live serial ingest for bench isolation. Legacy `ENABLE_NRC_LIVE=false` is still accepted as a fallback.

---

## 🏆 Competition Requirements

<div align="center">

| REQ ID | Description | Implementation | Status |
|---|---|---|---|
| RPD-003 | Altitude plot within 10 min of recovery | SD card CSV drag-drop → auto-chart | ✅ COVERED |
| RPD-004 | Apogee on display, no laptop | Heltec latches apogee to SSD1306 OLED | ✅ COVERED |
| CPD-001 | Customer payload 3.5–5V DC | XL6009 boost → regulated XT30 | ✅ COVERED |
| CPD-002 | Power for 45 minutes minimum | Bench tested with dummy load | ✅ COVERED |
| ESS-001 | Electronics on 15 min before launch | No sleep mode, idle loop | ✅ COVERED |
| ESS-002 | Full arming under 5 minutes | External switch, no disassembly | ✅ COVERED |
| ESS-004 | Ofcom IR2030 — 433/868MHz only | Hardcoded in firmware | ✅ COVERED |
| SMN-001 | Rail exit velocity ≥ 20 m/s | accel_z > 2.5g × 3 consecutive reads | ⚠️ VERIFY |

</div>

---

## 🗂️ Repository Structure

```
Invictus-II/
│
├── 📁 backend/
│   ├── server.js          ← Express + Socket.io entry point
│   ├── db.js              ← SQLite schema + queries
│   ├── parser.js          ← Binary CANSAT + Mach-X Rideshare ASCII parser
│   ├── serial.js          ← SerialPort + auto-reconnect
│   ├── phase-tracker.js   ← Flight state machine (per source)
│   ├── rover-proxy.js     ← HTTP proxy → RPi Flask
│   ├── package.json
│   └── .env.example
│
├── 📁 dashboard/          ← ✅ Operational
│   ├── index.html
│   ├── nrc.html           ← Legacy redirect to /mach-x-rideshare
│   ├── ort.html
│   └── mach-x.html
│
├── 📁 firmware/           ← ✅ Operational
│   ├── cansat/            ← STM32duino (PlatformIO)
│   ├── nrc/               ← Heltec Mach-X Rideshare live telemetry + SD/OLED backup
│   └── rover/             ← RPi Flask Control
│
└── README.md
```

---

## 🛠️ Development Notes

### TODO

- ✅ Push competition-specific dashboards
- ✅ Push `firmware/` — STM32, Heltec LoRa V3, Rover code
- ✅ Add `.gitignore` — protect `flight.db`, `.env`, `uploads/`, `node_modules/`
- ✅ Hardware-verify `SMN-001` rail exit velocity flag

### Recently Fixed

- ✅ `emitToAll` ordering bug — socket source filtering now applies to serial packets
- ✅ `signal_lost` watchdog — 5s timeout, per source, with `signal_recovered`
- ✅ Graceful `SIGINT` shutdown — serial port + SQLite released cleanly

---

## 👨‍🚀 Team

**University of Birmingham Dubai — UKSEDS NRC 2025–26**

> *Per aspera ad astra — through hardship to the stars* 🌟

---

<div align="center">

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

**Node.js · STM32duino · Heltec ESP32-S3 · Raspberry Pi · Chart.js · Socket.io**

![Visitors](https://visitor-badge.laobi.icu/badge?page_id=theSaksham02.Invictus-II&style=for-the-badge)

</div>
