# Mach-X Rideshare Payload Guide

This guide covers the Mach-X Rideshare payload built from the Heltec/PCB stack. The flight workflow is:

1. Power the Heltec payload before launch.
2. The firmware samples sensors at 1 Hz.
3. The firmware transmits live `MXR3:` telemetry to the rideshare LoRa ground receiver.
4. The firmware writes every sample to a fresh SD CSV.
5. The firmware latches apogee after descent begins.
6. The OLED shows the latched apogee for recovery backup.
7. After landing, use the SD CSV only if live telemetry was incomplete.

## Hardware

| Component | Role | Protocol |
|---|---|---|
| Heltec WiFi LoRa 32 V3 | ESP32-S3 flight computer + OLED | Arduino |
| BMP280 | Barometric altitude and temperature | I2C |
| LM75 | Backup temperature | I2C |
| NEO-6M | GPS coordinates | UART |
| SD Card Module | Recovery flight log backup | SPI |
| ESP32-CAM | Standalone camera with its own SD card; no live video transmission | Power only |

## Pin Mapping

| Signal | Heltec GPIO | Connected Device |
|---|---:|---|
| I2C SDA | GPIO1 | BMP280 SDA + LM75 SDA |
| I2C SCL | GPIO2 | BMP280 SCL + LM75 SCL |
| GPS RX | GPIO7 | NEO-6M TX |
| GPS TX | GPIO6 | NEO-6M RX |
| SD CS | GPIO38 | SD card CS |
| SD SCK | GPIO39 | SD card SCK |
| SD MOSI | GPIO41 | SD card MOSI |
| SD MISO | GPIO42 | SD card MISO |
| OLED SDA | GPIO17 | Heltec internal OLED |
| OLED SCL | GPIO18 | Heltec internal OLED |
| OLED RST | GPIO21 | Heltec internal OLED |
| VEXT | GPIO36 | LOW enables OLED/Vext power |

BMP280 address is `0x76` when SDO is tied to GND.

## Firmware Behavior

On boot:

1. Enables VEXT for the OLED and sensor rail.
2. Starts GPS UART and sensor I2C.
3. Initializes BMP280 and probes LM75.
4. Mounts the SD card.
5. Opens the first unused file named `/mxr_flight_###.csv`.
6. Shows readiness on the OLED.

At 1 Hz:

1. Reads BMP280 temperature, pressure, and altitude.
2. Reads LM75 as backup temperature.
3. Feeds TinyGPSPlus and records the latest valid GPS fix.
4. Updates launch detection from altitude gain.
5. Updates running maximum altitude.
6. Latches `apogee_altitude_m` after a 5m drop from max altitude.
7. Sends a CRC-protected `MXR3:` live telemetry line over LoRa/USB.
8. Writes a complete CSV row to SD.
9. Refreshes the OLED.

## SD CSV Contract

Preferred live telemetry contract:

```text
MXR3:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<lm75_temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_hex>
```

Legacy `MXR2:` remains accepted by the backend for old captures.

Required columns accepted by the backend:

```csv
pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,flags,max_altitude_m,apogee_detected
```

Current firmware logs these columns:

```csv
pkt_id,timestamp_ms,altitude_m,temp_c,lm75_temp_c,pressure_hpa,lat,lon,gps_fix,flags,bmp_ok,sd_ok,max_altitude_m,apogee_detected,apogee_altitude_m
```

Example:

```csv
1,1000,0.00,22.10,22.00,1013.20,0.000000,0.000000,0,40,1,1,0.00,0,
2,2000,42.50,22.00,21.90,1008.20,0.000000,0.000000,0,41,1,1,42.50,0,
3,3000,61.25,21.80,21.70,1001.50,25.123400,55.567800,1,43,1,1,61.25,1,61.25
```

## OLED Contract

Before apogee:

```text
MACH-X RIDESHARE
ALT: 120.4 m
MAX:132m
P:142 GPS BAR SD
```

After apogee:

```text
MXR APOGEE
670 m
P:842 BAR SD
```

The post-apogee OLED value is latched and should remain visible through descent and landing.

## Flags

| Bit | Hex | Name | Meaning |
|---:|---:|---|---|
| 0 | `0x01` | `FLAG_LAUNCHED` | Altitude gain exceeded launch threshold |
| 1 | `0x02` | `FLAG_APOGEE` | Descent detected from running max altitude |
| 2 | `0x04` | `FLAG_GPS_FIX` | GPS fix is valid and recent |
| 3 | `0x08` | `FLAG_BARO_OK` | BMP280 sample is valid |
| 5 | `0x20` | `FLAG_SD_OK` | SD file is open for logging |
| 6 | `0x40` | `FLAG_STALE_SENSOR` | BMP280 has not produced a recent sample |

## Live Telemetry

Mach-X Rideshare live telemetry is enabled by default in firmware with:

```ini
-DENABLE_RIDESHARE_LIVE=1
```

Backend serial ingest is enabled by default. The rideshare link uses a second Heltec WiFi LoRa 32 V3 running `firmware/rideshare-ground-station`; the CanSat receiver remains separate. To start normally:

```bash
node backend/server.js
```

Set `SERIAL_PORT_CANSAT` and `SERIAL_PORT_RIDESHARE` to distinct USB serial devices before a combined run.

Set `ENABLE_RIDESHARE_LIVE=false` only when intentionally disabling the rideshare live serial path for bench isolation. Legacy `ENABLE_NRC_LIVE=false` is still accepted by the backend as a fallback alias.

## Build and Flash

```bash
cd firmware/nrc
pio run
pio run --target upload
pio device monitor --baud 115200
```

Expected boot output:

```text
[MXR] LoRa SX1262 OK @ 868 MHz
[MXR] GPS UART1 started
[MXR] BMP280 OK
[MXR] LM75 OK (...)
[MXR] SD card OK, logging to /mxr_flight_001.csv
[MXR] Setup complete - live telemetry and SD logging at 1 Hz
```

## Live Dashboard and Recovery Fallback

Before launch:

1. Start the backend with `node backend/server.js`.
2. Open `http://localhost:3000/mach-x-rideshare`.
3. Confirm the page title/logo shows `MACH-X RIDESHARE`.
4. Confirm the rideshare ground receiver is forwarding `MXR3:` or `MXR2:` lines.
5. Confirm live packets update the rideshare dashboard and the link diagnostics stay nominal.

After recovery, if live telemetry was incomplete:

1. Power off the payload.
2. Remove the SD card.
3. Copy or directly select `/mxr_flight_###.csv` from the laptop.
4. Open `http://localhost:3000/mach-x-rideshare`.
5. Upload the CSV.
6. Verify the altitude-vs-time chart and apogee marker.
