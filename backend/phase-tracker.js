// UOBRPL Avionics — Flight State Machine
// Competitions: MachX (CanSat in bigger rocket), NRC (standalone rocket), NRC Rover (later)
// Sources: CANSAT (MachX — STM32 + RFM69HCW), NRC (NRC Rocket — Heltec LoRa V3 + LoRa 868MHz)
// ROVER (NRC Rover) is HTTP-controlled and does NOT use this FSM.

const { insertEvent } = require('./db');

const PHASE_GROUNDED = 'GROUNDED';
const PHASE_ASCENDING = 'ASCENDING';
const PHASE_APOGEE = 'APOGEE';
const PHASE_DESCENDING = 'DESCENDING';
const PHASE_LANDED = 'LANDED';

const PHASE_PAD = 'PAD';
const PHASE_LAUNCHED = 'LAUNCHED';
const PHASE_ASCENT = 'ASCENT';
const PHASE_DESCENT = 'DESCENT';
const PHASE_MAIN = 'MAIN';

const LEGACY_LAUNCH_ALTITUDE_DELTA_M = 5.0;
const MACHX_LAUNCH_ALTITUDE_DELTA_M = 15.0;

const ASCENT_STEP_THRESHOLD_M = 1.0;

const LEGACY_APOGEE_DROP_M = 5.0;
const MACHX_APOGEE_DROP_M = 20.0;
const MACHX_APOGEE_CONFIRM_SAMPLES = 3;
const MACHX_APOGEE_MIN_ALTITUDE_M = 300.0;

const DESCENT_STEP_THRESHOLD_M = 1.0;
const MAIN_DEPLOY_ALTITUDE_M = 500.0;

const LANDED_VARIANCE_M = 1.0;
const LANDED_WINDOW_SIZE = 10;

function makeState(source) {
  const isLegacy = source === 'NRC' || source === 'CANSAT';
  return {
    isLegacy,
    phase: isLegacy ? PHASE_GROUNDED : PHASE_PAD,
    baseline_alt: null,
    max_alt: 0,
    launch_time: 0,
    apogee_time: 0,
    last_packet_time: 0,
    descent_confirm_count: 0,
    alt_history: []
  };
}

const states = {
  CANSAT: makeState('CANSAT'),
  NRC:    makeState('NRC'),
  MACHX:  makeState('MACHX'),
  SUGAR:  makeState('SUGAR'),
};

function processPacket(pkt, emitFn) {
  if (!pkt || !states[pkt.source]) return;
  if (!Number.isFinite(pkt.altitude_m) || !Number.isFinite(pkt.timestamp_ms)) return;

  const s = states[pkt.source];
  const packetTs = Math.trunc(pkt.timestamp_ms);
  if (s.last_packet_time && packetTs < s.last_packet_time) return;

  s.last_packet_time = packetTs;
  if (s.baseline_alt === null) s.baseline_alt = pkt.altitude_m;
  if (pkt.altitude_m > s.max_alt) s.max_alt = pkt.altitude_m;

  s.alt_history.push(pkt.altitude_m);
  if (s.alt_history.length > LANDED_WINDOW_SIZE) s.alt_history.shift();

  let newPhase = s.phase;
  const recent = s.alt_history.slice(-3);
  const altitudeGain = pkt.altitude_m - s.baseline_alt;
  const risingByThreshold = recent.length >= 3 &&
    (recent[1] - recent[0]) >= ASCENT_STEP_THRESHOLD_M &&
    (recent[2] - recent[1]) >= ASCENT_STEP_THRESHOLD_M;
  const fallingByThreshold = recent.length >= 2 &&
    (recent[recent.length - 2] - recent[recent.length - 1]) >= DESCENT_STEP_THRESHOLD_M;

  if (s.isLegacy) {
    if (s.phase === PHASE_GROUNDED) {
      if (altitudeGain >= LEGACY_LAUNCH_ALTITUDE_DELTA_M && risingByThreshold) {
        newPhase = PHASE_ASCENDING;
        s.launch_time = packetTs;
      }
    }
    else if (s.phase === PHASE_ASCENDING) {
      if ((s.max_alt - pkt.altitude_m) >= LEGACY_APOGEE_DROP_M) {
        newPhase = PHASE_APOGEE;
        s.apogee_time = packetTs;
      }
    }
    else if (s.phase === PHASE_APOGEE) {
      if (fallingByThreshold) newPhase = PHASE_DESCENDING;
    }
    else if (s.phase === PHASE_DESCENDING) {
      if (s.alt_history.length === LANDED_WINDOW_SIZE) {
        const maxH = Math.max(...s.alt_history);
        const minH = Math.min(...s.alt_history);
        if (maxH - minH <= LANDED_VARIANCE_M) newPhase = PHASE_LANDED;
      }
    }
  } else {
    // MACHX / SUGAR Logic
    if (s.phase === PHASE_PAD) {
      if (altitudeGain >= MACHX_LAUNCH_ALTITUDE_DELTA_M && risingByThreshold) {
        newPhase = PHASE_LAUNCHED;
        s.launch_time = packetTs;
      }
    }
    else if (s.phase === PHASE_LAUNCHED) {
      if (risingByThreshold) {
        newPhase = PHASE_ASCENT;
      }
    }
    else if (s.phase === PHASE_ASCENT) {
      const drop = s.max_alt - pkt.altitude_m;
      const apogeeCandidate = 
        drop >= MACHX_APOGEE_DROP_M &&
        fallingByThreshold &&
        s.max_alt >= MACHX_APOGEE_MIN_ALTITUDE_M;
        
      s.descent_confirm_count = apogeeCandidate ? s.descent_confirm_count + 1 : 0;
      
      if (s.descent_confirm_count >= MACHX_APOGEE_CONFIRM_SAMPLES) {
        newPhase = PHASE_APOGEE;
        s.apogee_time = packetTs;
        s.descent_confirm_count = 0;
      }
    }
    else if (s.phase === PHASE_APOGEE) {
      if (fallingByThreshold) newPhase = PHASE_DESCENT;
    }
    else if (s.phase === PHASE_DESCENT) {
      if (pkt.altitude_m <= s.baseline_alt + MAIN_DEPLOY_ALTITUDE_M) {
        newPhase = PHASE_MAIN;
      }
    }
    else if (s.phase === PHASE_MAIN) {
      if (s.alt_history.length === LANDED_WINDOW_SIZE) {
        const maxH = Math.max(...s.alt_history);
        const minH = Math.min(...s.alt_history);
        if (maxH - minH <= LANDED_VARIANCE_M) newPhase = PHASE_LANDED;
      }
    }
  }

  if (newPhase !== s.phase) {
    s.phase = newPhase;
    const ev = {
      source:       pkt.source,
      event_type:   newPhase,
      altitude_m:   pkt.altitude_m,
      timestamp_ms: packetTs,
      received_at:  pkt.received_at
    };
    try {
      insertEvent(ev);
      emitFn('mission_event', ev);
    } catch (error) {
      console.error('[PHASE] event publish failed:', error.message);
    }
  }
}

function resetState(source) {
  if (states[source]) {
    states[source] = makeState(source);
    console.log(`[PHASE] ${source} state reset to ${states[source].phase}`);
  }
}

module.exports = { processPacket, resetState, states };
