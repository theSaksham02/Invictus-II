# NRC Test Simulation Folder

This folder contains the interactive flight simulator used for **bench-testing** the NRC telemetry pipeline without requiring physical LoRa hardware.

## Quick Start

```bash
# Terminal 1: Start the virtual serial injector
python3 flight_injector.py

# Terminal 2: Start the backend server
cd ../../../backend && npm start

# Terminal 3 (or browser): Open the dashboard
open ../../../dashboard/nrc.html
```

## Purpose

This simulator creates a **virtual serial port** on macOS using the kernel's `pty` subsystem. It feeds realistic `NRC2:` telemetry packets (with valid CRC16-CCITT checksums) directly into the backend at 1 Hz, allowing full end-to-end pipeline verification without physical hardware.

## Keyboard Controls

| Key | Action |
|-----|--------|
| `1` | Reset to PRE-FLIGHT (pad, 0m) |
| `2` | BENCH LIFT (simulates 10-15 ft physical lift) |
| `3` | APOGEE (locks peak altitude, begins descent) |
| `4` | LANDED (returns to ground, freezes OLED max) |
| `5` | WDT HANG (freezes TX for 5s, tests watchdog recovery) |
| `6` | SENSOR FAIL (toggles BMP280 failure / LM75 hot-swap) |
| `Q` | Quit |

## Cleanup

This entire folder can be safely deleted after FRR submission:
```bash
rm -rf firmware/nrc/test_sim
```
