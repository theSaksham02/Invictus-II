# Rideshare Payload Testing Guide - NRC Invictus II

This guide covers the NRC rocket workflow only. NRC is a post-flight SD recovery system: the Heltec records the flight, latches apogee on its OLED, and the laptop reviews the recovered CSV after landing. Mach-X/CanSat live tracking is separate.

## Team Roles

| Role | Responsibility |
|------|----------------|
| Hardware Lead | Wiring, soldering checks, power-on sequencing |
| Sensor Tech | BMP280, LM75, GPS, and SD card verification |
| Software Lead | Firmware flashing and post-flight review page |
| Data Analyst | Upload recovered CSV, verify apogee marker, export data |

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
| Pin 2 | 5V | 5V_BUS | Main power rail |
| Pin 1 | GND | GROUND | Common ground |

Before powering the Heltec from the flight battery, verify the LM2596 buck converter output is exactly 5V with a multimeter. Insert a FAT32-formatted SD card before every powered test.

## Firmware Flash

```bash
cd firmware/nrc
pio run --target upload
pio device monitor --baud 115200
```

Expected boot signals:

```text
[NRC] Live LoRa telemetry disabled (ENABLE_NRC_LIVE=0)
[NRC] GPS UART1 started
[NRC] BMP280 OK @ 0x76
[NRC] LM75 OK (...)
[NRC] SD card OK, logging to /nrc_flight_001.csv
[NRC] Setup complete - SD logging at 1 Hz
```

If `BMP280 FAILED`, check GPIO1/GPIO2 and the BMP280 `0x76` address wiring. If `SD card FAILED`, reformat the card as FAT32 and check GPIO38/39/41/42.

## Flight Data Contract

The Heltec creates a fresh file per boot:

```text
/nrc_flight_001.csv
/nrc_flight_002.csv
...
```

NRC CSV required columns:

```csv
pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,flags,max_altitude_m,apogee_detected
```

Current firmware also logs optional recovery columns:

```csv
lm75_temp_c,gps_fix,bmp_ok,sd_ok,apogee_altitude_m
```

Optional live LoRa/USB telemetry is disabled by default. Use `-DENABLE_NRC_LIVE=1` in `firmware/nrc/platformio.ini` and `ENABLE_NRC_LIVE=true` for the backend only during bench debugging.

## OLED Check

Before apogee, the OLED shows current altitude and running max:

```text
NRC INVICTUS II
ALT: 12.3 m
MAX:120m
P:42 GPS BAR SD
```

After apogee detection, the OLED changes to the latched apogee view:

```text
NRC APOGEE
670 m
P:842 BAR SD
```

The latched `NRC APOGEE` value is the value to read after recovery.

## Bench Flight Test

Use a syringe, sealed jar, or controlled pressure change around the BMP280 to validate altitude response. Launch is detected after altitude rises more than 10m above baseline for 3 consecutive samples. Apogee is detected after altitude drops more than 5m from the maximum.

After the test:

1. Power off the avionics.
2. Remove the SD card.
3. Confirm the newest `/nrc_flight_###.csv` contains continuous rows.
4. Confirm `max_altitude_m` rises during ascent.
5. Confirm `apogee_detected` becomes `1` after descent begins.
6. Confirm `apogee_altitude_m` is populated after detection.

## Laptop Review

Start the backend after recovery:

```bash
node backend/server.js
```

Open:

```text
http://localhost:3000/nrc
```

Upload the recovered `/nrc_flight_###.csv`. The page stores the upload, then shows:

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
| Open NRC review | `http://localhost:3000/nrc` |
| Health check | `curl http://localhost:3000/api/health` |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| OLED is blank | Check Vext pin GPIO36; it must be LOW to enable OLED power |
| No serial boot output | Use 115200 baud and a data-capable USB-C cable |
| GPS stays 0,0 | Move outdoors; NEO-6M cold start can take several minutes |
| SD card failed | Reformat FAT32 and recheck SPI wiring |
| Review page upload fails | Confirm the CSV has the NRC required columns and at least one data row |
| Apogee marker looks wrong | Inspect raw altitude rows for pressure-test spikes or timestamp resets |
