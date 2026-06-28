# Mach-X Rideshare Payload Testing Guide - Invictus II

This guide covers the Mach-X Rideshare payload. The flight Heltec sends live `MXR3:` telemetry over SX1262 LoRa to a second Heltec ground receiver, which forwards validated `MXR3:`/`MXR2:` lines over USB serial to the backend. The payload still records the full flight to SD with a latched OLED apogee as the recovery backup.

For a zero-prior-knowledge, command-by-command setup checklist, use [rideshare_zero_knowledge_setup.md](./rideshare_zero_knowledge_setup.md).

## Team Roles

| Role | Responsibility |
|------|----------------|
| Hardware Lead | Wiring, soldering checks, power-on sequencing |
| Sensor Tech | BMP280, LM75, GPS, and SD card verification |
| Software Lead | Firmware flashing, live dashboard, and recovery CSV fallback |
| Data Analyst | Monitor live telemetry, verify apogee marker, export data |

## Live Receiver Topology

The Mach-X Rideshare and CanSat links are separate and must both be connected when both vehicles are active:

| Source | Air hardware | Ground receiver | Backend port |
|--------|--------------|-----------------|--------------|
| `CANSAT` | STM32 + RFM69HCW binary frames | CanSat RFM69 ground receiver | `SERIAL_PORT_CANSAT` |
| `RIDESHARE` | Heltec WiFi LoRa 32 V3 + SX1262 ASCII `MXR3` | second Heltec WiFi LoRa 32 V3 running `firmware/rideshare-ground-station` | `SERIAL_PORT_RIDESHARE` |

The ESP32-CAM is not part of the live telemetry path. It is powered continuously from `5V_BUS`, records video locally to the camera SD card, and is recovered after flight.

## Hardware Checklist

| Heltec Pin | GPIO | Connected To | Purpose |
|-----------|------|-------------|---------|
| Pin 25 | GPIO1 | BMP280 SDA + LM75 SDA | I2C data |
| Pin 24 | GPIO2 | BMP280 SCL + LM75 SCL | I2C clock |
| Pin 19 | GPIO7 | NEO-6M TX | GPS data to ESP |
| Pin 20 | GPIO6 | NEO-6M RX | GPS commands from ESP |
| Pin 26 | GPIO38 | SD Card CS | SPI chip select |
| Pin 27 | GPIO39 | SD Card SCK | SPI clock |
| Pin 29 | GPIO41 | SD Card MOSI | SPI data out |
| Pin 30 | GPIO42 | SD Card MISO | SPI data in |
| Pin 2 | 5V | 5V_BUS + SD card VCC | Main power rail and SD module power |
| Pin 35 | 3V3 | BMP280 VCC + LM75 VCC | 3.3 V sensor rail |
| Pin 1 | GND | GROUND | Common ground |

Before powering the Heltec from the flight battery, verify the LM2596 buck converter output is exactly 5V with a multimeter. Also verify the SD card module VCC pin and ESP32-CAM 5V pin are both on `5V_BUS`; the SD SPI signal pins remain ESP32 3.3 V GPIO. Insert a FAT32-formatted SD card before every powered test.

## Firmware Flash

```bash
cd firmware/nrc
pio run --target upload
pio device monitor --baud 115200
```

Expected boot signals:

```text
[MXR] LoRa SX1262 OK @ 868 MHz
[MXR] GPS UART1 started
[MXR] BMP280 OK
[MXR] LM75 OK (...)
[MXR] SD card OK, logging to /mxr_flight_001.csv
[MXR] Setup complete - live telemetry and SD logging at 1 Hz
```

If `BMP280 FAILED`, check GPIO1/GPIO2 and the BMP280 `0x76` address wiring. If `SD card FAILED`, reformat the card as FAT32 and check GPIO38/39/41/42.

## Flight Data Contract

The Heltec creates a fresh file per boot:

```text
/mxr_flight_001.csv
/mxr_flight_002.csv
...
```

Mach-X Rideshare CSV required columns:

```csv
pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,flags,max_altitude_m,apogee_detected
```

Current firmware also logs optional recovery columns:

```csv
lm75_temp_c,gps_fix,bmp_ok,sd_ok,apogee_altitude_m
```

Live LoRa/USB telemetry is enabled by default. Use `ENABLE_RIDESHARE_LIVE=false` for the backend only when intentionally isolating the CanSat serial path during bench debugging.

Preferred live packets use `MXR3`:

```text
MXR3:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<lm75_temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_hex>
```

`MXR2` is still accepted for older captures and firmware.

## OLED Check

Before apogee, the OLED shows current altitude and running max:

```text
MACH-X RIDESHARE
ALT: 12.3 m
MAX:120m
P:42 GPS BAR SD
```

After apogee detection, the OLED changes to the latched apogee view:

```text
MXR APOGEE
670 m
P:842 BAR SD
```

The latched `MXR APOGEE` value is the value to read after recovery if the live ground station is unavailable.

## Bench Flight Test

Use a syringe, sealed jar, or controlled pressure change around the BMP280 to validate altitude response. Launch is detected after altitude rises more than 10m above baseline for 3 consecutive samples. Apogee is detected after altitude drops more than 5m from the maximum.

After the test:

1. Power off the avionics.
2. Remove the SD card.
3. Confirm the newest `/mxr_flight_###.csv` contains continuous rows.
4. Confirm `max_altitude_m` rises during ascent.
5. Confirm `apogee_detected` becomes `1` after descent begins.
6. Confirm `apogee_altitude_m` is populated after detection.

## Live Ground Station

Start the backend before powered radio tests or launch with both active receivers connected. BMP280, LM75, GPS, SD health, flags, altitude, pressure, temperature, and RSSI are transmitted live over `MXR3`; camera video is not transmitted live and is recovered from the ESP32-CAM SD card.

The payload logs to SD and prints USB telemetry every second by default. RF airtime is a separate constraint: before flight, verify the allowed 868 MHz frequency, power, airborne-use, and duty-cycle rules for the launch location. If a duty-cycle limit applies, set `LORA_DUTY_LIMIT_PPM` in `firmware/nrc/platformio.ini` before flashing; for example, `10000` enforces an approximate 1% RF airtime budget from measured `radio.transmit()` duration.

```bash
node backend/server.js
```

Set distinct serial ports before launch, for example:

```bash
SERIAL_PORT_CANSAT=/dev/ttyUSB1
SERIAL_PORT_RIDESHARE=/dev/ttyUSB2
```

Open:

```text
http://localhost:3000/mach-x-rideshare
```

The page updates live from `MXR3:` or legacy `MXR2:` packets while the rideshare rocket is flying. If live telemetry is unavailable after recovery, upload the recovered `/mxr_flight_###.csv`; the page stores the upload, then shows the same data layout from the SD file.

| Field | Meaning |
|-------|---------|
| Apogee | Maximum altitude in the recovered CSV |
| Apogee Time | Time since boot at the maximum altitude row |
| Rows | Valid rows inserted from the CSV |
| Duration | Last timestamp minus first timestamp |
| Altitude Trace | Altitude vs time with apogee marker |

## Quick Commands

| Task | Command |
|------|---------|
| Flash firmware | `cd firmware/nrc && pio run --target upload` |
| Serial monitor | `pio device monitor --baud 115200` |
| Start backend | `node backend/server.js` |
| Open Mach-X Rideshare dashboard | `http://localhost:3000/mach-x-rideshare` |
| Health check | `curl http://localhost:3000/api/health` |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| OLED is blank | Check Vext pin GPIO36; it must be LOW to enable OLED power |
| No serial boot output | Use 115200 baud and a data-capable USB-C cable |
| GPS stays 0,0 | Move outdoors; NEO-6M cold start can take several minutes |
| SD card failed | Reformat FAT32 and recheck SPI wiring |
| Dashboard upload fails | Confirm the CSV has the required columns and at least one data row |
| Apogee marker looks wrong | Inspect raw altitude rows for pressure-test spikes or timestamp resets |
