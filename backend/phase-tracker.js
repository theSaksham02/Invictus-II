const { insertEvent } = require('./db');

const states = {
  CANSAT: { phase: 'IDLE', max_alt: 0, launch_time: 0, apogee_time: 0, last_packet_time: 0, alt_history: [] },
  NRC:    { phase: 'IDLE', max_alt: 0, launch_time: 0, apogee_time: 0, last_packet_time: 0, alt_history: [] }
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

  if (s.phase === 'IDLE') {
    if ((pkt.flags & 0x01) !== 0) newPhase = 'LAUNCHED';
  } 
  else if (s.phase === 'LAUNCHED') {
    if (s.alt_history.length >= 2 && pkt.altitude_m > s.alt_history[s.alt_history.length - 2]) {
      newPhase = 'ASCENDING';
    }
  }
  else if (s.phase === 'ASCENDING') {
    if ((pkt.flags & 0x02) !== 0 || (s.max_alt - pkt.altitude_m) > 5) {
      newPhase = 'APOGEE';
      s.apogee_time = pkt.timestamp_ms;
    }
  }
  else if (s.phase === 'APOGEE') {
    if (s.alt_history.length >= 3) {
      const isDecreasing = s.alt_history[s.alt_history.length-1] < s.alt_history[s.alt_history.length-2];
      if (isDecreasing) newPhase = 'DESCENDING';
    }
  }
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
      source: pkt.source,
      event_type: newPhase,
      altitude_m: pkt.altitude_m,
      timestamp_ms: packetTs,
      received_at: pkt.received_at
    };
    try {
      insertEvent(ev);
      emitFn('mission_event', ev);
    } catch (error) {
      console.error('[PHASE] event publish failed:', error.message);
    }
  }
}

module.exports = { processPacket, states };
