# NRC Rocket — The Definitive Guide

*Verified hardware, correct pin mapping, firmware walkthrough, testing procedures, and next steps.*

---

## The 3 Competitions — Where NRC Fits

| Competition | What Flies | Avionics Brain | Radio Link |
|---|---|---|---|
| **MachX** | Bigger rocket + CanSat inside | STM32 Bluepill + 4 PCBs | RFM69HCW 433 MHz |
| **NRC** *(this guide)* | Standalone smaller rocket | **Heltec WiFi LoRa 32 V3** | **LoRa 868 MHz (SX1262)** |
| **NRC Rover** *(later)* | Rocket + Rover deployment | RPi 4B + BTS7960 | WiFi |

> [!IMPORTANT]
> The NRC rocket has **no CanSat inside**. The Heltec board IS the rocket's flight computer. It reads sensors, logs to SD card, transmits telemetry over LoRa, and displays max altitude on the built-in OLED.

---

## Part 1: Hardware — What's On Board

### Your Circuit (verified)

![NRC Circuit Diagram](file:///Users/sakshammishra/.gemini/antigravity/brain/cdd71ba3-c241-47a5-8fe7-575e0bf55f91/nrc_correct_circuit_1780135345109.png)

### Component List

| Component | Role | Protocol | Power |
|---|---|---|---|
| **Heltec WiFi LoRa 32 V3** | Main MCU (ESP32-S3) + LoRa radio + OLED display | — | 5V from bus |
| **BMP280** | Barometric pressure → altitude + temperature | I2C (shared) | 3.3V from bus |
| **LM75** | Backup temperature sensor | I2C (shared) | 3.3V from bus |
| **NEO-6M** | GPS — latitude/longitude | UART | 5V from bus |
| **SD Card Module** | On-board flight data logging | SPI | 5V from bus |
| **ESP32-CAM** | Standalone camera (own SD card) | None — only power | 5V from bus |
| **LM2596** | Buck converter (7.4V → 5V) | — | — |
| **2S BMS** | Battery protection | — | — |
| **7.4V 2S LiPo** | Battery | — | — |

### Exact Pin Mapping (verified against your circuit)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     HELTEC WiFi LoRa 32 V3                             │
│                                                                         │
│  ┌── EXTERNAL WIRING ──────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │  I2C Bus (shared):  GPIO1 = SDA ─── BMP280 pin 4 + LM75 pin 3  │   │
│  │                     GPIO2 = SCL ─── BMP280 pin 3 + LM75 pin 4  │   │
│  │                                                                  │   │
│  │  GPS UART:          GPIO7 = RX  ←── NEO-6M TX (pin 3)          │   │
│  │                     GPIO6 = TX  ──→ NEO-6M RX (pin 2)          │   │
│  │                                                                  │   │
│  │  SD Card SPI:       GPIO38 = CS   ─── SD pin 6                  │   │
│  │                     GPIO39 = SCK  ─── SD pin 5                  │   │
│  │                     GPIO41 = MOSI ─── SD pin 4                  │   │
│  │                     GPIO42 = MISO ─── SD pin 3                  │   │
│  │                                                                  │   │
│  │  Power:             5V  ←── 5V_BUS                              │   │
│  │                     3V3 ──→ 3V3_BUS                             │   │
│  │                     GND ──→ GROUND                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌── INTERNAL (built into Heltec board — don't wire) ──────────────┐   │
│  │  LoRa SX1262:  NSS=8, DIO1=14, RST=12, BUSY=13                 │   │
│  │                SCK=9, MISO=11, MOSI=10                          │   │
│  │  OLED:         SDA=17, SCL=18, RST=21                           │   │
│  │  OLED power:   VEXT=GPIO36 (LOW=ON)                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### BMP280 Address Config

Your wiring determines the I2C address:
- **SDO → GND** → Address **0x76**
- **CSB → 3V3** → I2C mode enabled

### Power System

```
7.4V 2S LiPo ──→ BMS (B+/BM/B- to battery JST)
                    │
              P- ──→ LM2596 IN-
              P+ ──→ SWITCH ──→ LM2596 IN+
                                   │
                             OUT+ ──→ 5V_BUS ──→ all 5V devices
                             OUT- ──→ GND
                                 ┬
                          1000µF cap
                          (stabilizes 5V)
```

### ESP32-CAM — Standalone

The ESP32-CAM is **completely independent** from the Heltec. It:
- Only connects to 5V_BUS and GND (power only).
- Records video/images to its **own** SD card.
- Has no UART/I2C/SPI connection to the Heltec.
- Is placed at the bottom of the payload bay pointing down.

---

## Part 2: Firmware — What the Code Does

**Files:**
- [firmware/nrc/src/main.cpp](file:///Users/sakshammishra/Invictus-II/Invictus-II-1/firmware/nrc/src/main.cpp) — Flight firmware
- [firmware/nrc/platformio.ini](file:///Users/sakshammishra/Invictus-II/Invictus-II-1/firmware/nrc/platformio.ini) — Build config

### Libraries Used

| Library | Purpose | Why This One |
|---|---|---|
| **RadioLib** | SX1262 LoRa radio | The popular `LoRa.h` by Sandeep Mistry only supports SX127x chips. The Heltec V3 has an **SX1262** which requires RadioLib. |
| **Adafruit BMP280** | Barometer | Your sensor is a BMP280 (not BMP388). Different chip, different library. |
| **TinyGPSPlus** | GPS NMEA parsing | Same as the MachX CanSat firmware. |
| **U8g2** | OLED display | Supports the built-in SSD1306 display on the Heltec V3. |

### Setup — What Happens at Power-On

```
┌────────────────────────────────────────────────────────────┐
│                    POWER ON SEQUENCE                        │
├────────────────────────────────────────────────────────────┤
│  1. USB Serial @ 115200 baud (debug output)                │
│  2. Watchdog timer (5s) — auto-reboots if code hangs       │
│  3. VEXT pin → LOW (powers OLED + Vext rail)               │
│  4. OLED init → shows "NRC BOOTING..."                     │
│  5. LoRa SX1262 init:                                      │
│     └── 868 MHz, BW=125kHz, SF=9, CR=4/7, 14 dBm          │
│  6. GPS UART1 @ 9600 baud (GPIO7=RX, GPIO6=TX)             │
│  7. I2C bus (GPIO1=SDA, GPIO2=SCL) for BMP280 + LM75       │
│  8. BMP280 init @ address 0x76                              │
│  9. LM75 probe @ address 0x48                               │
│ 10. SD Card init on custom SPI bus                          │
│     └── Opens /flight.csv, writes CSV header                │
│ 11. OLED shows boot status:                                 │
│     ┌─────────────────────┐                                 │
│     │ NRC INVICTUS II     │                                 │
│     │ LoRa:OK  BMP:OK     │                                 │
│     │ SD:OK    GPS:WAIT   │                                 │
│     │ READY               │                                 │
│     └─────────────────────┘                                 │
└────────────────────────────────────────────────────────────┘
```

### Main Loop — Every 1 Second

```
GPS: Feed UART bytes to TinyGPSPlus
  │
  ▼
1 second elapsed?
  ├── No  ──→ Continue feeding GPS UART
  └── Yes ──→ Read BMP280 temperature, pressure, altitude
                │
                ▼
              First 20 packets?
                ├── Yes ──→ Average pressure to calibrate baseline
                └── No  ──→ Use baseline to calculate current altitude
                              │
                              ▼
                            Track maximum altitude
                              │
                              ▼
                            BMP temp == 0?
                              ├── Yes ──→ Read backup LM75 temperature
                              └── No  ──→ Proceed with BMP temperature
                                            │
                                            ▼
                                          Read GPS coordinates & lock age
                                            │
                                            ▼
                                          Launch detection (altitude > 10m)
                                            │
                                            ▼
                                          Apogee detection (drop of 5m from max)
                                            │
                                            ▼
                                          Build NRC2 packet string
                                            │
                                            ▼
                                          Calculate CRC16-CCITT checksum
                                            │
                                            ▼
                                          Transmit via LoRa (868 MHz)
                                            │
                                            ▼
                                          Log to SD Card (/flight.csv) & Print USB
                                            │
                                            ▼
                                          Update OLED screen status
                                            │
                                            ▼
                                          Pet WDT (Reset watchdog timer)
```

### The OLED Display — What Judges See

After landing, the rocket's OLED permanently shows:

```
┌─────────────────────┐
│ NRC INVICTUS II     │
│ ALT: 12.3 m         │   ← Current altitude
│ MAX: 670m           │   ← ⭐ This is what judges read (RPD-004)
│ P:842 GPS BAR SD    │   ← Status indicators
└─────────────────────┘
```

### LoRa Radio Settings

| Parameter | Value | Why |
|---|---|---|
| Frequency | 868 MHz | UK Ofcom IR2030 compliant. |
| Bandwidth | 125 kHz | Standard LoRa — good range. |
| Spreading Factor | SF9 | Balance of range (~5km LOS) vs speed. |
| Coding Rate | 4/7 | More error correction for reliability. |
| TX Power | 14 dBm | Max allowed under ETSI regulations. |
| Sync Word | 0x12 | Private network (avoids interference with other LoRa). |

---

## Part 3: The Telemetry Contract

### Packet Format

```
NRC2:42,42000,350.24,18.70,964.50,25.123400,55.567800,-64,12,7B3F\n
│    │  │      │      │     │      │         │          │   │  │
│    │  │      │      │     │      │         │          │   │  └── CRC16-CCITT (hex)
│    │  │      │      │     │      │         │          │   └── flags byte (decimal)
│    │  │      │      │     │      │         │          └── RSSI (dBm)
│    │  │      │      │     │      │         └── longitude
│    │  │      │      │     │      └── latitude
│    │  │      │      │     └── pressure (hPa)
│    │  │      │      └── temperature (°C)
│    │  │      └── altitude (m, from averaged baseline)
│    │  └── timestamp (ms since boot)
│    └── packet ID
└── "NRC2:" prefix (v2 with CRC + flags)
```

### Flags Byte

| Bit | Hex | Name | Meaning |
|---|---|---|---|
| 0 | 0x01 | `FLAG_LAUNCHED` | Altitude gain > 10m for 3 consecutive readings. |
| 1 | 0x02 | `FLAG_APOGEE` | Dropped 5m from max altitude. |
| 2 | 0x04 | `FLAG_GPS_FIX` | GPS has valid location, age < 2 seconds. |
| 3 | 0x08 | `FLAG_BARO_OK` | BMP280 returned valid data this cycle. |
| 5 | 0x20 | `FLAG_SD_OK` | SD card is mounted and writable. |
| 6 | 0x40 | `FLAG_STALE_SENSOR` | No BMP280 data for > 3 seconds. |

---

## Part 4: Backend Pipeline

The backend handles NRC packets identically to before — the firmware sends the same `NRC2:` format, just over LoRa instead of USB serial.

### How It Reaches the Backend

```
HELTEC LoRa V3 (in rocket)
    │
    │ LoRa 868 MHz radio wave (~5km range)
    ▼
GROUND STATION RECEIVER (USB LoRa dongle or 2nd Heltec board)
    │
    │ USB Serial → /dev/ttyUSB1 (or COM port)
    ▼
serial.js → ReadlineParser (splits on \n)
    │
    ▼
parser.js → parseNrc() validates CRC, splits CSV, returns JS object
    │
    ├──→ phase-tracker.js (flight state machine — now gets firmware flags!)
    ├──→ db.js (SQLite storage)
    └──→ Socket.io → nrc.html dashboard (real-time charts, map, KPIs)
```

---

## Part 5: What's Working vs What's Missing

### ✅ Already Working

- **LoRa SX1262 transmission:** Implemented via `radio.transmit()` in firmware.
- **BMP280 barometer:** Using the Adafruit_BMP280 library at I2C address `0x76`.
- **NEO-6M GPS:** Mapped to GPIO7 (RX) and GPIO6 (TX).
- **SD card logging:** Generates a CSV file (`/flight.csv`) with automatic header and flushes periodically.
- **LM75 temperature fallback:** Automatically probes `0x48` if the BMP280 fails.
- **OLED display:** Shows flight telemetry and health flags.
- **Watchdog timer:** A 5-second hardware task watchdog prevents system locks.
- **Launch/Apogee detection:** Altitude thresholds set `FLAG_LAUNCHED` and `FLAG_APOGEE` in firmware.
- **CRC16 integrity check:** Implemented in firmware and validated in the backend.

### 🔴 Still Missing

1. **Ground station receiver firmware:** A second 868 MHz LoRa receiver is required to pick up packets and forward them via USB to the ground laptop.
2. **NRC `.env` config:** The backend needs to know which serial port the 868 MHz ground station is plugged into (`SERIAL_PORT_NRC` and `SERIAL_BAUD_NRC`).

---

## Part 6: How to Flash and Test

### 1. Install PlatformIO

```bash
pip install platformio
```

### 2. Build the firmware

```bash
cd firmware/nrc
pio run
```

### 3. Flash to Heltec

```bash
pio run --target upload
```

### 4. Monitor serial output

```bash
pio device monitor --baud 115200
```

---

## Part 7: Realistic Hardware-in-the-Loop (HIL) Testing Plan

Since launching a rocket is a high-vibration, high-altitude, single-shot event, testing must be exhaustive. Below is the step-by-step diagnostic checklist.

```
                  ┌────────────────────────────────────────┐
                  │      NRC HIL DIAGNOSTIC CHECKLIST       │
                  └────────────────────────────────────────┘
                    │
                    ├── [1] Power & Buck Regulator Safe Test
                    ├── [2] Built-in WiFi Diagnostics AP
                    ├── [3] Syringe Pressure (Vacuum) Test
                    ├── [4] Thermal Failure Fallback Test
                    ├── [5] LoRa Field Range & Attenuation Test
                    ├── [6] G-Force & Vibration Stress Test
                    └── [7] Watchdog Timer (Hang) Recovery Test
```

### Phase 1: Power & Buck Regulator Safe Test (Before Booting)
*Never plug the 7.4V battery directly into the Heltec board.*
1. Disconnect the Heltec board from the circuit.
2. Plug in the 7.4V LiPo battery through the BMS module. Turn the switch **ON**.
3. Use a multimeter to measure the output pins of the **LM2596 buck converter**. 
4. Ensure the voltage is adjusted to exactly **5.0V** (turn the small brass screw on the blue potentiometer until it reads 5.0V). If it outputs 7.4V, it will destroy the Heltec.
5. Check for short circuits between the 5V_BUS, 3V3_BUS, and Ground.

### Phase 2: Built-in WiFi Diagnostics AP (Ground Testing Mode)
Because the Heltec WiFi LoRa 32 V3 has a dual-core ESP32-S3 chip, you can utilize its built-in WiFi to inspect hardware diagnostics in the field without plugging in a USB cable.

#### Testing Protocol:
1. Temporarily enable the WiFi configuration mode in firmware (by booting the Heltec with a jumper pulling a designated GPIO pin, e.g., GPIO0, to GND).
2. The board spins up a local WiFi Access Point: `NRC-Flight-Diagnostics`.
3. Connect your laptop or mobile phone to the SSID (Password: `invictus2`).
4. Navigate to `http://192.168.4.1` on your browser.
5. The local diagnostic web page will display:
   * **Sensor Checklists:** BMP280 status, LM75 status, SD card health, GPS satellite count.
   * **SD Card File Explorer:** Lets you download `/flight.csv` directly over WiFi after a test flight!
   * **Flight data download:** Use captured PCB logs for review; do not use software-generated launch data for competition preparation.
6. Disable WiFi (remove the jumper) before actual launch to conserve battery and eliminate RF noise.

### Phase 3: Syringe/Jar Pressure Test (State Machine Validation)
To verify that the flight computer correctly identifies **Launch** and **Apogee** without launching the rocket, apply real pressure changes to the BMP280:
1. Place the complete avionics bay (Heltec, BMP280, battery) inside a large, clear airtight jar, or seal the BMP280 module inside a large plastic syringe.
2. Monitor the real-time telemetry output on your ground station.
3. **Launch-equivalent pressure change:** Slowly pull the syringe plunger out (or draw air out of the jar). This creates a real pressure drop at the sensor.
   * Verify that when calculated altitude increases by > 10m, the telemetry string shows the `FLAG_LAUNCHED` bit (Bit 0) is set.
4. **Descent-equivalent pressure change:** Stop pulling the plunger and slowly push it back in, increasing pressure at the sensor.
   * Verify that as calculated altitude drops by > 5m from the peak, the telemetry string shows the `FLAG_APOGEE` bit (Bit 1) is set.
   * Confirm the built-in OLED screen locks the maximum altitude value.

### Phase 4: GPS Cold Start & Satellite Lock Test
1. Take the avionics bay outdoors into an open area with a clear view of the sky.
2. Turn the power switch **ON**.
3. **Cold Start Timing:** Track how long the NEO-6M takes to get a 3D satellite fix.
   * *First-time boot (Cold Start):* Can take up to 2–5 minutes.
   * *Subsequent boots (Warm Start):* Should take under 30 seconds due to the onboard backup battery.
4. Verify that when the LED on the NEO-6M starts blinking (indicating a fix), the telemetry string sets `FLAG_GPS_FIX` (Bit 2), and valid latitude/longitude coordinates replace the `0.000000` placeholders.

### Phase 5: Thermal Failure Fallback Test
1. Power up the avionics bay.
2. Heat up the BMP280 module using a hair dryer (or cool it with compressed air).
3. **Hardware Disconnection:** While the system is running, unplug the BMP280 module's I2C pins (SDA/SCL) or jump the CSB line to verify sensor-failure handling.
4. Verify the following:
   * Telemetry flag sets `FLAG_STALE_SENSOR` (Bit 6) to alert the ground crew.
   * The temperature reading instantly falls back to the secondary **LM75 sensor**.
   * The system does not lock up or crash.

### Phase 6: LoRa Field Range & Attenuation Test
1. Place the rocket avionics bay in a fixed location outdoors.
2. Carry the ground station receiver (Option A or B) and walk away in a straight line-of-sight path.
3. Keep track of the **RSSI** (signal strength) and **SNR** (signal-to-noise ratio) printed on the telemetry packet:
   * **RSSI > -90 dBm:** Excellent link.
   * **RSSI -90 to -115 dBm:** Good link, telemetry will be received.
   * **RSSI < -120 dBm:** Borderline limit; packet loss may occur.
4. If range is poor, check that your LoRa antenna length is tuned precisely to 86.8 mm (1/4 wave wire antenna) or that your SMA antenna is rated for 868 MHz (not 2.4 GHz or 433 MHz).

### Phase 7: Mechanical G-Force & Vibration Stress Test
Rocket launches produce intense vibrations (up to 15G). You must ensure no components come loose.
1. Seal your complete avionics bay.
2. Turn on the system and ensure it is logging data to the SD card.
3. Perform a **Stress Shake Test:** Vigorously shake the avionics bay for 60 seconds to validate connector and SD-card retention under vibration.
4. Unpack the bay and check the logs:
   * **Power Stability:** Ensure the board did not reboot (timestamp did not reset to 0). If it did, add hot glue or solder joints to the battery switch and JST connector.
   * **SD Card Continuity:** Check `/flight.csv` to confirm that logging did not stop. Micro-SD cards inside standard spring-loaded slots can lose contact under high-vibration unless taped down securely.
   * **I2C Integrity:** Confirm that the BMP280 did not throw sensor errors.

### Phase 8: Watchdog Timer Recovery Test
1. Insert a temporary test loop in the firmware main loop that forces a system hang (e.g. `while(true) {}`) when a button is pressed or after 60 seconds.
2. Run the system. When the freeze is triggered, verify that:
   * Telemetry stops for exactly **5 seconds**.
   * The hardware **Watchdog Timer** expires.
   * The ESP32-S3 automatically restarts, re-initializes all sensors, mounts the SD card, and resumes transmitting telemetry packets seamlessly.
