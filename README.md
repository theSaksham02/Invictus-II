# 🚀 Invictus II: MACH-26 Ground Station

![Node.js](https://img.shields.io/badge/Node.js-20_LTS-green?style=for-the-badge&logo=nodedotjs)
![Express.js](https://img.shields.io/badge/Express-4.x-lightgrey?style=for-the-badge&logo=express)
![Socket.io](https://img.shields.io/badge/Socket.io-4.x-black?style=for-the-badge&logo=socketdotio)
![SQLite](https://img.shields.io/badge/SQLite-3-blue?style=for-the-badge&logo=sqlite)

Welcome to the **Invictus II Ground Station**, developed for the **UKSEDS National Rocketry Championship 2025-26** by the University of Birmingham Dubai. 

This repository contains the high-performance, real-time backend and interactive dashboard infrastructure for monitoring and controlling our competition rocket, CANSAT, and ORT Rover.

---

## 🌟 Interactive Mission Control

The Invictus II project isn't just a static logger—it's a fully **interactive telemetry and control hub**. 

* **Real-Time Telemetry:** Live ingestion and WebSocket broadcasting of flight data at 9600 baud.
* **Flight Phase Detection:** Automatic detection of state changes (IDLE ➔ LAUNCHED ➔ ASCENDING ➔ APOGEE ➔ DESCENDING ➔ LANDED).
* **Multi-Source Tracking:** Seamlessly integrates data from the CANSAT (433MHz) and the NRC Satellite (868MHz LoRa).
* **ORT Rover Integration:** Proxies HTTP control commands directly to our remote Raspberry Pi-driven rover.
* **Simulation Mode:** Don't have the hardware plugged in? Run a full parabolic flight simulation to test the UI and logic interactively.

## 🏗 Architecture Overview

```text
[CANSAT (STM32 + RFM69HCW)]  => (433MHz Serial)  => [Node.js Backend] => (SQLite)
[NRC Sat (Heltec LoRa v3)]  => (868MHz Serial)  => [Node.js Backend] => (Socket.io) => [Interactive Dashboard]
[ORT Rover (RPi Flask)]     <= (WiFi HTTP)      <= [Node.js Backend] <= (HTTP POST) <= [Interactive Dashboard]
```

## 🚀 Getting Started

### Prerequisites
* Node.js 20 LTS
* NPM
* A USB Serial adapter (if running with live hardware)

### 1. Installation

```bash
git clone https://github.com/theSaksham02/Invictus-II.git
cd Invictus-II/backend
npm install
```

### 2. Configuration
Copy the sample environment file and configure it for your local machine:
```bash
cp .env.example .env
```
*Note: Update `SERIAL_PORT_CANSAT` and `SERIAL_PORT_NRC` to match your OS (`/dev/ttyUSB*` for Linux/Mac, `COM*` for Windows).*

### 3. Run the Server

**Hardware Mode (Live Serial Data):**
```bash
npm run dev
```

**Interactive Simulation Mode (Mock Flight Data):**
```bash
npm run sim
```

## 📡 API & WebSocket Reference

### REST Endpoints
* `GET /api/health` - System status and uptime.
* `GET /api/packets?source=CANSAT&limit=200` - Retrieve historical packet data.
* `GET /api/stats` - Mission statistics (Max Alt, Min Temp, Packet Counts).
* `GET /api/export` - Download telemetry as CSV.
* `POST /api/upload-sd` - Post-flight SD card CSV ingestion.
* `POST /api/rover/control` - `{ left: 100, right: -100 }` - Command the rover.

### Socket.io Events (Real-Time)
* **`packet`**: Emitted on every new telemetry packet.
* **`mission_event`**: Emitted on phase transitions (e.g., Apogee reached).
* **`signal_lost` / `signal_recovered`**: Emitted if data drops for > 5 seconds.

## 🛠 Hardware Context

* **CANSAT**: Transmits a 32-byte packed binary struct containing Altitude, Temp, Pressure, IMU (Accel/Gyro), GPS, RSSI, and checksum flags.
* **NRC Satellite**: Transmits ASCII CSV string starting with `NRC:`.

## 🤝 Contributing
For the Invictus II team: Ensure all changes strictly maintain the binary struct alignment, do not introduce blocking asynchronous calls in the hot path, and maintain graceful error handling. 
