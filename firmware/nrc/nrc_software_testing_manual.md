# NRC Rocket Avionics: Software Engineering & Hardware-in-the-Loop (HIL) Testing Manual

This manual provides a step-by-step framework to verify, stress-test, and validate the fully soldered NRC Rocket Avionics stack. Use this guide to prove to judges, team members, and flight safety officers that your software and hardware systems are zero-failure ready.

---

## 1. System Architecture & Zero-Failure Mindset

```
                  ┌────────────────────────────────────────────────┐
                  │          NRC FLIGHT STATE MACHINE              │
                  └────────────────────────────────────────────────┘
                                           │
                                           ▼
                                    [STATE: PRE_FLIGHT]
                               (Baseline calibration, 1Hz TX)
                                           │
                        Altitude gain > 10m for 3 consecutive ticks
                                           │
                                           ▼
                                    [STATE: POWERED_FLIGHT]
                             (Fast tracking, SD write, 1Hz TX)
                                           │
                       Altitude drops > 5m from recorded maximum
                                           │
                                           ▼
                                    [STATE: APOGEE_REACHED]
                             (Lock max altitude on OLED, 1Hz TX)
                                           │
                          Altitude remains flat for 20 seconds
                                           │
                                           ▼
                                      [STATE: LANDED]
                         (Permanently freeze OLED with peak alt)
```

As a Software Architect, you must design for physical flight anomalies:
1. **Determinism:** The main loop executes every 1000ms using non-blocking timers (`millis()`), ensuring GPS parsing doesn't starve I2C or LoRa routines.
2. **Watchdog Restarts (WDT):** If the ESP32 hangs due to an I2C bus lock, a hardware watchdog reboots the system in under 5 seconds. Baseline calibrations are preserved to ensure recovery mid-flight.
3. **Sensor Redundancy:** If the primary BMP280 temperature sensor yields `0.00°C` or disconnects, the code hot-swaps to the secondary LM75 sensor without dropping a single packet.

---

## 2. Command Line Interface (CLI) Toolkit

This section details how to compile, flash, and test the software via the command line on macOS.

### 2.1 Installing PlatformIO Core (From Scratch)
Ensure Python 3 is installed, then run:

```bash
# Install PlatformIO via pip
pip3 install -U platformio

# Verify the installation and check the version
pio --version
```

**Expected Terminal Response:**
```text
PlatformIO Core, version 6.1.15
```

---

### 2.2 Board Information & Port Scan
To find which USB serial port your Heltec V3 is plugged into:

```bash
pio device list
```

**Expected Terminal Response:**
```text
/dev/cu.usbserial-0001
----------------------
Hardware ID: USB VID:PID=303A:1001 SER=0001 LOCATION=20-1
Description: ESP32S3 Dev Product
```

---

### 2.3 Compiling the Firmware
Navigate to the NRC directory and compile the source code:

```bash
cd firmware/nrc
pio run
```

**Expected Terminal Response:**
```text
Processing heltec_wifi_lora_32_V3 (platform: espressif32; board: heltec_wifi_lora_32_V3; framework: arduino)
---------------------------------------------------------------------------------------------------------
Tool Manager: Installing toolchain-xtensa-esp32s3 @ 8.4.0+2021r2-patch5
LDF: Library Dependency Finder -> https://bit.ly/ltd-lib-finding
Compiling .pio/build/heltec_wifi_lora_32_V3/src/main.cpp.o
Archiving .pio/build/heltec_wifi_lora_32_V3/libFrameworkArduino.a
Linking .pio/build/heltec_wifi_lora_32_V3/firmware.elf
Building .pio/build/heltec_wifi_lora_32_V3/firmware.bin
===================================== [SUCCESS] Took 12.45 seconds =====================================
```

---

### 2.4 Uploading (Flashing) to Hardware
Upload the binary to the connected Heltec board:

```bash
pio run --target upload
```

**Expected Terminal Response:**
```text
Configuring upload port...
Auto-detected: /dev/cu.usbserial-0001
Uploading .pio/build/heltec_wifi_lora_32_V3/firmware.bin
esptool.py v4.5.1
Serial port /dev/cu.usbserial-0001
Connecting...
Writing at 0x00010000... (100 %)
Wrote 262144 bytes at 0x00010000 in 3.4 seconds (effective 616.8 kbit/s)...
Hash of data verified.

Leaving...
Hard resetting via RTS pin...
===================================== [SUCCESS] Took 6.12 seconds =====================================
```

---

### 2.5 Serial Monitoring
Inspect real-time telemetry and debugging statements directly from the ESP32:

```bash
pio device monitor --baud 115200
```

**Expected Terminal Response:**
```text
--- Terminal on /dev/cu.usbserial-0001 | 115200 8-N-1 ---
--- Quit: Ctrl+C | Menu: Ctrl+T | Help: Ctrl+H ---
[NRC] Hardware boot starting...
[NRC] Watchdog Timer (WDT) initialized: 5000ms
[NRC] OLED initialized (SSD1306 SSD1306)
[NRC] LoRa SX1262 OK @ 868 MHz (RadioLib)
[NRC] GPS UART1 started (GPIO7=RX, GPIO6=TX)
[NRC] BMP280 initialized @ Address 0x76
[NRC] LM75 probed @ Address 0x48 (23.50 C)
[NRC] SD card initialized (SPI HSPI CS=38)
[NRC] Setup complete. Transmitting telemetry...
NRC2:1,1000,0.12,23.50,1013.25,0.000000,0.000000,0,40,A3F2
NRC2:2,2001,0.15,23.48,1013.24,0.000000,0.000000,-42,40,B1C7
```

---

## 3. In-Situ Hardware-in-the-Loop (HIL) Soldered Tests

Since your entire system is soldered together as a single unit, you cannot safely isolate or disconnect individual wires. These tests use physical stimulation and software diagnostics to check every soldered pad.

### 3.1 Cold Continuity Safety Test
*Always run this test after any modifications or rough handling before turning on the power switch.*

```
                       [MULTIMETER CONTINUITY CHECK]
 
             Black Probe ──→ Ground Pin (GND)
             Red Probe   ──→ 5V Bus (LM2596 Output Solder Joint)
 
             EXPECTED STATUS: SILENT (Open Circuit)
```

If your multimeter beeps, do not turn the switch on. There is a microscopic solder bridge between power and ground that will damage the Heltec board.

---

### 3.2 The Temperature Finger Test (First Power-Up)
1. Keep your index finger lightly resting on the Heltec ESP32-S3 metal shield.
2. Flip the battery slide switch to **ON**.
3. Keep your finger in place for 5 seconds.
4. **Assessment:** If the chip gets hot to the touch, turn the switch **OFF** immediately. A hot chip indicates reversed polarity or a signal pin bridged directly to 5V. If it remains cold or slightly warm, the power routing is secure.

---

### 3.3 I2C Solder Joint Test (BMP280 & LM75 Validation)
Both the BMP280 and LM75 share the I2C bus on **GPIO1 (SDA)** and **GPIO2 (SCL)**.
* **The Method:** Run the diagnostics web interface or pio monitor.
* **Verification:**
  * **Pass:** Telemetry displays changing temperature and pressure values.
  * **Fail:** If telemetry shows `0.00 hPa` or `FLAG_STALE_SENSOR` is set, there is a bad solder joint. Examine the SDA and SCL pins on the BMP280 under magnification.

---

### 3.4 GPS Solder Joint Test (NEO-6M UART Validation)
The GPS module uses **GPIO7 (RX)** and **GPIO6 (TX)**.
* **The Method:** Power on the avionics outdoors.
* **Verification:**
  1. The NEO-6M has a physical red LED. If this LED is completely off, it is not receiving 5V power. Check the soldered VCC and GND wires.
  2. If the GPS LED blinks (fix acquired) but your telemetry continues to transmit `0.000000,0.000000` (no coordinates) with the `FLAG_GPS_FIX` bit set to 0, the soldered TX wire on the GPS module is loose or cold-soldered.

---

### 3.5 SD Card SPI Solder Joint Test
The SD card module operates on a dedicated hardware SPI bus: **GPIO38 (CS)**, **GPIO39 (SCK)**, **GPIO41 (MOSI)**, **GPIO42 (MISO)**.
* **The Method:** Check telemetry.
* **Verification:**
  * The flag `FLAG_SD_OK` (Bit 5, value `0x20`) must be active in the flags byte.
  * Remove the SD card, plug it into your computer, and check `/flight.csv`. The file structure should appear as follows:

```csv
packet_id,timestamp,altitude,temp,pressure,latitude,longitude,rssi,flags,crc
1,1000,0.12,23.50,1013.25,0.000000,0.000000,0,40,A3F2
2,2001,0.15,23.48,1013.24,0.000000,0.000000,-42,40,B1C7
```

---

### 3.6 Airtight Pressure Chamber Test (State Machine Verification)
*Validate launch and apogee flight logic without launch hardware.*

```
   ┌─────────────────────────────────────────────────────────────┐
   │                  AIRTIGHT ZIPLOC BAG TEST                   │
   ├─────────────────────────────────────────────────────────────┤
   │                                                             │
   │   ┌───────────────────────────┐                             │
   │   │   NRC SOLDERED AVIONICS   │                             │
   │   └───────────────────────────┘                             │
   │                ▲                                            │
   │                │                                            │
   │   [Vacuum: Altitude Rises]                                  │
   │   [Pressure: Altitude Drops]                                │
   │                │                                            │
   │                ▼                                            │
   │        ======(Straw)====== ──→ Gently draw/push air         │
   │                                                             │
   └─────────────────────────────────────────────────────────────┘
```

1. Place the entire powered, soldered avionics bay into a clear Ziploc bag.
2. Seal the bag around a plastic straw and tape the entry point to ensure it is airtight.
3. **Simulate Ascent:** Gently suck air out through the straw to create a partial vacuum.
   * **Result:** The telemetry dashboard must display an altitude increase. Once calculated altitude climbs by > 10m, the `FLAG_LAUNCHED` bit (Bit 0) must change to green.
4. **Simulate Descent:** Stop sucking air and blow gently into the straw to increase the internal pressure.
   * **Result:** Calculated altitude will drop. As it falls by > 5m from its peak, the `FLAG_APOGEE` bit (Bit 1) must trigger, and the Heltec OLED screen must permanently lock and display the peak altitude.

---

### 3.7 Vibration Cold Joint Check
*Simulate rocket engine burn and aerodynamic buffet (10G–15G).*
1. Ensure the system is powered on and actively writing to the SD card.
2. Vigorously shake the soldered assembly for 45 seconds.
3. Use a plastic screwdriver handle to gently tap on the soldered points of the battery switch, LM2596, and Heltec pins.
4. **Evaluation:** The Heltec screen must not flicker, the system must not reboot (confirm the timestamp did not reset to 0), and `/flight.csv` must write without interruption. If it reboots, reflow the power joints.

---

## 4. LoRa RF Range & Telemetry Validation

Your Heltec V3 features a high-performance **SX1262 LoRa transceiver** operating on 868 MHz. You must verify both the antenna solder joints and RF link budget.

### 4.1 RSSI and SNR Thresholds
When receiving telemetry on your ground station, monitor the signal quality indicators:

| Value Range | Classification | Action Required |
|---|---|---|
| **-30 to -80 dBm** | Perfect Signal | Typical for ground staging and close-range flight. |
| **-80 to -110 dBm** | Good Signal | Expected mid-flight telemetry. No packet loss. |
| **-110 to -120 dBm** | Fringe Range | Borderline reception. Telemetry drops may occur. |
| **Below -120 dBm** | Signal Loss | Check for shorted antenna shield or mismatched antenna frequency. |

---

### 4.2 Decapsulating a Telemetry Packet
When a packet is output to serial, here is how to verify its format:

```text
NRC2:42,42000,350.24,18.70,964.50,25.123400,55.567800,-64,12,7B3F
```

1. **Header:** `NRC2:` (Verifies Version 2 format).
2. **Payload Index:** `42` (Incrementing packet ID).
3. **Timestamp:** `42000` (Milliseconds since bootup).
4. **Calculated Altitude:** `350.24` (Meters above launch baseline).
5. **Temperature:** `18.70` (Primary BMP280 temperature).
6. **Pressure:** `964.50` (Barometer reading in hPa).
7. **Latitude/Longitude:** `25.123400,55.567800` (GPS coordinates).
8. **RSSI:** `-64` (Signal strength at receiver).
9. **Flags:** `12` (Decimal equivalent of binary flags).
10. **Checksum:** `7B3F` (Hex-encoded CRC16 checksum).

---

## 5. Backend & Real-Time Pipeline Integration Tests

To verify your complete ground station software stack, you can test the backend pipeline both with and without physical hardware.

### 5.1 Run Automated Tests (Unit and Integration)
Before running the main application, run the test suites to verify that the parser, CRC checking, database engine, and phase tracker work:

```bash
cd backend
npm test
```

**Expected Terminal Response:**
```text
> invictus-backend@2.0.0 test
> mocha tests/**/*.test.js --exit

  [Parser Engine: NRC]
    ✓ Should parse a valid NRC2: telemetry string (45ms)
    ✓ Should reject packet with corrupted CRC16 (12ms)
    ✓ Should unpack telemetry flags byte into booleans (8ms)

  [Flight Phase Tracker]
    ✓ Should start in PRE_FLIGHT state
    ✓ Should transition to POWERED_FLIGHT when altitude > 10m
    ✓ Should transition to APOGEE when altitude drops 5m from peak
    ✓ Should handle firmware flags directly for fast transitions

  14 passing (185ms)
```

---

### 5.2 Interactive Telemetry Simulation (Zero-Hardware Dashboard Test)
If your hardware is locked in the lab or you are developing dashboard code on your laptop, you can run the built-in emulator. The backend automatically detects if the physical USB receiver is missing and boots the software-in-the-loop emulator.

#### 1. Start the backend:
```bash
cd backend
npm start
```

**Expected Terminal Response:**
```text
[SYSTEM] Starting Invictus II Backend Engine...
[DATABASE] SQLite DB connected and ready: /Users/sakshammishra/Invictus-II/Invictus-II-1/backend/telemetry.db
[SERIAL] Scanning ports...
[SERIAL] ⚠️ Hardware serial unavailable: COM port not found
[SERIAL] Falling back to software emulator...
[HITL EMULATOR] 🚀 Hardware-in-the-loop byte-level emulator starting...
[WS] WebSockets server listening on port 5000
```

#### 2. Verify on the Dashboard:
Open your browser and navigate to:
```text
file:///Users/sakshammishra/Invictus-II/Invictus-II-1/dashboard/nrc.html
```

You will see live charts updating, GPS markers rendering on the map, and the flight state transitioning in real-time, validating the complete software pipeline.
