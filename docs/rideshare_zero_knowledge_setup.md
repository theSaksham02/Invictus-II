# Rideshare Payload + Rideshare Ground Station Setup

This is the beginner checklist for only the Mach-X rideshare flight payload and the rideshare LoRa ground station. It does not cover CanSat.

## 0. What You Need

1. Flight payload Heltec WiFi LoRa 32 V3 with BMP280, LM75, NEO-6M GPS, SD card module, and antenna.
2. Ground station Heltec WiFi LoRa 32 V3 with antenna.
3. Laptop with this repository.
4. Two USB data cables.
5. FAT32 microSD card for the flight payload.
6. Multimeter.
7. Flight battery and LM2596 5 V regulator.

Never power a LoRa board without an antenna attached.

## 1. Rideshare Flight Payload Wiring

Wire the flight payload Heltec to the sensors and SD card module exactly like this.

| From | To | Meaning |
|------|----|---------|
| Heltec pin 1 GND | GROUND | Common ground |
| Heltec pin 36 GND | GROUND | Common ground |
| Heltec pin 2 5V | `5V_BUS` | Main 5 V input |
| Heltec pin 35 3V3 | `3V3_BUS` | 3.3 V sensor rail |
| Heltec GPIO1, pin 25 | BMP280 SDA and LM75 SDA | I2C data |
| Heltec GPIO2, pin 24 | BMP280 SCL and LM75 SCL | I2C clock |
| Heltec GPIO7, pin 19 | NEO-6M TX | GPS data into Heltec |
| Heltec GPIO6, pin 20 | NEO-6M RX | GPS commands from Heltec |
| Heltec GPIO38, pin 26 | SD card module CS, pin 6 | SD chip select |
| Heltec GPIO39, pin 27 | SD card module SCK, pin 5 | SD SPI clock |
| Heltec GPIO41, pin 29 | SD card module MOSI, pin 4 | SD data Heltec to card |
| Heltec GPIO42, pin 30 | SD card module MISO, pin 3 | SD data card to Heltec |
| SD card module GND, pin 1 | GROUND | SD power ground |
| SD card module VCC, pin 2 | `5V_BUS` | SD module power, keep this at 5 V |
| NEO-6M GND, pin 1 | GROUND | GPS ground |
| NEO-6M VCC, pin 4 | `5V_BUS` | GPS power |
| BMP280 VCC, pin 1 | `3V3_BUS` | BMP280 power |
| BMP280 CSB, pin 5 | `3V3_BUS` | Forces I2C mode |
| BMP280 GND, pin 2 | GROUND | BMP280 ground |
| BMP280 SDO, pin 6 | GROUND | BMP280 address 0x76 |
| LM75 pin 1 | `3V3_BUS` | LM75 power |
| LM75 pin 2 | GROUND | LM75 ground |
| LM75 pin 5 | EMPTY | Leave unconnected |

Before inserting the Heltec, use the multimeter:

1. Measure `5V_BUS` to GROUND. It must be close to 5.00 V.
2. Measure SD card module VCC to GROUND. It must be close to 5.00 V.
3. Measure `3V3_BUS` to GROUND. It must be close to 3.3 V.
4. Do not connect the SD card module VCC to `3V3_BUS`.
5. Do not connect the SD card module VCC to Heltec `Vext`.

## 2. Rideshare Ground Station Wiring

The rideshare ground station is a second Heltec WiFi LoRa 32 V3.

| From | To |
|------|----|
| Ground station Heltec antenna connector | 868 MHz antenna |
| Ground station Heltec USB-C | Laptop USB port |

Do not connect sensors, SD card, GPS, battery, or camera to the ground station Heltec.

## 3. Open The Repository

Open Terminal and run:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
pwd
```

Expected result:

```text
/Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
```

Install backend dependencies once:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/backend
npm install
```

Check PlatformIO is installed:

```bash
pio --version
```

## 4. Flash The Flight Payload

Connect only the flight payload Heltec to the laptop. Disconnect the ground station for this step.

In Terminal:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
pio device list
```

Look for a port like `/dev/cu.usbserial-XXXX`, `/dev/cu.usbmodemXXXX`, or `/dev/ttyUSB0`. Put that value in this command:

```bash
export PAYLOAD_PORT=/dev/cu.usbserial-XXXX
```

Replace `/dev/cu.usbserial-XXXX` with the real payload port from `pio device list`.

Flash the payload:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/firmware/nrc
pio run --target upload --upload-port "$PAYLOAD_PORT"
```

Open the payload serial monitor:

```bash
pio device monitor --port "$PAYLOAD_PORT" --baud 115200
```

Expected good signs:

```text
[MXR] LoRa SX1262 OK @ 868 MHz
[MXR] BMP280 OK
[MXR] SD card OK, logging to /mxr_flight_001.csv
[MXR] Setup complete
MXR3:
```

If you see `SD card FAILED`, stop and check SD module VCC is on `5V_BUS`, the card is FAT32, and GPIO38/39/41/42 are wired correctly.

Press `Ctrl-C` to close the monitor.

## 5. Flash The Rideshare Ground Station

Disconnect the flight payload USB cable. Connect only the ground station Heltec to the laptop.

Find its serial port:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
pio device list
```

Put the real ground station port in this command:

```bash
export RIDESHARE_GS_PORT=/dev/cu.usbserial-YYYY
```

Replace `/dev/cu.usbserial-YYYY` with the real ground station port.

Flash the ground station:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/firmware/rideshare-ground-station
pio run --target upload --upload-port "$RIDESHARE_GS_PORT"
```

Open the ground station serial monitor:

```bash
pio device monitor --port "$RIDESHARE_GS_PORT" --baud 115200
```

Expected good sign:

```text
[MXR-GS] SX1262 OK @ 868 MHz, forwarding CRC-valid MXR2/MXR3 packets
```

If the flight payload is powered nearby, the monitor should eventually show `MXR3:` lines.

Press `Ctrl-C` to close the monitor before starting the backend.

## 6. Run The Live Rideshare Dashboard

Keep the ground station Heltec connected to the laptop. Power the flight payload with its flight battery or USB for bench testing.

Create or replace `backend/.env` with these lines. Put the real ground station port in `RIDESHARE_GS_PORT` first.

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/backend
export RIDESHARE_GS_PORT=/dev/cu.usbserial-YYYY
cat > .env <<EOF
PORT=3000
SERIAL_PORT_RIDESHARE=$RIDESHARE_GS_PORT
SERIAL_BAUD_RIDESHARE=115200
ENABLE_RIDESHARE_LIVE=true
ENABLE_MACHX_LIVE=false
LOG_PACKETS=true
SERIAL_RECONNECT_MS=30000
EOF
```

Replace `/dev/cu.usbserial-YYYY` with the real ground station port.

Start the backend:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/backend
npm start
```

Open this page in a browser:

```text
http://localhost:3000/mach-x-rideshare
```

Check backend health in a second Terminal tab:

```bash
curl http://localhost:3000/api/health
```

You may see CANSAT serial warnings in the terminal because this repo also tries to open the CanSat port by default. For rideshare-only testing, ignore CANSAT warnings. The important source is `RIDESHARE`.

## 7. Confirm It Works

On the flight payload OLED, confirm:

```text
MACH-X RIDESHARE
```

On the backend terminal, confirm `MXR3:` packet objects appear if `LOG_PACKETS=true`.

On the dashboard, confirm:

1. Packet count increases about once per second.
2. Altitude, pressure, temperature, and flags update.
3. SD status is OK.
4. GPS may show `0.000000,0.000000` indoors. Test outdoors under open sky for real GPS coordinates.

## 8. Recovery CSV After A Test

After a bench test or flight:

1. Power off the flight payload.
2. Remove the flight payload microSD card.
3. Open the newest file named like this:

```text
mxr_flight_001.csv
mxr_flight_002.csv
```

The file should contain rows with `pkt_id`, `timestamp_ms`, `altitude_m`, `temp_c`, `pressure_hpa`, `flags`, and apogee columns.

To upload recovered data, open:

```text
http://localhost:3000/mach-x-rideshare
```

Use the SD upload control on that page and choose the newest `mxr_flight_###.csv`.

## 9. Stop Everything

Stop the backend:

```text
Ctrl-C
```

Unplug USB cables only after closing serial monitors and stopping the backend.

## 10. Fast Command Summary

Payload flash:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
pio device list
export PAYLOAD_PORT=/dev/cu.usbserial-XXXX
cd firmware/nrc
pio run --target upload --upload-port "$PAYLOAD_PORT"
pio device monitor --port "$PAYLOAD_PORT" --baud 115200
```

Ground station flash:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II
pio device list
export RIDESHARE_GS_PORT=/dev/cu.usbserial-YYYY
cd firmware/rideshare-ground-station
pio run --target upload --upload-port "$RIDESHARE_GS_PORT"
pio device monitor --port "$RIDESHARE_GS_PORT" --baud 115200
```

Backend:

```bash
cd /Users/fateen/Desktop/uni/spacesociety/competition/git/Invictus-II/backend
export RIDESHARE_GS_PORT=/dev/cu.usbserial-YYYY
cat > .env <<EOF
PORT=3000
SERIAL_PORT_RIDESHARE=$RIDESHARE_GS_PORT
SERIAL_BAUD_RIDESHARE=115200
ENABLE_RIDESHARE_LIVE=true
ENABLE_MACHX_LIVE=false
LOG_PACKETS=true
SERIAL_RECONNECT_MS=30000
EOF
npm start
```

Dashboard:

```text
http://localhost:3000/mach-x-rideshare
```
