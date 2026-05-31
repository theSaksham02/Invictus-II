# NRC Test Simulation — FRR Demo Toolkit

This folder contains everything you need to demonstrate a complete NRC flight telemetry pipeline **without physical hardware**.

---

## 🚀 Quick Start: ONE-COMMAND Demo

**Best for: FRR slide screenshots, screen recordings, "look it all works" evidence.**

```bash
cd firmware/nrc/test_sim
./run_frr_demo.sh
```

That's it. One command. It will:
1. ✅ Backup your existing `.env`
2. ✅ Create a simulation `.env` with `SIM_MODE=true`
3. ✅ Start the backend server (emulator auto-starts)
4. ✅ Open the NRC dashboard in your browser
5. ✅ Show you a full 3-minute simulated flight
6. ✅ Clean everything up when you press `Ctrl+C`

### What You'll See (Flight Timeline)

| Time | Phase | What Happens on Dashboard |
|------|-------|---------------------------|
| 0-30s | PRE_FLIGHT | Idle at ground, sensors calibrating |
| 30-90s | ASCENDING | Climbing to ~660m (2165ft), charts moving |
| 90-95s | APOGEE | Peak altitude, parachute deploy event |
| 95-180s | DESCENDING | Slow descent under parachute |
| 180s+ | LANDED | Ground level, max altitude locked |

---

## 🎮 Interactive Mode: Manual Keyboard Control

**Best for: Live demo walkthroughs, "watch me trigger each phase" videos.**

Requires **3 terminals**:

### Terminal 1 — Flight Injector (you control the flight)
```bash
cd firmware/nrc/test_sim
./run_interactive_test.sh
```

### Terminal 2 — Backend Server
```bash
cd backend
SERIAL_PORT_NRC=/dev/tty.virtual-nrc node server.js
```

### Terminal 3 — Dashboard
```bash
open dashboard/nrc.html
```

### Keyboard Controls
| Key | Action |
|-----|--------|
| `1` | Reset to PRE-FLIGHT (pad, 0m) |
| `2` | BENCH LIFT (simulates 10-15ft physical lift) |
| `3` | APOGEE (locks peak altitude, begins descent) |
| `4` | LANDED (returns to ground) |
| `5` | WDT HANG (freezes TX for 5s, tests watchdog) |
| `6` | SENSOR FAIL (toggles BMP280 failure / LM75 swap) |
| `Q` | Quit |

---

## 📸 What to Capture for FRR Slides

1. **Dashboard with live telemetry charts** — screenshot during ASCENDING phase
2. **Terminal showing NRC2: packets streaming** — shows CRC validation working
3. **Phase transition events** — screenshot when APOGEE triggers
4. **Sensor health panel** — shows green checks for BMP/GPS/SD
5. **SD card log file** — show `flight_frr_demo.db` exists and has data

---

## 🗑️ Cleanup

After FRR submission, delete this entire folder:
```bash
rm -rf firmware/nrc/test_sim
git add -A && git commit -m "chore: remove FRR test simulator" && git push
```
