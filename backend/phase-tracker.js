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

const LAUNCH_ALTITUDE_DELTA_M = 10.0;
const ASCENT_STEP_THRESHOLD_M = 1.0;
const APOGEE_DROP_M = 5.0;
const DESCENT_STEP_THRESHOLD_M = 1.0;
const LANDED_VARIANCE_M = 1.0;
const LANDED_WINDOW_SIZE = 10;

function makeState() {
  return {
    phase: PHASE_GROUNDED,
    baseline_alt: null,
    max_alt: 0,
    launch_time: 0,
    apogee_time: 0,
    last_packet_time: 0,
    alt_history: []
  };
}

const states = {
  CANSAT: makeState(),  // MachX competition — STM32 + RFM69HCW 433MHz — 43-byte binary v2
  NRC:    makeState(),  // NRC competition  — Heltec LoRa V3 868MHz    — ASCII CSV NRC2:
  MACHX:  makeState(),  // MATCHA           — TBD                      — TBD
  SUGAR:  makeState(),  // SUGAR CanSat     — TBD                      — TBD
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

  if (s.phase === PHASE_GROUNDED) {
    if (altitudeGain >= LAUNCH_ALTITUDE_DELTA_M && risingByThreshold) {
      newPhase = PHASE_ASCENDING;
      s.launch_time = packetTs;
    }
  }
  else if (s.phase === PHASE_ASCENDING) {
    if ((s.max_alt - pkt.altitude_m) >= APOGEE_DROP_M) {
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

// Reset a source FSM (e.g. pre-launch re-arming)
function resetState(source) {
  if (states[source]) {
    states[source] = makeState();
    console.log(`[PHASE] ${source} state reset to ${PHASE_GROUNDED}`);
  }
}

module.exports = { processPacket, resetState, states };
