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
