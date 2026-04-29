// UOBRPL Avionics — Flight State Machine
// Sources: CANSAT (INVICTUS II), NRC (INVICTUS II sat), MACHX (MATCHA), SUGAR (SUGAR CanSat)
// ROVER (NOVARIUM II) is HTTP-controlled and does NOT use this FSM.

const { insertEvent } = require('./db');

function makeState() {
  return { phase: 'IDLE', max_alt: 0, launch_time: 0, apogee_time: 0, last_packet_time: 0, alt_history: [] };
}

const states = {
  CANSAT: makeState(),  // INVICTUS II — STM32 + RFM69HCW 868MHz — 37-byte binary
  NRC:    makeState(),  // INVICTUS II — Heltec LoRa v3 868MHz   — ASCII CSV
  MACHX:  makeState(),  // MATCHA      — TBD                     — TBD (likely 37-byte binary)
  SUGAR:  makeState(),  // SUGAR CanSat — TBD                    — TBD
};

function processPacket(pkt, emitFn) {
  if (!pkt || !states[pkt.source]) return;
  if (!Number.isFinite(pkt.altitude_m) || !Number.isFinite(pkt.timestamp_ms)) return;

  const s = states[pkt.source];
  const packetTs = Math.trunc(pkt.timestamp_ms);
  if (s.last_packet_time && packetTs < s.last_packet_time) return;

  s.last_packet_time = packetTs;
  if (pkt.altitude_m > s.max_alt) s.max_alt = pkt.altitude_m;

  s.alt_history.push(pkt.altitude_m);
  if (s.alt_history.length > 10) s.alt_history.shift();

  let newPhase = s.phase;

  // IDLE → LAUNCHED: flags bit 0 set by firmware (accel_z > 2.5g × 3)
  // NRC: flags always 0, transition never fires — skips to ASCENDING via altitude
  if (s.phase === 'IDLE') {
    if ((pkt.flags & 0x01) !== 0) {
      newPhase = 'LAUNCHED';
      s.launch_time = packetTs;
    }
  }
  // LAUNCHED → ASCENDING: altitude increasing
  else if (s.phase === 'LAUNCHED') {
    if (s.alt_history.length >= 2 && pkt.altitude_m > s.alt_history[s.alt_history.length - 2]) {
      newPhase = 'ASCENDING';
    }
    // Timeout guard: if 30s elapsed and altitude > 10m, force ASCENDING
    if (s.launch_time && (packetTs - s.launch_time) > 30000 && pkt.altitude_m > 10) {
      newPhase = 'ASCENDING';
    }
  }
  // ASCENDING → APOGEE: firmware flag OR 5m drop from peak
  else if (s.phase === 'ASCENDING') {
    if ((pkt.flags & 0x02) !== 0 || (s.max_alt - pkt.altitude_m) > 5) {
      newPhase = 'APOGEE';
      s.apogee_time = packetTs;
    }
  }
  // APOGEE → DESCENDING: altitude decreasing
  else if (s.phase === 'APOGEE') {
    if (s.alt_history.length >= 3) {
      const isDecreasing = s.alt_history[s.alt_history.length - 1] < s.alt_history[s.alt_history.length - 2];
      if (isDecreasing) newPhase = 'DESCENDING';
    }
  }
  // DESCENDING → LANDED: altitude variance < 1m over 10 packets
  else if (s.phase === 'DESCENDING') {
    if (s.alt_history.length === 10) {
      const maxH = Math.max(...s.alt_history);
      const minH = Math.min(...s.alt_history);
      if (maxH - minH <= 1.0) newPhase = 'LANDED';
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
    console.log(`[PHASE] ${source} state reset to IDLE`);
  }
}

module.exports = { processPacket, resetState, states };
