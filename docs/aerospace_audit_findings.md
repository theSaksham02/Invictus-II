# Aerospace-Grade Audit Findings

Audit date: 2026-06-23

Scope: backend telemetry ingest, mission FSM, SD upload/import, rover proxy controls, dashboards, and all PlatformIO firmware targets.

## Critical / High

### H-1: SD upload path accepted out-of-envelope telemetry

- Evidence: `backend/server.js:214`-`262`.
- Failure mode: imported SD rows could contain physically impossible altitude, pressure, acceleration, GPS, RSSI, or flag values and still enter the mission database.
- Mission impact: corrupted post-flight apogee summaries and exports could look authoritative during competition review.
- Status: fixed. SD upload rows now use the same telemetry envelope as live parsers and skip invalid rows.
- Verification: `backend/tests/upload-sd-api.test.js` covers out-of-range row rejection and row-count limits.

### H-2: External-launch safety boundary must remain hard

- Evidence: no `/api/launch` route exists in `backend/server.js`; `backend/serial.js` exports only `initSerial`, `getSignalState`, and `shutdown`.
- Failure mode if regressed: ground software could become a launch actuator instead of a telemetry observer.
- Mission impact: unacceptable safety and rules-compliance risk.
- Status: guarded by tests. `backend/tests/launch-api.test.js` verifies `/api/launch` is unavailable and no serial launch command export exists.

## Medium

### M-1: Phase FSM treated any timestamp rollback as MCU reboot

- Evidence: `backend/phase-tracker.js:68`-`83`.
- Failure mode: duplicate or slightly out-of-order telemetry could reset phase state and corrupt mission event sequencing.
- Mission impact: dashboard phase and mission log could jump backward during marginal links or replayed serial data.
- Status: fixed. Exact duplicates and rollbacks within a 1000 ms grace window are ignored and counted; larger rollbacks still reset as MCU reboot candidates.
- Verification: `backend/tests/phase-tracker.test.js` covers duplicate, near out-of-order, and reboot rollback behavior.

### M-2: MACHX diagnostics were incomplete in health/shutdown paths

- Evidence: `backend/server.js:360`-`370`, `backend/serial.js:271`-`285`.
- Failure mode: `/api/health` could report no serial connection when MACHX was the only live source; shutdown left the MACHX connection flag stale.
- Mission impact: operator diagnostics could misreport live telemetry health.
- Status: fixed and tested.

### M-3: Rover command authorization needed explicit regression coverage

- Evidence: `backend/server.js:299`-`308`, `backend/server.js:542`-`557`.
- Failure mode if regressed: rover movement commands could be proxied without the configured token.
- Mission impact: uncontrolled rover motion risk during ground operations.
- Status: guarded by tests. Unauthorized control requests are denied before proxying.

## Open Hardware-Facing Risks

### M-4: CanSat SD write failure did not clear `FLAG_SD_OK`

- Evidence: `firmware/cansat/src/main.cpp:407`-`424`.
- Failure mode: `logFile.print()` or delayed `flush()` can fail while telemetry continues advertising SD as healthy.
- Mission impact: operators may believe onboard recovery data is being written when it is not.
- Status: fixed. Short writes now clear `FLAG_SD_OK`, emit a compact serial warning, and skip further flush attempts while SD is marked unhealthy.

### O-1: ESP32-CAM recording directory creation and SD write failures need latch-state telemetry

- Evidence: `firmware/nrc-camera/src/main.cpp:121`-`168`.
- Failure mode: directory creation is not checked; repeated write failures only print serial messages.
- Mission impact: camera may appear alive but record no recoverable frames.
- Proposed fix: check `mkdir`, bound recording folder search, track consecutive write failures, and switch LED pattern to a persistent storage-fault state.

### O-2: STM32 CanSat flash margin is tight

- Evidence: `pio run -d firmware/cansat` reports 93.0% flash usage.
- Failure mode: future safety additions can exceed flash or force rushed removals.
- Mission impact: robustness work may become constrained late in integration.
- Proposed fix: keep firmware changes branch-by-branch and compile after each change; prefer fixed-size checks over new dependencies.

## Verification Baseline

- `npm test` and `npm run check` in `backend`.
- `pio run -d firmware/cansat`.
- `pio run -d firmware/nrc`.
- `pio run -d firmware/ground-station`.
- `pio run -d firmware/nrc-camera`.
