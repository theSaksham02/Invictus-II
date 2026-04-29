# INVICTUS II — Mission Logic

**Document:** MISSION_LOGIC.md
**System:** Ground Station Flight State Machine
**Applies to:** CANSAT (STM32 + RFM69HCW) · NRC Satellite (Heltec LoRa v3)
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

The FSM runs **two independent state machines in parallel** — one per source:

| Source | Hardware | Packet Format | Accel Available | Flags Available |
|---|---|---|---|---|
| `CANSAT` | STM32 Bluepill + RFM69HCW 868MHz | 37-byte binary struct | ✅ `accel_z` (float) | ✅ `flags` byte |
| `NRC` | Heltec LoRa v3 (ESP32-S3) 868MHz | ASCII CSV `NRC:...` | ❌ hardcoded `0.0` | ❌ hardcoded `0` |

> **Important:** NRC source cannot use flag-based or accel-based transitions. It relies entirely on altitude delta logic.

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
CANSAT:  (pkt.flags & 0x01) !== 0
         └─ Bit 0 of flags byte set by STM32 firmware
            when accel_z > 2.5g for 3 consecutive reads (SMN-001)

NRC:     flags hardcoded to 0 → this transition NEVER fires for NRC
         └─ NRC enters LAUNCHED via manual override or skip to ASCENDING
```

**Timing constraint:** Must occur within 120 s of `npm start` in live mode, else signal watchdog triggers.

---

#### LAUNCHED → ASCENDING

```
CANSAT & NRC:
  alt_history.length >= 2
  AND pkt.altitude_m > alt_history[last - 1]
  └─ At least 2 consecutive packets showing altitude gain
```

**Edge case:** If two identical altitude readings arrive (GPS jitter), this transition stalls. Firmware should report BMP388 barometric altitude, not GPS altitude, for primary altitude field.

---

#### ASCENDING → APOGEE

```
CANSAT:  (pkt.flags & 0x02) !== 0         ← Bit 1 set by firmware (preferred)
         OR (max_alt - pkt.altitude_m) > 5  ← 5m drop from peak (fallback)

NRC:     (max_alt - pkt.altitude_m) > 5   ← altitude drop fallback only
         (flags always 0)
```

**Timing:** `apogee_time` is recorded in ms since firmware boot. Used for descent duration calculations.

**Risk:** The 5m threshold is tight at low altitudes. If target apogee is 670m, a 5m drop is ~0.75%. Acceptable. At lower altitudes (e.g. test flights < 100m) this may trigger prematurely — raise threshold to 10m for low-altitude tests.

---

#### APOGEE → DESCENDING

```
CANSAT & NRC:
  alt_history.length >= 3
  AND alt_history[last] < alt_history[last - 1]
  └─ Single packet showing altitude decrease
```

**Note:** This is intentionally aggressive (1 packet = transition). Under parachute at 1 Hz, descent is ~5 m/s so any decrease is real.

---

#### DESCENDING → LANDED

```
CANSAT & NRC:
  alt_history.length === 10   ← full 10-packet window
  AND (max(alt_history) - min(alt_history)) <= 1.0m
  └─ Altitude variance < 1 metre over last 10 seconds
     = vehicle is stationary on ground
```

**Risk:** GPS altitude noise can exceed 1m even when stationary. If this transition never fires, increase threshold to `<= 3.0` for GPS-primary sources. BMP388-based altitude is more stable.

---

## 4. Shared State Object (per source)

```javascript
{
  phase:           'IDLE',   // current FSM state
  max_alt:         0,        // metres — rolling max since boot
  launch_time:     0,        // ms — timestamp of LAUNCHED transition
  apogee_time:     0,        // ms — timestamp of APOGEE transition
  last_packet_time: 0,       // ms — used by signal watchdog
  alt_history:     []        // last 10 altitude readings (sliding window)
}
```

---

## 5. Events Emitted

Every state transition fires two actions simultaneously:

### 5.1 Persisted to SQLite (`db.js`)

```javascript
{
  source:       'CANSAT' | 'NRC',
  event_type:   'LAUNCHED' | 'ASCENDING' | 'APOGEE' | 'DESCENDING' | 'LANDED',
  altitude_m:   float,
  timestamp_ms: uint32,
  received_at:  unix_ms
}
```

### 5.2 Broadcast via Socket.io

```
Event name: 'mission_event'
Payload:    same object as above
```

Dashboard receives this and updates:
- Phase banner colour
- Mission clock (T+ timer starts at LAUNCHED)
- Apogee altitude KPI card
- Event log timeline

---

## 6. Signal Watchdog (separate from FSM)

Runs in `serial.js` / `server.js` — not in `phase-tracker.js`.

```
If no packet received for > 5,000 ms:
  emit('signal_lost', { source, last_seen_ms })

If packet received after signal_lost:
  emit('signal_recovered', { source, gap_ms })
```

This is **independent of flight phase** — signal can be lost during any phase.

---

## 7. Known Limitations & Improvement Targets

| # | Issue | Impact | Fix |
|---|---|---|---|
| 1 | NRC can't detect LAUNCHED (no flags, no accel) | NRC FSM starts at IDLE until altitude rises | Add accel to NRC firmware or use altitude-rate threshold |
| 2 | LANDED threshold (1.0m) may fail with GPS altitude | Vehicle shows DESCENDING forever | Increase to 3.0m or switch to BMP388 altitude for landing detection |
| 3 | ASCENDING transition requires only 1 positive delta | False trigger possible on GPS jitter | Require 3 consecutive increasing readings |
| 4 | No timeout guards on state transitions | Vehicle stuck in LAUNCHED if firmware never sets bit 0 | Add 30s timeout: if LAUNCHED and no ASCENDING, force transition |
| 5 | No phase RESET mechanism | Post-landing, FSM stays at LANDED — can't re-arm without restart | Add `resetState(source)` API endpoint for pre-launch re-arming |

---

## 8. Recommended Improvements (V2)

```javascript
// 1. Timeout guard — LAUNCHED → ASCENDING if 30s elapsed and altitude rising
if (s.phase === 'LAUNCHED' && (Date.now() - s.launch_time) > 30000) {
  if (pkt.altitude_m > 10) newPhase = 'ASCENDING';
}

// 2. Stricter ASCENDING — require 3 consecutive increases
const last3 = s.alt_history.slice(-3);
const strictlyAscending = last3.length === 3 &&
  last3[2] > last3[1] && last3[1] > last3[0];

// 3. LANDED with wider GPS tolerance
if (maxH - minH <= 3.0) newPhase = 'LANDED';

// 4. Reset endpoint in server.js
app.post('/api/reset/:source', (req, res) => {
  resetState(req.params.source);
  res.json({ ok: true });
});
```

---

## 9. Integration Checklist

Before live launch day:

- [ ] Confirm STM32 firmware sets `flags |= 0x01` when `accel_z > 2.5g × 3`
- [ ] Confirm STM32 firmware sets `flags |= 0x02` at detected apogee
- [ ] Run simulation (`npm run sim`) and verify all 6 states fire in sequence
- [ ] Check SQLite events table after sim run — 6 rows per source expected
- [ ] Verify dashboard mission_event banner updates on each transition
- [ ] Test signal_lost by unplugging USB dongle mid-sim
- [ ] Verify LANDED fires within 10 packets of sim touchdown

---

*Last updated: April 2026 — INVICTUS II · University of Birmingham Dubai · UKSEDS NRC 2025–26*
