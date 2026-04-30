const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

process.env.DB_FILE = path.join(os.tmpdir(), `invictus-phase-tracker-${process.pid}.db`);

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

test('NRC can enter ASCENDING from altitude trend without firmware flags', () => {
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

test('CANSAT launch flag still produces LAUNCHED before altitude trend', () => {
  resetState('CANSAT');
  const events = [];
  const emit = (event, payload) => events.push({ event, payload });

  processPacket(packet('CANSAT', 1, 1000, 0), emit);
  processPacket(packet('CANSAT', 2, 2000, 1, 0x01), emit);

  assert.equal(states.CANSAT.phase, 'LAUNCHED');
  assert.equal(events[0].payload.event_type, 'LAUNCHED');
});
