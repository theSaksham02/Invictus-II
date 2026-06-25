# Invictus II Hardware Testing Runbook

This document is written for a first-time operator. Follow it in order. Do not skip ahead.

The path used by the hardware team is:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
```

If that folder does not exist on your laptop, stop and ask the software lead for the correct repository folder.

## 0. Safety Rules

1. Never power any radio board without an antenna connected.
2. Never connect flight battery power and USB power through an unknown wiring harness until the 5 V rail has been measured.
3. Keep the payload on the bench for this procedure. Do not install it in the vehicle until every check passes.
4. When flashing firmware, connect only the board you are flashing. This avoids uploading to the wrong board.
5. Stop the backend before deleting telemetry history.
6. If a command prints an error you do not understand, stop and copy the exact error into the team chat.

## 1. One-Time Laptop Setup

Open Terminal.

Go to the repository:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
```

Check that you are in the right folder:

```bash
pwd
```

Expected output:

```text
/Users/manan_dua/Desktop/Invictus-II-1
```

Check Node.js:

```bash
node -v
```

Expected output must start with `v20`, for example:

```text
v20.19.4
```

If Node is missing or the version is not Node 20, install Node 20 with Homebrew:

```bash
brew install node@20
brew link --overwrite --force node@20
node -v
npm -v
```

Check PlatformIO:

```bash
pio --version
```

If PlatformIO is missing, install it:

```bash
python3 -m pip install --user platformio
pio --version
```

Install backend dependencies:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
npm install
```

Run the backend test suite:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
npm test
```

Expected result:

```text
# fail 0
```

Two hardware fixture tests may be skipped before real PCB captures exist. That is acceptable before the first capture, but not acceptable for final readiness.

Compile every firmware project once before touching hardware:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/rideshare-ground-station
pio run -d firmware/nrc
pio run -d firmware/ground-station
pio run -d firmware/cansat
```

Every command must end with:

```text
[SUCCESS]
```

## 2. Fresh Empty Telemetry Database

Do this before every clean hardware test campaign.

Stop the backend if it is running. In the backend Terminal window, press:

```text
Control-C
```

Delete old stored telemetry:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
rm -f flight.db flight.db-shm flight.db-wal
```

Start the backend once so it recreates an empty database:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
npm start
```

In a second Terminal window, confirm the backend is alive:

```bash
curl http://localhost:3000/api/health
```

Expected result includes:

```text
"status":"ok"
```

Stop the backend again with `Control-C` before flashing boards.

# Part A: Mach-X Rideshare Test

The rideshare live path has two Heltec boards:

1. Rideshare flight payload: Heltec WiFi LoRa 32 V3 with sensors and SD card.
2. Rideshare ground receiver: second Heltec WiFi LoRa 32 V3 connected to the laptop over USB.

The flight payload sends `MXR3:` telemetry over 868 MHz LoRa. The ground receiver validates the packet, stamps ground RSSI, recomputes CRC, and forwards the corrected `MXR3:` line over USB.

## A1. Rideshare Hardware Needed

Use these items:

1. Rideshare flight payload Heltec.
2. Rideshare LoRa ground receiver Heltec.
3. Two 868 MHz antennas.
4. USB-C data cable for Heltec boards.
5. FAT32 microSD card for the flight payload.
6. BMP280 wired to flight payload.
7. LM75 wired to flight payload.
8. NEO-6M GPS wired to flight payload.
9. Multimeter.
10. Laptop with this repository.

Before powering:

1. Attach an antenna to both Heltec boards.
2. Insert the FAT32 microSD card into the flight payload.
3. Measure the payload 5 V rail with the multimeter.
4. Confirm the 5 V rail is close to 5.00 V before connecting the Heltec to external power.

## A2. Find the USB Port for a Board

Use this process every time a board is connected.

With the board unplugged, run:

```bash
ls /dev/cu.*
```

Plug in exactly one board.

Run again:

```bash
ls /dev/cu.*
```

The new device is the board port. It will look similar to one of these:

```text
/dev/cu.usbserial-0001
/dev/cu.usbmodem1101
/dev/cu.SLAB_USBtoUART
/dev/cu.wchusbserialXXXX
```

Write the port down. In the commands below, replace `/dev/cu.usbserial-XXXX` with your real port.

## A3. Flash the Rideshare Ground Receiver

Connect only the rideshare ground receiver Heltec to USB.

Find its port:

```bash
ls /dev/cu.*
```

Flash the ground receiver firmware:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/rideshare-ground-station --target upload --upload-port /dev/cu.usbserial-XXXX
```

Open the serial monitor:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio device monitor -d firmware/rideshare-ground-station --port /dev/cu.usbserial-XXXX --baud 115200
```

Expected boot output:

```text
[MXR-GS] Booting rideshare LoRa ground receiver
[MXR-GS] SX1262 OK @ 868 MHz, forwarding CRC-valid MXR2/MXR3 packets
```

Close the monitor by pressing:

```text
Control-C
```

Label this port as:

```text
RIDESHARE_GROUND_PORT=/dev/cu.usbserial-XXXX
```

Leave the ground receiver connected after flashing.

## A4. Flash the Rideshare Flight Payload

Disconnect the ground receiver or leave it aside. Connect only the rideshare flight payload Heltec to USB.

Find its port:

```bash
ls /dev/cu.*
```

Flash the flight firmware:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/nrc --target upload --upload-port /dev/cu.usbserial-YYYY
```

Open the serial monitor:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio device monitor -d firmware/nrc --port /dev/cu.usbserial-YYYY --baud 115200
```

Expected boot output should include:

```text
[MXR] LoRa SX1262 OK @ 868 MHz
[MXR] GPS UART1 started
[MXR] Setup complete
```

The monitor should print one `MXR3:` line per second after startup. Example shape:

```text
MXR3:1,1000,0.12,24.50,24.25,1010.20,0.000000,0.000000,0,40,ABCD
```

If no `MXR3:` lines appear:

1. Confirm the firmware upload succeeded.
2. Confirm the serial monitor baud rate is `115200`.
3. Confirm `ENABLE_RIDESHARE_LIVE=1` exists in `firmware/nrc/platformio.ini`.
4. Press the Heltec reset button once.

Close the monitor:

```text
Control-C
```

## A5. Verify Rideshare LoRa Link Without Backend

Connect both boards:

1. Rideshare flight payload powered by USB or safe bench supply.
2. Rideshare ground receiver connected to laptop USB.
3. Antennas attached to both boards.

Open the ground receiver monitor:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio device monitor -d firmware/rideshare-ground-station --port /dev/cu.usbserial-XXXX --baud 115200
```

Expected result:

```text
MXR3:...
MXR3:...
MXR3:...
```

If the ground receiver prints:

```text
[MXR-GS] rejected malformed or CRC-invalid packet
```

then the receiver heard something, but the packet did not validate. Check that both boards are running the current firmware and both use the same LoRa settings.

Close the monitor:

```text
Control-C
```

## A6. Start Backend for Rideshare Dashboard

Use the rideshare ground receiver port as `SERIAL_PORT_RIDESHARE`.

Start the backend:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_RIDESHARE=/dev/cu.usbserial-XXXX ENABLE_MACHX_LIVE=false npm start
```

During rideshare-only testing the backend may print CanSat serial warnings if the CanSat receiver is not connected. Ignore those warnings during the rideshare-only section.

Open this URL in Chrome:

```text
http://localhost:3000/mach-x-rideshare
```

Or open it from Terminal:

```bash
open http://localhost:3000/mach-x-rideshare
```

Expected dashboard behavior:

1. The page title says `MACH-X RIDESHARE`.
2. `NO SIGNAL` disappears after packets arrive.
3. Packet count increases once per second.
4. Altitude graph receives points.
5. Temperature and pressure graphs receive points.
6. Mission log remains empty on the bench unless launch/apogee thresholds are triggered.

Check backend health from a second Terminal:

```bash
curl http://localhost:3000/api/health
```

Expected result includes `RIDESHARE` and the configured port.

## A7. Capture Real Rideshare Hardware Fixtures

This proves that the real hardware output is accepted by the parser.

Stop the backend first with `Control-C`. The capture script needs direct access to the serial port.

Capture 30 real rideshare packets:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
node tests/capture-hardware-fixtures.js --source RIDESHARE --port /dev/cu.usbserial-XXXX --out tests/fixtures/hardware/rideshare-$(date +%Y%m%d-%H%M).mxr --baud 115200 --count 30
```

Expected output:

```text
[capture] 1/30 MXR3:...
[capture] 2/30 MXR3:...
...
[capture] 30/30 MXR3:...
```

Run parser tests with the captured fixture:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
npm test
```

The rideshare hardware fixture test must no longer be skipped if the capture file exists.

## A8. Rideshare Bench Flight Simulation

Use this only after A1 through A7 pass.

Start the backend:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_RIDESHARE=/dev/cu.usbserial-XXXX ENABLE_MACHX_LIVE=false npm start
```

Open:

```text
http://localhost:3000/mach-x-rideshare
```

Or open it from Terminal:

```bash
open http://localhost:3000/mach-x-rideshare
```

Create a controlled pressure change at the BMP280:

1. Put the payload in a small sealed container or controlled pressure test setup.
2. Do not damage the sensor with liquid, dust, or direct suction.
3. Slowly reduce pressure so altitude rises.
4. Slowly return pressure so altitude falls.

Expected behavior:

1. Altitude rises on the dashboard.
2. Max altitude increases.
3. After enough altitude rise, phase changes from grounded/waiting into ascent.
4. After descent begins, apogee is detected.
5. If power is briefly interrupted and restored, the backend emits `MCU_REBOOT` and preserves in-flight context.

Export the dashboard CSV after the test:

1. Click `EXPORT CSV`.
2. Save the file with a name like `rideshare-bench-YYYYMMDD.csv`.

## A9. Rideshare Pass Criteria

Rideshare is ready to move to integrated hardware testing only if all are true:

1. `pio run -d firmware/rideshare-ground-station` succeeds.
2. `pio run -d firmware/nrc` succeeds.
3. Ground receiver sees real `MXR3:` packets.
4. Backend dashboard updates from the ground receiver.
5. `npm test` passes after real rideshare fixture capture.
6. Packet count increments at approximately 1 Hz.
7. Duplicate packets are skipped, not double-counted.
8. Dashboard reload keeps persisted history.
9. SD card creates a flight CSV on the payload.
10. A short power interruption produces a reboot event but does not erase backend history.

# Part B: CanSat Test

The CanSat live path has two boards:

1. CanSat flight computer: STM32 Bluepill with RFM69HCW, BMP388, LM75 sensors, MPU6500, GPS, and SD card.
2. CanSat ground receiver: ESP32 WROOM with RFM69HCW connected to the laptop over USB.

The CanSat sends 60-byte binary v3 packets over 433 MHz RFM69. The ground receiver validates the frame, stamps ground RSSI, recomputes CRC, and forwards the raw binary frame over USB.

## B1. CanSat Hardware Needed

Use these items:

1. STM32 Bluepill CanSat flight board.
2. ESP32 RFM69 CanSat ground receiver.
3. Two 433 MHz antennas.
4. ST-Link or configured Bluepill upload adapter.
5. USB cable for ESP32 ground receiver.
6. FAT32 microSD card for CanSat flight board.
7. BMP388, LM75 sensors, MPU6500, GPS, and RFM69HCW connected according to the circuit.
8. Multimeter.
9. Laptop with this repository.

Before powering:

1. Attach antennas to both RFM69 radios.
2. Insert the FAT32 microSD card into the CanSat.
3. Measure the 5 V and 3.3 V rails.
4. Confirm the RFM69HCW is powered at 3.3 V, not 5 V.

## B2. Flash the CanSat Ground Receiver

Connect only the ESP32 CanSat ground receiver to USB.

Find its port:

```bash
ls /dev/cu.*
```

Flash the ground receiver:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/ground-station --target upload --upload-port /dev/cu.usbserial-ZZZZ
```

Open the serial monitor:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio device monitor -d firmware/ground-station --port /dev/cu.usbserial-ZZZZ --baud 115200
```

Expected boot output:

```text
GCS:READY RFM69HCW 433MHz
```

The ground receiver forwards binary data. After flight packets arrive, the serial monitor may show unreadable characters. That is normal for CanSat because the protocol is binary.

Close the monitor:

```text
Control-C
```

Label this port as:

```text
CANSAT_GROUND_PORT=/dev/cu.usbserial-ZZZZ
```

## B3. Flash the CanSat Flight Computer

Connect only the STM32 Bluepill flight computer.

Flash the CanSat firmware:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/cansat --target upload
```

If PlatformIO cannot find the upload adapter, identify connected serial/debug devices:

```bash
ls /dev/cu.*
```

Then retry with the explicit upload port if your adapter appears as a serial device:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1
pio run -d firmware/cansat --target upload --upload-port /dev/cu.usbserial-AAAA
```

Expected build/upload result:

```text
[SUCCESS]
```

If upload fails with an ST-Link or CPUTAPID error:

1. Confirm ST-Link is connected to SWDIO, SWCLK, 3V3, and GND.
2. Confirm the Bluepill has power.
3. Confirm `firmware/cansat/platformio.ini` contains the configured upload flags.
4. Press reset on the Bluepill and retry.

## B4. Verify CanSat Binary Link Without Backend

Connect:

1. CanSat flight computer powered safely on the bench.
2. CanSat ESP32 ground receiver connected to laptop USB.
3. 433 MHz antennas attached to both radios.

Because CanSat packets are binary, do not judge the link by readable serial text. Use the capture script.

Capture 30 real CanSat frames:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
node tests/capture-hardware-fixtures.js --source CANSAT --port /dev/cu.usbserial-ZZZZ --out tests/fixtures/hardware/cansat-$(date +%Y%m%d-%H%M).cansat.hex --baud 115200 --count 30
```

Expected output:

```text
[capture] 1/30 a55a...
[capture] 2/30 a55a...
...
[capture] 30/30 a55a...
```

Run parser tests:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
npm test
```

The CanSat hardware fixture test must no longer be skipped if the capture file exists.

## B5. Start Backend for CanSat Dashboard

Start the backend with the CanSat ground receiver port:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_CANSAT=/dev/cu.usbserial-ZZZZ ENABLE_RIDESHARE_LIVE=false ENABLE_MACHX_LIVE=false npm start
```

Open this URL in Chrome:

```text
http://localhost:3000/cansat
```

Or open it from Terminal:

```bash
open http://localhost:3000/cansat
```

Expected dashboard behavior:

1. The page title says `MACH-X CANSAT`.
2. `NO SIGNAL` disappears after packets arrive.
3. Packet count increases.
4. Altitude graph receives points.
5. Pressure and temperature graphs receive points.
6. Mission mode and sensor health reflect packet flags.

Check backend health:

```bash
curl http://localhost:3000/api/health
```

Expected result includes `CANSAT` and the configured port.

## B6. CanSat Bench Flight Simulation

Use this only after B1 through B5 pass.

Start backend:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_CANSAT=/dev/cu.usbserial-ZZZZ ENABLE_RIDESHARE_LIVE=false ENABLE_MACHX_LIVE=false npm start
```

Open:

```text
http://localhost:3000/cansat
```

Or open it from Terminal:

```bash
open http://localhost:3000/cansat
```

Create a controlled pressure change at the BMP388:

1. Put the CanSat in a small sealed container or controlled pressure test setup.
2. Do not expose the electronics to moisture.
3. Slowly reduce pressure so altitude rises.
4. Slowly return pressure so altitude falls.

Expected behavior:

1. Altitude rises on the dashboard.
2. Max altitude increases.
3. Flight phase leaves pad/ground when altitude thresholds are crossed.
4. Apogee is detected after descent is sustained.
5. GPS recovery mode is entered near the configured recovery altitude after descent.
6. GPS coordinates remain `0,0` until GPS recovery or valid GPS use is enabled.

Export CSV after the test:

1. Click `EXPORT CSV`.
2. Save the file with a name like `cansat-bench-YYYYMMDD.csv`.

## B7. CanSat Pass Criteria

CanSat is ready for integrated testing only if all are true:

1. `pio run -d firmware/ground-station` succeeds.
2. `pio run -d firmware/cansat` succeeds.
3. Real CanSat binary frames are captured as `.cansat.hex`.
4. `npm test` passes after real CanSat fixture capture.
5. Backend dashboard updates from the CanSat ground receiver.
6. Packet count increments steadily.
7. CanSat frame parser resyncs after boot/debug text.
8. Pressure, altitude, temperature, acceleration, and gyro values are physically plausible.
9. SD card creates `machx_flight.csv`.
10. No sensor health flag is unexpectedly failed unless the missing sensor is intentionally disconnected.

# Part C: Integrated Rideshare Plus CanSat Test

Do this only after Part A and Part B pass separately.

Connect both ground receivers to the laptop:

1. Rideshare LoRa ground receiver USB.
2. CanSat RFM69 ground receiver USB.

Find ports:

```bash
ls /dev/cu.*
```

Start backend with both live links:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_RIDESHARE=/dev/cu.usbserial-XXXX SERIAL_PORT_CANSAT=/dev/cu.usbserial-ZZZZ ENABLE_MACHX_LIVE=false npm start
```

Open two browser tabs:

```text
http://localhost:3000/mach-x-rideshare
http://localhost:3000/cansat
```

Or open both from Terminal:

```bash
open http://localhost:3000/mach-x-rideshare
open http://localhost:3000/cansat
```

Expected behavior:

1. Rideshare page updates only from rideshare packets.
2. CanSat page updates only from CanSat packets.
3. Packet counts increase independently.
4. Reloading either page keeps persisted history.
5. Wrong-source packets do not change the visible dashboard.

Check API history for rideshare:

```bash
curl "http://localhost:3000/api/packets?source=RIDESHARE&limit=5"
```

Check API history for CanSat:

```bash
curl "http://localhost:3000/api/packets?source=CANSAT&limit=5"
```

Check signal status:

```bash
curl http://localhost:3000/api/health
```

# Part D: Common Troubleshooting

## D1. `pio` command not found

Run:

```bash
python3 -m pip install --user platformio
```

Close Terminal, reopen Terminal, then run:

```bash
pio --version
```

## D2. `node` is not Node 20

Run:

```bash
brew install node@20
brew link --overwrite --force node@20
node -v
```

Expected output starts with:

```text
v20
```

## D3. Upload cannot find board

Run before plugging in:

```bash
ls /dev/cu.*
```

Plug in the board and run again:

```bash
ls /dev/cu.*
```

Use the new port in `--upload-port`.

## D4. Backend starts but dashboard says `NO SIGNAL`

Check the backend health:

```bash
curl http://localhost:3000/api/health
```

Confirm the correct serial port is configured:

```bash
ls /dev/cu.*
```

Restart backend with explicit ports:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
SERIAL_PORT_RIDESHARE=/dev/cu.usbserial-XXXX SERIAL_PORT_CANSAT=/dev/cu.usbserial-ZZZZ ENABLE_MACHX_LIVE=false npm start
```

## D5. Rideshare packets appear in serial monitor but not dashboard

Confirm packet prefix is `MXR3:` or `MXR2:`.

Capture and run tests:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
node tests/capture-hardware-fixtures.js --source RIDESHARE --port /dev/cu.usbserial-XXXX --out tests/fixtures/hardware/rideshare-debug.mxr --baud 115200 --count 5
npm test
```

If tests fail, the packet is malformed, CRC-invalid, or outside accepted physical limits.

## D6. CanSat serial monitor shows unreadable characters

That is normal. CanSat telemetry is binary.

Use the capture script instead:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
node tests/capture-hardware-fixtures.js --source CANSAT --port /dev/cu.usbserial-ZZZZ --out tests/fixtures/hardware/cansat-debug.cansat.hex --baud 115200 --count 5
```

## D7. Clear all history again

Stop backend with `Control-C`, then run:

```bash
cd /Users/manan_dua/Desktop/Invictus-II-1/backend
rm -f flight.db flight.db-shm flight.db-wal
npm start
```

# Final Readiness Gate

Do not move to launch-day operation until this final list is complete:

1. Rideshare flight payload flashed.
2. Rideshare ground receiver flashed.
3. CanSat flight computer flashed.
4. CanSat ground receiver flashed.
5. Backend `npm test` passes.
6. All four `pio run` commands pass.
7. Real rideshare fixture captured and parser test passes.
8. Real CanSat fixture captured and parser test passes.
9. `/mach-x-rideshare` dashboard updates live.
10. `/cansat` dashboard updates live.
11. Browser reload preserves history on both dashboards.
12. Export CSV works for both dashboards.
13. SD card files are created on both payloads.
14. Antennas are attached before every radio power-on.
15. Exact serial ports are written down for the test laptop.
