# UOBRPL Avionics — Project Overview & Mission Logic

**Organisation:** University of Birmingham Rocketry & Propulsion Lab (UOBRPL)
**Dashboard:** UOBRPL Avionics
**Last updated:** April 2026

---

## PROJECT OVERVIEW

### Three Competitions. Four Vehicles. One Platform.

UOBRPL competes in three simultaneous national and international competitions, all managed under the **UOBRPL Avionics** ground station platform.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        UOBRPL AVIONICS                                  │
│                  University of Birmingham Dubai                          │
├──────────────────┬──────────────────┬──────────────────────────────────┤
│  AVIONICS TAB    │  CANSAT TAB      │  ROVER TAB                       │
│                  │                  │                                   │
│  INVICTUS II     │  SUGAR           │  NOVARIUM II                     │
│  (NRC Rocket)    │  (MachX CanSat)  │  (ORT Rover)                     │
│                  │                  │                                   │
│  MATCHA          │                  │                                   │
│  (MachX Rocket)  │                  │                                   │
└──────────────────┴──────────────────┴──────────────────────────────────┘
```

---

### PROJECT 1 — UKSEDS National Rocketry Championship (NRC)

**Competition:** [UKSEDS NRC](https://ukseds.org/ignition/competitions/national-rocketry-championship/)
**Vehicle:** INVICTUS II
**Type:** Mid-power competition rocket + CanSat payload
**Dashboard section:** Avionics tab

| Parameter | Value |
|---|---|
| Target Altitude | 2,200 ft (670 m) |
| Telemetry | 1 Hz, 868 MHz RFM69HCW |
| Packet Format | 37-byte binary struct (CANSAT source) |
| NRC Satellite | Heltec LoRa v3 868 MHz (NRC source) |
| Ground Station | `npm start` — Node.js + Socket.io |
| Rulebook | UKSEDS NRC 2025–26 |

**Source identifiers in backend:**
- `CANSAT` — INVICTUS II CanSat payload (STM32 + RFM69HCW)
- `NRC` — NRC satellite (Heltec LoRa v3, ASCII CSV)

---

### PROJECT 2 — UKSEDS Olympus Rover Trials (ORT)

**Competition:** [UKSEDS ORT](https://ukseds.org/ignition/competitions/olympus-rover-trials/)
**Vehicle:** NOVARIUM II
**Type:** Planetary surface operations rover
**Dashboard section:** Rover tab

| Parameter | Value |
|---|---|
| Platform | Raspberry Pi 4B |
| Drive | BTS7960 × 2 · 6 motors |
| Comms | WiFi HTTP (Flask) |
| Camera | Camera Module 3 (MJPEG stream) |
| Control | WASD keyboard + gamepad via dashboard |
| Proxy | `rover-proxy.js` → RPi Flask |

**Source identifier in backend:**
- `ROVER` — NOVARIUM II (HTTP, not Socket.io telemetry)

---

### PROJECT 3 — EuRoC / Mach-X (EXO Events)

**Competition:** [EXO Events / Mach-X](https://www.exo.events/about)
**Vehicles:** MATCHA (rocket) + SUGAR (CanSat payload)
**Type:** European Rocketry Challenge — high-power rocket + CanSat
**Dashboard section:** Avionics tab (MATCHA) + CanSat tab (SUGAR)

| Parameter | Value |
|---|---|
| Rocket | MATCHA |
| CanSat | SUGAR |
| Packet format | TBD — likely same 37-byte binary struct as INVICTUS II |
| Radio | TBD — 868 MHz |
| Launch site | Machrihanish Airbase, Scotland (via EXO Events) |

**Source identifiers in backend (reserved):**
- `MACHX` — MATCHA rocket avionics
- `SUGAR` — SUGAR CanSat payload

> ⚠️ **Status:** MATCHA and SUGAR firmware/packet spec TBD. Sources registered in `phase-tracker.js` but inactive until hardware is confirmed.

---

### Vehicle Registry

| Vehicle | Project | Competition | Dashboard Tab | Backend Source | Status |
|---|---|---|---|---|---|
| **INVICTUS II** | NRC Rocket | UKSEDS NRC | Avionics | `CANSAT` + `NRC` | ✅ Active |
| **NOVARIUM II** | ORT Rover | UKSEDS ORT | Rover | `ROVER` | ✅ Active |
| **MATCHA** | MachX Rocket | EuRoC/Mach-X | Avionics | `MACHX` | 🔜 TBD |
| **SUGAR** | MachX CanSat | EuRoC/Mach-X | CanSat | `SUGAR` | 🔜 TBD |

---

### Repository Structure (updated)

```
Invictus-II/
├── backend/
│   ├── server.js           ← UOBRPL Avionics — Express + Socket.io
│   ├── phase-tracker.js    ← FSM for CANSAT, NRC, MACHX, SUGAR
│   ├── parser.js           ← Binary (CANSAT/MACHX/SUGAR) + ASCII (NRC)
│   ├── serial.js           ← Multi-port serial (CANSAT + NRC)
│   ├── rover-proxy.js      ← NOVARIUM II HTTP proxy
│   └── db.js               ← SQLite — all sources
├── dashboard/
│   ├── index.html          ← HELIOS dashboard selector
│   ├── nrc.html            ← NRC telemetry UI
│   ├── ort.html            ← NOVARIUM II rover UI
│   └── mach-x.html         ← Mach-X CanSat UI
└── Invictus-II/
    └── docs/
        ├── MISSION_LOGIC.md    ← this file
        └── HARDWARE_SETUP.md
```

---

---

# Mission Logic — Flight State Machine

**System:** Ground Station Flight State Machine
**Applies to:** All rocket/CanSat sources — CANSAT · NRC · MACHX · SUGAR
**File:** `backend/phase-tracker.js`

---

## 1. Overview

The Mission Logic is a **ground-side Finite State Machine (FSM)** that runs inside the Node.js backend. It consumes every parsed telemetry packet (1 Hz) and determines the current flight phase for each active mission source independently.

It does **not** command the rocket. It **observes, classifies, and broadcasts** flight state to the dashboard in real time.

```
Telemetry Packet (1 Hz)
        │
        ▼
  [ parser.js ]          ← decode binary / ASCII
        │
        ▼
  [ phase-tracker.js ]   ← FSM: what phase is the vehicle in?
        │
        ├──▶ [ db.js ]           ← persist state change event
        └──▶ [ socket.io ]       ← broadcast mission_event to dashboard
```

---

## 2. Mission Sources

The FSM runs **one independent state machine per source**:

| Source | Vehicle | Hardware | Packet Format | Accel | Flags |
|---|---|---|---|---|---|
| `CANSAT` | INVICTUS II | STM32 + RFM69HCW 868MHz | 37-byte binary | ✅ | ✅ |
| `NRC` | INVICTUS II | Heltec LoRa v3 868MHz | ASCII CSV `NRC2:...` | ❌ | ✅ |
| `MACHX` | MATCHA | TBD | TBD (likely 37-byte binary) | 🔜 | 🔜 |
| `SUGAR` | SUGAR CanSat | TBD | TBD | 🔜 | 🔜 |

> **Note:** ROVER (NOVARIUM II) does not use the FSM — it is controlled via HTTP, not telemetry.

---

## 3. State Machine

### 3.1 States

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   IDLE ──► LAUNCHED ──► ASCENDING ──► APOGEE ──► DESCENDING │
│                                                       │      │
│                                                    LANDED    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

| State | Meaning | Dashboard Indicator |
|---|---|---|
| `IDLE` | Pre-launch, system powered, waiting | ⚪ STANDBY |
| `LAUNCHED` | Rail exit confirmed, vehicle in boost | 🟡 LAUNCH DETECTED |
| `ASCENDING` | Motor burnout, coasting upward | 🟢 ASCENDING |
| `APOGEE` | Peak altitude reached | 🔵 APOGEE |
| `DESCENDING` | Falling under parachute/drogue | 🟠 DESCENDING |
| `LANDED` | Vehicle stationary on ground | 🔴 LANDED |

---

### 3.2 State Transition Conditions

#### IDLE → LAUNCHED

```
CANSAT / MACHX / SUGAR:
  (pkt.flags & 0x01) !== 0
  └─ Bit 0 of flags byte set by STM32 firmware
     when accel_z > 2.5g for 3 consecutive reads (SMN-001)

NRC:
  (pkt.flags & 0x01) !== 0
  └─ Bit 0 set automatically by Heltec firmware after sensor-based launch detection
```

Launch is initiated by an external device. Ground-station software only receives telemetry and derives mission phase; it cannot command launch.

**Timing constraint:** Must occur within 120 s of `npm start` in live mode.

---

#### LAUNCHED → ASCENDING

```
All sources:
  alt_history.length >= 2
  AND pkt.altitude_m > alt_history[last - 1]
  └─ At least 2 consecutive packets showing altitude gain
```

**Edge case:** GPS jitter can stall this. Use barometric altitude as primary (BMP280 for NRC, BMP388 for CANSAT).

---

#### ASCENDING → APOGEE

```
CANSAT / MACHX / SUGAR:
  (pkt.flags & 0x02) !== 0          ← firmware flag (preferred)
  OR (max_alt - pkt.altitude_m) > 5 ← 5m drop fallback

NRC:
  (pkt.flags & 0x02) !== 0          ← firmware flag (preferred)
  OR (max_alt - pkt.altitude_m) > 5 ← 5m drop fallback
```

**Risk:** 5m threshold may trigger prematurely on low-altitude test flights. Raise to 10m for tests below 100m.

---

#### APOGEE → DESCENDING

```
All sources:
  alt_history.length >= 3
  AND alt_history[last] < alt_history[last - 1]
  └─ Single packet showing altitude decrease
```

---

#### DESCENDING → LANDED

```
All sources:
  alt_history.length === 10
  AND (max(alt_history) - min(alt_history)) <= 1.0m
  └─ Altitude variance < 1m over last 10 seconds = stationary
```

**Risk:** GPS noise can exceed 1m. Increase to 3.0m or use barometric altitude.

---

## 4. Shared State Object (per source)

```javascript
{
  phase:            'IDLE',  // current FSM state
  max_alt:          0,       // metres — rolling max since boot
  launch_time:      0,       // ms — timestamp of LAUNCHED transition
  apogee_time:      0,       // ms — timestamp of APOGEE transition
  last_packet_time: 0,       // ms — used by signal watchdog
  alt_history:      []       // last 10 altitude readings (sliding window)
}
```

---

## 5. Events Emitted

### 5.1 Persisted to SQLite

```javascript
{
  source:       'CANSAT' | 'NRC' | 'MACHX' | 'SUGAR',
  event_type:   'LAUNCHED' | 'ASCENDING' | 'APOGEE' | 'DESCENDING' | 'LANDED',
  altitude_m:   float,
  timestamp_ms: uint32,
  received_at:  unix_ms
}
```

### 5.2 Broadcast via Socket.io

```
Event: 'mission_event'  →  same payload as above
```

Dashboard updates: phase banner · T+ mission clock · apogee KPI card · event log

---

## 6. Signal Watchdog

Runs in `serial.js` / `server.js` independently of FSM.

```
No packet for > 5,000 ms  →  emit('signal_lost')
Packet resumes            →  emit('signal_recovered')
```

---

## 7. Known Limitations

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | NRC can't detect LAUNCHED (no flags/accel) | NRC starts at IDLE until altitude rises | Add accel to NRC firmware or altitude-rate threshold |
| 2 | LANDED threshold (1.0m) may fail with GPS | Vehicle stuck in DESCENDING | Increase to 3.0m or use BMP388 |
| 3 | ASCENDING needs only 1 positive delta | False trigger on GPS jitter | Require 3 consecutive increases |
| 4 | No timeout on state transitions | Stuck in LAUNCHED if firmware never sets bit 0 | Add 30s timeout |
| 5 | No RESET mechanism | Can't re-arm after LANDED without restart | Add `resetState(source)` API |
| 6 | MACHX + SUGAR packet spec undefined | Sources registered but inactive | Confirm hardware, update parser.js |

---

## 8. Recommended Improvements (V2)

```javascript
// Timeout: LAUNCHED → ASCENDING after 30s if altitude rising
if (s.phase === 'LAUNCHED' && (Date.now() - s.launch_time) > 30000) {
  if (pkt.altitude_m > 10) newPhase = 'ASCENDING';
}

// Stricter ASCENDING: 3 consecutive increases
const last3 = s.alt_history.slice(-3);
const strictlyAscending = last3.length === 3 &&
  last3[2] > last3[1] && last3[1] > last3[0];

// LANDED with GPS tolerance
if (maxH - minH <= 3.0) newPhase = 'LANDED';

// Reset endpoint
app.post('/api/reset/:source', (req, res) => {
  resetState(req.params.source);
  res.json({ ok: true });
});
```

---

## 9. Integration Checklist

**INVICTUS II (NRC) — before launch day:**
- [ ] STM32 sets `flags |= 0x01` when `accel_z > 2.5g × 3`
- [ ] STM32 sets `flags |= 0x02` at detected apogee
- [ ] `npm run sim` fires all 6 states in sequence
- [ ] SQLite events table shows 6 rows per source after sim
- [ ] Dashboard phase banner updates on each transition
- [ ] `signal_lost` fires on USB unplug mid-sim
- [ ] LANDED fires within 10 packets of sim touchdown

**MATCHA + SUGAR (EuRoC) — TBD:**
- [ ] Confirm packet spec (37-byte binary or new struct)
- [ ] Update `parser.js` with MACHX + SUGAR parsers
- [ ] Confirm radio frequency and baud rate
- [ ] Add serial port config to `.env.example`

---

*Last updated: April 2026 — UOBRPL · University of Birmingham Dubai*
*Competitions: UKSEDS NRC · UKSEDS ORT · EuRoC Mach-X (EXO Events)*
