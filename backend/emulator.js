const { SerialPortMock } = require('serialport');
const {
  CANSAT_SOURCE_ID,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_VERSION,
  crc16Ccitt
} = require('./cansat-hardware');

// ─────────────────────────────────────────────────────────────────────────────
// BENCH-TEST PHYSICS CONSTANTS  (BENCH_ALT=true mode)
//
// Physical setup:
//   Peak altitude : 3.05 m  (10.0 ft)
//   Launch window : tick 10–20  (10 second powered ascent)
//   Apogee        : tick 20–22  (2 second coasting)
//   Descent       : tick 22–45  (23 second parachute descent)
//   Landed        : tick 45+    (stationary on ground)
//
// Dashboard mappings we must satisfy:
//   accelRaw  = (accel_z - 1.0) * 9.81   → want 1–2 m/s²  → send accel_z 1.10–1.20
//   G-force   = accel_z                   → want 1.00–1.20 G
//   Pitch     = accel_z > 1.5 ? 90 : 0°  → keep accel_z < 1.5 so pitch stays ≈ 0°
//   Roll rate = gyro_x (°/s)              → small 0.5–2.5°/s
//   Velocity  = Δalt/Δt (m/s)            → derived automatically from smooth altitude
//   Pressure  = barometric formula        → Δ ≈ 0.36 hPa at 3.05m (barely moves)
//   Temp      = constant ≈ 22.5°C        → ±0.1°C noise (room temp bench test)
//   RSSI      = −55 to −62 dBm           → small ±3 dBm jitter (radio 2m away)
//   GPS       = fixed Dubai coords       → ±0.00001° noise (bench doesn't move)
// ─────────────────────────────────────────────────────────────────────────────

let interval;
let tick = 0;

// UAE (University of Birmingham Dubai) base coordinates
const BASE_LAT = 25.10366;
const BASE_LON = 55.15535;

// Persistent state for smooth noise (EMA low-pass)
let tempEma    = 22.50;
let rssiEma    = -57;
let gyroEma    = 0.8;
let accelEma   = 1.0;

function rnd(lo, hi) { return lo + Math.random() * (hi - lo); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Low-pass EMA filter: smoothly converge toward target with noise
function ema(current, target, alpha, noise = 0) {
  return current + alpha * (target - current) + (Math.random() * noise * 2 - noise);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALTITUDE CURVE — smooth, realistic 10-foot bench launch
//
// Uses a sine-based ascent for realism instead of piecewise linear.
// Profile (bench mode):
//   0–9s   PRE-FLIGHT : ±0.02m baro noise at ground
//   10–20s ASCENDING  : smooth climb from 0 to 3.05m
//   20–22s APOGEE     : holding peak with tiny oscillation
//   22–55s DESCENDING : smooth exponential decay back to 0
//   55s+   LANDED     : ±0.01m noise at ground
// ─────────────────────────────────────────────────────────────────────────────
function benchAltitude(t) {
  if (t < 10) {
    // PRE-FLIGHT: on the pad
    return Math.max(0, rnd(-0.02, 0.02));
  } else if (t < 20) {
    // ASCENDING: smooth sine rise from 0 to 3.05m over 10 ticks
    const progress = (t - 10) / 10; // 0 → 1
    const alt = 3.05 * Math.sin(progress * Math.PI / 2); // sine ease-in
    return alt + rnd(-0.02, 0.02);
  } else if (t < 22) {
    // APOGEE: holding near peak
    return 3.05 + rnd(-0.04, 0.04);
  } else if (t < 55) {
    // DESCENDING: exponential decay from 3.05m to 0
    const progress = (t - 22) / 33; // 0 → 1
    const alt = 3.05 * Math.exp(-3.5 * progress);
    return Math.max(0, alt + rnd(-0.02, 0.02));
  } else {
    // LANDED: stationary
    return Math.max(0, rnd(-0.01, 0.01));
  }
}

// Full-flight altitude (original 660m profile, used when BENCH_ALT is false)
function fullAltitude(t) {
  if (t < 30) {
    return rnd(-0.2, 0.2);
  } else if (t < 90) {
    return (t - 30) * 10 + rnd(-2, 2);
  } else if (t < 95) {
    return 600 + (t - 90) * 14 - 1.5 * Math.pow(t - 90, 2) + rnd(-2, 2);
  } else if (t < 180) {
    return Math.max(0, 660 - (t - 95) * 7 + rnd(-2, 2));
  } else {
    return rnd(-0.2, 0.2);
  }
}

function startEmulator() {
  if (interval) return;
  console.log('[HITL EMULATOR] 🚀 Hardware-in-the-loop byte-level emulator starting...');

  const cansatPath = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
  const nrcPath    = process.env.SERIAL_PORT_NRC    || '/dev/ttyUSB1';
  const benchMode  = process.env.BENCH_ALT === 'true';

  if (benchMode) {
    console.log('[HITL EMULATOR] 🏗️  BENCH MODE active — 10-ft altitude profile, constant room temp');
  }

  // Create virtual hardware ports
  try {
    SerialPortMock.binding.createPort(cansatPath, { echo: false, record: false });
  } catch (err) {
    if (!/exists|exist|already/i.test(err.message)) throw err;
  }
  if (cansatPath !== nrcPath) {
    try {
      SerialPortMock.binding.createPort(nrcPath, { echo: false, record: false });
    } catch (err) {
      if (!/exists|exist|already/i.test(err.message)) throw err;
    }
  }

  // Reset persistent state
  tick     = 0;
  tempEma  = 22.50;
  rssiEma  = -57;
  gyroEma  = 0.8;
  accelEma = 1.0;

  const lat0 = BASE_LAT;
  const lon0 = BASE_LON;

  interval = setInterval(() => {
    tick++;

    // ── 1. ALTITUDE ────────────────────────────────────────────────────────
    const alt = benchMode ? benchAltitude(tick) : fullAltitude(tick);

    // ── 2. PHASE THRESHOLDS ────────────────────────────────────────────────
    // Bench:   launch@10, apogee@20, landed@55
    // Full:    launch@30, apogee@90, landed@180
    const T_LAUNCH = benchMode ? 10  : 30;
    const T_APOGEE = benchMode ? 20  : 90;
    const T_LANDED = benchMode ? 55  : 180;

    const isAscending  = tick >= T_LAUNCH && tick < T_APOGEE;
    const isApogee     = tick >= T_APOGEE && tick < T_APOGEE + 2;
    const isDescending = tick >= T_APOGEE + 2 && tick < T_LANDED;
    const isLanded     = tick >= T_LANDED;

    // ── 3. TEMPERATURE ─────────────────────────────────────────────────────
    // Bench: constant room temp 22.0–24.0°C with slow drift (not spiky)
    // Full:  standard lapse rate
    let tempTarget;
    if (benchMode) {
      // Very slow meander between 22.0 and 24.0 using a sine wave
      tempTarget = 22.50 + 0.75 * Math.sin(tick * 0.08) + 0.5 * Math.sin(tick * 0.03);
    } else {
      tempTarget = 20.0 - alt * 0.0065;
    }
    tempEma = ema(tempEma, tempTarget, 0.08, benchMode ? 0.02 : 0.15);
    const temp = clamp(tempEma, benchMode ? 22.0 : -80, benchMode ? 24.0 : 50);

    // ── 4. PRESSURE ────────────────────────────────────────────────────────
    // At 3.05m peak, ΔP ≈ 0.36 hPa — barely moves.
    // Formula is accurate barometric: small smooth dip during ascent, returns on descent.
    const pressure = 1013.25 * Math.pow(1 - 2.25577e-5 * Math.max(0, alt), 5.25588);
    // Add tiny noise (BMP280 is ±1 hPa absolute, but ±0.02 hPa relative)
    const pressureOut = pressure + rnd(-0.015, 0.015);

    // ── 5. ACCELERATION (accel_z) ─────────────────────────────────────────
    // Dashboard formula: displayed_accel = (accel_z - 1.0) * 9.81 m/s²
    // At rest:          accel_z = 1.00  → 0.0 m/s²  (1G gravity reading)
    // During ascent:    accel_z = 1.10–1.20  → 0.98–1.96 m/s²
    // At apogee:        accel_z → 1.00 smoothly
    // During descent:   accel_z = 0.95–1.00  → slight negative (drag)
    // Landed:           accel_z = 1.00 ± 0.01
    let accelTarget;
    if (isAscending) {
      accelTarget = rnd(1.10, 1.20);  // gentle push: 1.0–2.0 m/s² net
    } else if (isApogee) {
      accelTarget = rnd(0.97, 1.02);  // near weightless briefly
    } else if (isDescending) {
      accelTarget = rnd(0.96, 1.02);  // light drag force
    } else {
      accelTarget = 1.00 + rnd(-0.01, 0.01); // resting on ground
    }
    accelEma = ema(accelEma, accelTarget, 0.25, 0.005);
    const accelZ = clamp(accelEma, 0.85, 1.50);

    // ── 6. GYRO (gyro_x — roll rate in °/s) ──────────────────────────────
    // Dashboard: shown as roll rate °/s and drives 3D rocket rotation.
    // Bench test: rocket is mostly still, very small wobble.
    // During ascent: tiny vibration 0.5–2.5°/s
    // At rest: nearly 0
    let gyroTarget;
    if (isAscending) {
      gyroTarget = rnd(0.5, 2.5);
    } else if (isApogee) {
      gyroTarget = rnd(0.3, 1.2);
    } else if (isDescending) {
      gyroTarget = rnd(0.2, 0.8);
    } else {
      gyroTarget = rnd(0.0, 0.3);
    }
    gyroEma = ema(gyroEma, gyroTarget, 0.18, 0.05);
    const gyroX = clamp(Math.abs(gyroEma), 0.0, 5.0);

    // ── 7. RSSI ────────────────────────────────────────────────────────────
    // Bench test: radio is 1–2m from rocket, very stable signal.
    // −55 to −62 dBm with ±3 dBm slow jitter.
    // No dramatic drops unless we fake a LoRa drop.
    const rssiTarget = -57 + (isAscending ? -2 : 0) + rnd(-1.5, 1.5);
    rssiEma = ema(rssiEma, rssiTarget, 0.15, 0.5);
    const rssi = Math.round(clamp(rssiEma, -70, -50));

    // ── 8. GPS ─────────────────────────────────────────────────────────────
    // Bench test: rocket doesn't move laterally at all.
    // Just add ±0.00001° GPS noise (≈1.1m) which is realistic for NEO-6M indoors.
    const lat = lat0 + rnd(-0.000008, 0.000008);
    const lon = lon0 + rnd(-0.000008, 0.000008);

    // ── 9. FLAGS ───────────────────────────────────────────────────────────
    let flags = 0;
    if (tick >= T_LAUNCH)         flags |= 0x01; // launched
    if (tick >= T_APOGEE)         flags |= 0x02; // apogee
    if (tick >= 5)                flags |= 0x04; // gps_fix
    if (tick >= 2)                flags |= 0x08; // bmp_ok
    if (tick >= 3)                flags |= 0x10; // mpu_ok
    if (tick >= 4)                flags |= 0x20; // sd_ok

    // ═══════════════════════════════════════════════════════════
    // CANSAT BINARY PACKET  (v2 fixed frame, 43 bytes LE)
    // ═══════════════════════════════════════════════════════════
    const buf = Buffer.alloc(PACKET_LENGTH_BYTES);
    buf.writeUInt16LE(PACKET_SYNC,                   0);
    buf.writeUInt8(PACKET_VERSION,                   2);
    buf.writeUInt8(CANSAT_SOURCE_ID,                 3);
    buf.writeUInt8(PACKET_PAYLOAD_LENGTH_BYTES,      4);
    buf.writeUInt16LE(tick,                          5);  // pkt_id
    buf.writeUInt32LE(tick * 1000,                   7);  // timestamp_ms
    buf.writeFloatLE(alt,                            11); // altitude_m
    buf.writeFloatLE(temp,                           15); // temp_c
    buf.writeFloatLE(pressureOut,                    19); // pressure_hpa
    buf.writeFloatLE(accelZ,                         23); // accel_z
    buf.writeFloatLE(gyroX,                          27); // gyro_x
    buf.writeFloatLE(lat,                            31); // lat
    buf.writeFloatLE(lon,                            35); // lon
    buf.writeInt8(rssi,                              39); // rssi_dbm
    buf.writeUInt8(flags,                            40); // flags

    let crc = crc16Ccitt(buf, PACKET_LENGTH_BYTES - 2);
    // 5% CANSAT RF corruption (realistic packet drop)
    if (Math.random() < 0.05) {
      console.log(`[HITL EMULATOR] ⚠️  Simulating CANSAT RF corruption on pkt ${tick}`);
      crc ^= 0xffff;
    }
    buf.writeUInt16LE(crc, PACKET_LENGTH_BYTES - 2);

    if (global.mockCansat && global.mockCansat.isOpen && global.mockCansat.port) {
      global.mockCansat.port.emitData(buf);
    }

    // ═══════════════════════════════════════════════════════════
    // NRC ASCII PACKET  (NRC2: comma-separated + CRC16)
    // ═══════════════════════════════════════════════════════════
    let nrcFlags = 0;
    if (tick >= T_LAUNCH) nrcFlags |= 0x01; // FLAG_LAUNCHED
    if (tick >= T_APOGEE) nrcFlags |= 0x02; // FLAG_APOGEE
    if (tick >= 5)        nrcFlags |= 0x04; // FLAG_GPS_FIX
    if (tick >= 2)        nrcFlags |= 0x08; // FLAG_BARO_OK
    if (tick >= 4)        nrcFlags |= 0x20; // FLAG_SD_OK

    const nrcBody = [
      tick,
      tick * 1000,
      alt.toFixed(2),
      temp.toFixed(2),
      pressureOut.toFixed(2),
      lat.toFixed(6),
      lon.toFixed(6),
      rssi,
      nrcFlags
    ].join(',');

    const nrcCrc = crc16Ccitt(Buffer.from(nrcBody, 'utf8'))
      .toString(16).toUpperCase().padStart(4, '0');
    const nrcStr = `NRC2:${nrcBody},${nrcCrc}\n`;

    // 5% NRC LoRa drop
    if (Math.random() < 0.05) {
      console.log(`[HITL EMULATOR] ⚠️  Simulating NRC LoRa drop on pkt ${tick}`);
    } else {
      if (global.mockNrc && global.mockNrc.isOpen && global.mockNrc.port) {
        global.mockNrc.port.emitData(Buffer.from(nrcStr, 'utf-8'));
      }
    }

  }, 1000);
}

function stopEmulator() {
  if (interval) clearInterval(interval);
  interval = null;
}

module.exports = { startEmulator, stopEmulator };
