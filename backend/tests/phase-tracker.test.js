const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './db') {
    return {
      insertEvent: () => ({ changes: 1 })
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { processPacket, resetState, states } = require('../phase-tracker');

function packet(source, pktId, timestampMs, altitudeM, flags = 0) {
  return {
    source,
    pkt_id: pktId,
    timestamp_ms: timestampMs,
    altitude_m: altitudeM,
    temp_c: 20,
    pressure_hpa: 1013,
    accel_z: 1,
    gyro_x: 0,
    lat: 25,
    lon: 55,
    rssi_dbm: -60,
    flags,
    raw: '',
    received_at: Date.now()
  };
}

test('NRC enters ASCENDING from altitude gain and repeated upward threshold changes', () => {
  resetState('NRC');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  processPacket(packet('NRC', 1, 1000, 0), emit);
  processPacket(packet('NRC', 2, 2000, 6), emit);
  processPacket(packet('NRC', 3, 3000, 12), emit);

  assert.equal(states.NRC.phase, 'ASCENDING');
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'mission_event');
  assert.equal(events[0].payload.event_type, 'ASCENDING');
});

test('phase tracker ignores launch flags and stays GROUNDED without altitude threshold changes', () => {
  resetState('NRC');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  processPacket(packet('NRC', 1, 1000, 0), emit);
  processPacket(packet('NRC', 2, 2000, 1, 0x03), emit);

  assert.equal(states.NRC.phase, 'GROUNDED');
  assert.equal(events.length, 0);
});

test('NRC progresses through APOGEE, DESCENDING, and LANDED from altitude changes', () => {
  resetState('NRC');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  [
    [1, 1000, 0],
    [2, 2000, 6],
    [3, 3000, 12],
    [4, 4000, 20],
    [5, 5000, 32],
    [6, 6000, 44],
    [7, 7000, 50],
    [8, 8000, 44],
    [9, 9000, 38],
    [10, 10000, 32],
    [11, 11000, 26],
    [12, 12000, 20],
    [13, 13000, 14],
    [14, 14000, 8],
    [15, 15000, 2],
    [16, 16000, 1.6],
    [17, 17000, 1.4],
    [18, 18000, 1.2],
    [19, 19000, 1.1],
    [20, 20000, 1.0],
    [21, 21000, 1.0],
    [22, 22000, 1.1],
    [23, 23000, 1.0],
    [24, 24000, 1.0]
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('NRC', pktId, timestampMs, altitudeM), emit);
  });

  assert.equal(states.NRC.phase, 'LANDED');
  assert.deepEqual(events.map(({ payload }) => payload.event_type), [
    'ASCENDING',
    'APOGEE',
    'DESCENDING',
    'LANDED'
  ]);
});

test('MACHX progresses through PAD, LAUNCHED, ASCENT, APOGEE, DESCENT, MAIN, and LANDED', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  [
    [1, 1000, 0],
    [2, 2000, 16], // LAUNCHED (>= 15m)
    [3, 3000, 30],
    [4, 4000, 45], // ASCENT (rising by threshold)
    [5, 5000, 3000],
    [6, 6000, 3010], // APOGEE altitude
    [7, 7000, 2980], // Drop by >20m = APOGEE state
    [8, 8000, 2960],
    [9, 9000, 2940], // DESCENT state
    [10, 10000, 499], // MAIN state (<= 500m)
    [11, 11000, 1.0],
    [12, 12000, 1.1],
    [13, 13000, 1.0],
    [14, 14000, 1.2],
    [15, 15000, 1.0],
    [16, 16000, 1.0],
    [17, 17000, 1.1],
    [18, 18000, 1.0],
    [19, 19000, 1.0],
    [20, 20000, 1.0] // LANDED
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('MACHX', pktId, timestampMs, altitudeM), emit);
  });

  assert.equal(states.MACHX.phase, 'LANDED');
  assert.deepEqual(events.map(({ payload }) => payload.event_type), [
    'LAUNCHED',
    'ASCENT',
    'APOGEE',
    'DESCENT',
    'MAIN',
    'LANDED'
  ]);
});

test('phase tracker resets state on timestamp rollback (MCU reboot)', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  processPacket(packet('MACHX', 1, 1000, 10), emit);
  processPacket(packet('MACHX', 2, 2000, 15), emit);
  
  // MCU resets, timestamp rolls back to 500
  processPacket(packet('MACHX', 3, 500, 20), emit);

  // Check that the state was reset
  assert.equal(states.MACHX.last_packet_time, 500);
  assert.equal(states.MACHX.baseline_alt, 20);
});

test('phase tracker ignores duplicate and near out-of-order packets without changing phase', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  [
    [1, 1000, 0],
    [2, 2000, 16],
    [3, 3000, 30],
    [4, 4000, 45]
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('MACHX', pktId, timestampMs, altitudeM), emit);
  });

  assert.equal(states.MACHX.phase, 'ASCENT');
  const eventCount = events.length;

  processPacket(packet('MACHX', 4, 4000, 45), emit);
  processPacket(packet('MACHX', 5, 3500, 1000), emit);

  assert.equal(states.MACHX.phase, 'ASCENT');
  assert.equal(states.MACHX.last_packet_time, 4000);
  assert.equal(states.MACHX.ignored_out_of_order, 2);
  assert.equal(events.length, eventCount);
});

test('MACHX apogee logic ignores single-sample dip', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  // Go to ASCENT phase
  [
    [1, 1000, 0],
    [2, 2000, 16], // LAUNCHED
    [3, 3000, 30],
    [4, 4000, 45], // ASCENT
    [5, 5000, 1000] // ASCENT continues
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('MACHX', pktId, timestampMs, altitudeM), emit);
  });

  assert.equal(states.MACHX.phase, 'ASCENT');

  // Single sample dip: alt drops to 975 (drop = 25m, fallingByThreshold = true)
  processPacket(packet('MACHX', 6, 6000, 975), emit);
  // Phase should still be ASCENT because confirmation count is only 1 (needs 3)
  assert.equal(states.MACHX.phase, 'ASCENT');

  // Immediately recovers/ascends: alt goes to 1010
  processPacket(packet('MACHX', 7, 7000, 1010), emit);
  // Descent confirmation count should reset to 0
  assert.equal(states.MACHX.descent_confirm_count, 0);
  assert.equal(states.MACHX.phase, 'ASCENT');
});

test('MACHX apogee logic triggers on sustained descent', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  // Go to ASCENT phase
  [
    [1, 1000, 0],
    [2, 2000, 16], // LAUNCHED
    [3, 3000, 30],
    [4, 4000, 45], // ASCENT
    [5, 5000, 1000] // Max altitude
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('MACHX', pktId, timestampMs, altitudeM), emit);
  });

  // Sustained descent (3 samples)
  processPacket(packet('MACHX', 6, 6000, 979), emit); // sample 1: drop 21m, fallingByThreshold
  assert.equal(states.MACHX.phase, 'ASCENT');
  
  processPacket(packet('MACHX', 7, 7000, 958), emit); // sample 2: drop 42m, fallingByThreshold
  assert.equal(states.MACHX.phase, 'ASCENT');

  processPacket(packet('MACHX', 8, 8000, 937), emit); // sample 3: drop 63m, fallingByThreshold
  assert.equal(states.MACHX.phase, 'APOGEE');
});

test('MACHX apogee logic does not trigger if max altitude is sub-threshold', () => {
  resetState('MACHX');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  // Max altitude is only 250m (threshold is 300m)
  [
    [1, 1000, 0],
    [2, 2000, 16], // LAUNCHED
    [3, 3000, 30],
    [4, 4000, 45], // ASCENT
    [5, 5000, 250] // Max altitude (below 300m)
  ].forEach(([pktId, timestampMs, altitudeM]) => {
    processPacket(packet('MACHX', pktId, timestampMs, altitudeM), emit);
  });

  // Sustained descent (3 samples) below 300m
  processPacket(packet('MACHX', 6, 6000, 229), emit); 
  processPacket(packet('MACHX', 7, 7000, 208), emit); 
  processPacket(packet('MACHX', 8, 8000, 187), emit); 

  // Should NOT trigger APOGEE because max altitude was 250m (< 300m)
  assert.notEqual(states.MACHX.phase, 'APOGEE');
});
