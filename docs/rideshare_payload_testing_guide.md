# Rideshare Payload Testing Guide — NRC Invictus II

## Team Organization

### 🔧 Hardware Team (2–3 people)
| Role | Person | Responsibility |
|------|--------|----------------|
| **Hardware Lead** | — | Wiring, soldering checks, power-on sequencing |
| **Sensor Tech** | — | BMP280 / LM75 / GPS verification, SD card prep |
| **Integration** | — | Physical sled assembly, antenna placement, switch wiring |

**What they do today:**
- Assemble the payload sled with all components mounted
- Verify all wiring connections against the pin map below
- Power on the Heltec board and confirm OLED boot screen
- Check each sensor responds (watch Serial Monitor)
- Insert SD card (formatted FAT32) and confirm logging

### 💻 Software Team (1–2 people)
| Role | Person | Responsibility |
|------|--------|----------------|
| **Software Lead** | — | Flash firmware, run ground station, monitor dashboard |
| **Data Analyst** | — | Verify packet integrity, check DB entries, export CSV |

**What they do today:**
- Flash firmware to the Heltec V3 via USB-C
- Start the Node.js ground station backend
- Open the NRC dashboard in the browser
- Verify live telemetry appears on all 6 charts
- Test the launch command and flight phase transitions

---

## Hardware Setup — What to Connect

### Components on the Payload Sled

```
┌─────────────────────────────────────────────────────────┐
│                    PAYLOAD SLED                         │
│                                                         │
│  ┌──────────────┐   ┌─────────┐   ┌──────────┐        │
│  │ Heltec WiFi  │   │ BMP280  │   │  LM75    │        │
│  │ LoRa 32 V3   │   │ (Baro)  │   │  (Temp)  │        │
│  │ (ESP32-S3)   │   └────┬────┘   └────┬─────┘        │
│  │              │        │I2C          │I2C            │
│  │  ┌────────┐  │   SDA=GPIO1 ────────SDA              │
│  │  │SX1262  │  │   SCL=GPIO2 ────────SCL              │
│  │  │LoRa    │  │                                       │
│  │  │(onboard│  │   ┌─────────────┐                    │
│  │  └────────┘  │   │  NEO-6M GPS │                    │
│  │  ┌────────┐  │   │   (UART)    │                    │
│  │  │SSD1306 │  │   └──────┬──────┘                    │
│  │  │OLED    │  │   GPS TX → GPIO7 (ESP RX)            │
│  │  │(onboard│  │   GPS RX ← GPIO6 (ESP TX)            │
│  │  └────────┘  │                                       │
│  └──────┬───────┘   ┌──────────────┐                   │
│         │USB-C      │ SD Card Mod  │                   │
│         │           │   (SPI)      │                   │
│         │           └──────┬───────┘                   │
│         │           CS=GPIO38, SCK=GPIO39              │
│         │           MOSI=GPIO41, MISO=GPIO42           │
│                                                         │
│  ┌──────────────┐                                      │
│  │ Li-ion 2S    │→ BMS → Switch → LM2596 → 5V_BUS    │
│  │ Battery Pack │                          → 3V3_BUS   │
│  └──────────────┘                                      │
└─────────────────────────────────────────────────────────┘
```

### Physical Wiring Map (from [PAYLOAD_CIRCUIT.md](file:///Users/sakshammishra/Invictus-II/Invictus-II-1/backend/PAYLOAD_CIRCUIT.md))

| Heltec Pin | GPIO | Connected To | Purpose |
|-----------|------|-------------|---------|
| Pin 25 | GPIO1 | BMP280 SDA + LM75 SDA | I2C Data (shared bus) |
| Pin 24 | GPIO2 | BMP280 SCL + LM75 SCL | I2C Clock (shared bus) |
| Pin 19 | GPIO7 | NEO-6M TX | GPS data → ESP |
| Pin 20 | GPIO6 | NEO-6M RX | ESP → GPS commands |
| Pin 26 | GPIO38 | SD Card CS | Chip select |
| Pin 27 | GPIO39 | SD Card SCK | SPI clock |
| Pin 29 | GPIO41 | SD Card MOSI | SPI data out |
| Pin 30 | GPIO42 | SD Card MISO | SPI data in |
| Pin 2 | 5V | 5V_BUS | Main power rail |
| Pin 1 | GND | GROUND | Common ground |

### Power Chain
```
Battery (7.4V Li-ion 2S) → BMS → Toggle Switch → LM2596 (5V Buck) → 1000µF Cap → 5V_BUS
                                                                                     ↓
                                                                              3V3 (Heltec internal)
```

> [!IMPORTANT]
> **Before powering on:** Double-check that the LM2596 output is set to **5V** using a multimeter. Wrong voltage will destroy the Heltec board.

---

## Step-by-Step Testing Procedure

### Phase 1: Hardware Verification (Hardware Team)

```
Step 1: Visual inspection — check all solder joints, no shorts
Step 2: Multimeter continuity check on power rails (5V, 3V3, GND)
Step 3: Insert FAT32-formatted micro-SD card into the SD module
Step 4: Connect the Heltec V3 to laptop via USB-C cable
Step 5: DO NOT flip the battery switch yet — USB power only first
```

### Phase 2: Firmware Flash (Software Team)

**Option A — PlatformIO (recommended):**
```bash
cd firmware/nrc
pio run --target upload
```

If PlatformIO is not installed, install it before continuing. This competition checkout only supports telemetry from physical PCBs.

After flashing, open the serial monitor:
```bash
pio device monitor --baud 115200
```

### Phase 3: Serial Monitor Boot Check

When the Heltec powers on (via USB or battery), you'll see this exact output in the terminal:

```
ESP-ROM:esp32s3-20210327
Build:Mar 27 2021
rst:0x1 (POWERON),boot:0x8 (SPI_FAST_FLASH_BOOT)

[NRC] LoRa SX1262 OK @ 868 MHz       ← ✅ Radio working
[NRC] GPS UART1 started               ← ✅ GPS UART open (fix takes 30-90s)
[NRC] BMP280 OK @ 0x76                ← ✅ Barometer found on I2C
[NRC] LM75 OK (27.4°C)               ← ✅ Temp sensor responding
[NRC] SD card OK                      ← ✅ SD card mounted
[NRC] Setup complete — transmitting at 1 Hz
```

> [!WARNING]
> If any line says **FAILED**, check the wiring for that specific sensor:
> - `BMP280 FAILED` → Check GPIO1 (SDA) and GPIO2 (SCL) connections, check 0x76 address (SDO pin must be tied to GND)
> - `LM75 FAILED` → Same I2C bus, check 0x48 address
> - `SD card FAILED` → Check SPI wiring (GPIO38/39/41/42), reformat card to FAT32
> - `LoRa FAILED` → Internal to board, may indicate damaged Heltec board

### Phase 4: Live Telemetry on Terminal

After boot, the Heltec streams NRC2 packets at 1 Hz via USB Serial:

```
NRC2:1,1247,0.03,18.7,1014.23,0.000000,0.000000,-42,40,A3F1
NRC2:2,2251,0.05,18.8,1014.21,0.000000,0.000000,-42,40,B2C4
NRC2:3,3254,-0.02,18.6,1014.25,0.000000,0.000000,-42,40,1D87
NRC2:4,4258,0.01,18.7,1014.22,52.486243,-1.890401,-42,44,E5A2  ← GPS fix acquired!
NRC2:5,5261,0.04,18.8,1014.20,52.486245,-1.890399,-41,44,7F13
```

**Packet format breakdown:**
```
NRC2:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<CRC16_HEX>
```

**Flags byte meaning:**

| Bit | Hex | Flag | Meaning |
|-----|-----|------|---------|
| 0 | 0x01 | LAUNCHED | Altitude gained >10m for 3 consecutive readings |
| 1 | 0x02 | APOGEE | Altitude dropped >5m from peak |
| 2 | 0x04 | GPS_FIX | Valid GPS position (<2s old) |
| 3 | 0x08 | BARO_OK | BMP280 returning valid readings |
| 5 | 0x20 | SD_OK | SD card logging active |
| 6 | 0x40 | STALE_SENSOR | No baro reading for >3 seconds |

Common flag values:
- **40** = BARO + SD (no GPS yet)
- **44** = BARO + SD + GPS (ground idle, nominal)
- **45** = BARO + SD + GPS + LAUNCHED (ascending)
- **47** = BARO + SD + GPS + LAUNCHED + APOGEE (descending)

### Phase 5: Start the Ground Station Backend

Open a **new terminal** (keep serial monitor in the first):

```bash
cd /Users/sakshammishra/Invictus-II/Invictus-II-1

# Kill any existing server
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

# Start in REAL HARDWARE mode (reads from USB serial)
SERIAL_PORT_NRC=/dev/cu.usbmodem14201 node backend/server.js
```

> [!TIP]
> **Finding your USB port:** Run `ls /dev/cu.usb*` to see connected devices. The Heltec V3 typically shows up as `/dev/cu.usbmodem14201` or `/dev/cu.usbserial-*`.

> [!NOTE]
> If no Heltec is plugged in, the dashboard must show disconnected/lost hardware state. It must not generate replacement telemetry.

**Expected terminal output from the server:**

```
[INFO] MACH-26 Ground Station started { port: 3000, mode: 'hardware' }
[SERIAL] NRC port opened on /dev/cu.usbmodem14201 @ 115200
```

Then as packets arrive:
```
[NRC] pkt #1  alt=0.03m  temp=18.7°C  press=1014.23hPa  flags=0x28
[NRC] pkt #2  alt=0.05m  temp=18.8°C  press=1014.21hPa  flags=0x28
[NRC] pkt #4  alt=0.01m  GPS FIX → 52.486243, -1.890401  flags=0x2C
```

### Phase 6: Open the NRC Dashboard

Open Chrome and navigate to:

```
http://localhost:3000/nrc
```

**What you will see on the dashboard:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  NRC INVICTUS II                                    SYSTEM IDLE    │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  ALTITUDE    │  │ TEMPERATURE  │  │  PRESSURE    │             │
│  │  ↕ 0.03 m    │  │  🌡 18.7 °C  │  │  ⬡ 1014 hPa │             │
│  │  ┈┈┈┈┈┈┈┈┈┈  │  │  ┈┈┈┈┈┈┈┈┈  │  │  ┈┈┈┈┈┈┈┈┈  │             │
│  │  (flat line) │  │  (flat line) │  │  (flat line) │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │ ACCELERATION │  │     GPS      │  │  SIGNAL      │             │
│  │  → 0.0 m/s²  │  │  📍 waiting  │  │  📶 -42 dBm  │             │
│  │  ┈┈┈┈┈┈┈┈┈┈  │  │  (map view) │  │  ┈┈┈┈┈┈┈┈┈  │             │
│  │  (flat line) │  │             │  │  (stable)    │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                     │
│  PKT: 5  │  MAX ALT: 0.05m  │  STATUS: GPS ✅ BAR ✅ SD ✅      │
└─────────────────────────────────────────────────────────────────────┘
```

The dashboard updates **in real time** as each NRC2 packet arrives over the WebSocket connection.

---

## OLED Display on the Heltec Board

While the dashboard runs on the laptop, the **physical Heltec OLED** (0.96" screen on the board itself) shows:

```
┌──────────────────┐
│ NRC INVICTUS II  │
│ ALT: 0.0 m       │
│ MAX:0m           │  ← Big bold font (judges read this)
│ P:5 GPS BAR SD   │
└──────────────────┘
```

After a flight test (lifting the board up and down):
```
┌──────────────────┐
│ NRC INVICTUS II  │
│ ALT: 0.1 m       │
│ MAX:2m           │  ← Locked apogee value
│ P:42 GPS BAR SD  │
└──────────────────┘
```

> [!IMPORTANT]
> **The MAX value on the OLED is what the NRC judges read at recovery.** This value only ever increases during flight and is permanently locked once apogee is detected.

---

## How to Simulate a Flight (Bench Test)

Since you're indoors, validate altitude response by physically **lifting the board up** (changes barometric altitude):

1. Place the board flat on the table → altitude reads ~0.0m
2. Slowly raise the board to head height (~1.5m) → altitude climbs
3. Hold it there for 3+ seconds → firmware detects **LAUNCH** (if gain >10m, or lower the threshold temporarily)
4. Bring it back down → firmware detects **APOGEE** then **LANDED**

**Faster method — USB command:**
```bash
# In the serial monitor, type:
CMD:LAUNCH
```
The firmware responds:
```
ACK:LAUNCH,NRC
```
This force-triggers the launched state so the dashboard shows full flight phase progression.

**Dashboard during launch:**
```
SYSTEM IDLE → ASCENDING → APOGEE → DESCENDING → LANDED
     🟢           🟡          🔴         🟠          🟢
```

---

## SD Card Verification

After testing, power off the board and remove the SD card. The file `/flight.csv` will contain:

```csv
pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,rssi_dbm,flags
1,1247,0.03,18.7,1014.23,0.000000,0.000000,-42,40
2,2251,0.05,18.8,1014.21,0.000000,0.000000,-42,40
3,3254,-0.02,18.6,1014.25,52.486243,-1.890401,-42,44
...
```

You can also upload this CSV to the dashboard via the **Upload SD** button, which replays the data into the SQLite database.

---

## Complete Connection Diagram: Hardware ↔ Software

```
                         HARDWARE                          SOFTWARE
                    ┌─────────────────┐              ┌─────────────────┐
                    │  Li-ion Battery │              │                 │
                    │  7.4V 2S        │              │   LAPTOP        │
                    └────────┬────────┘              │                 │
                             │                       │  ┌───────────┐ │
                    ┌────────▼────────┐              │  │ PlatformIO│ │
                    │  Toggle Switch  │              │  │ (flash)   │ │
                    └────────┬────────┘              │  └─────┬─────┘ │
                             │                       │        │       │
                    ┌────────▼────────┐              │        │       │
                    │  LM2596 → 5V   │              │        │       │
                    └────────┬────────┘              │  ┌─────▼─────┐ │
                             │                       │  │ Serial    │ │
  ┌──────────┐    ┌──────────▼──────────┐  USB-C    │  │ Monitor   │ │
  │ BMP280   ├─I2C┤                     ├═══════════╪══┤ 115200    │ │
  │ LM75     ├─I2C┤   HELTEC LORA V3   │           │  │ baud      │ │
  │ NEO-6M   ├UART┤   (ESP32-S3)       │           │  └───────────┘ │
  │ SD Card  ├─SPI┤                     │           │                 │
  └──────────┘    │  SX1262 LoRa 868MHz ├── 🔊 ──┐ │  ┌───────────┐ │
                  │  SSD1306 OLED       │        │ │  │ Node.js   │ │
                  └─────────────────────┘        │ │  │ server.js │ │
                                                 │ │  │ :3000     │ │
                                                 │ │  └─────┬─────┘ │
                     (During real flight,        │ │        │       │
                      LoRa transmits to a        │ │  ┌─────▼─────┐ │
                      2nd Heltec on ground)       │ │  │ Dashboard │ │
                                                 │ │  │ nrc.html  │ │
                  ┌─────────────────────┐        │ │  │ (Chrome)  │ │
                  │  GROUND RECEIVER    │◄── 🔊 ─┘ │  └───────────┘ │
                  │  Heltec V3 #2       │           │                 │
                  │  (receives LoRa)    ├──USB-C────┤                 │
                  └─────────────────────┘           └─────────────────┘
```

**For today's bench test:** You only need **one** Heltec board connected via USB-C. The telemetry goes directly through the USB serial cable — no LoRa receiver needed. The server reads from `/dev/cu.usbmodem*` at 115200 baud.

---

## Quick Command Reference

| Task | Command |
|------|---------|
| Find USB port | `ls /dev/cu.usb*` |
| Flash firmware | `cd firmware/nrc && pio run --target upload` |
| Serial monitor | `pio device monitor --baud 115200` |
| Start server (hardware) | `SERIAL_PORT_NRC=/dev/cu.usbmodem14201 node backend/server.js` |
| Open dashboard | `http://localhost:3000/nrc` |
| Force launch command | Type `CMD:LAUNCH` in serial monitor |
| Export flight data | `http://localhost:3000/api/export?source=NRC` |
| Check server health | `curl http://localhost:3000/api/health` |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| OLED is blank | Check Vext pin (GPIO36) — must be LOW to enable OLED power |
| No serial output | Wrong baud rate — must be **115200**. Check USB-C cable supports data (not charge-only) |
| BMP280 FAILED | Verify SDO pin tied to GND (sets address 0x76). Check I2C pullup resistors |
| GPS shows 0,0 | Normal — GPS cold start takes 30-90 seconds outdoors. Won't fix indoors |
| SD card FAILED | Reformat to FAT32. Check wiring on GPIO38/39/41/42 |
| Dashboard shows no data | Confirm `SERIAL_PORT_NRC` env var matches your actual USB port |
| Server crashes on start | Run `npm install` in the backend directory first |
| "Port busy" error | Another process is using the port. Kill it: `lsof -ti:3000 \| xargs kill -9` |
