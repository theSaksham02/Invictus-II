const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function makePacket(overrides = {}) {
  return {
    source: 'RIDESHARE',
    protocol_version: 3,
    pkt_id: 7,
    timestamp_ms: 7000,
    altitude_m: 42.5,
    temp_c: 22.1,
    temp_c_1: 21.9,
    temp_c_2: null,
    temp_c_3: null,
    temp_c_4: null,
    pressure_hpa: 1008.2,
    accel_z: null,
    gyro_x: null,
    lat: 25,
    lon: 55,
    rssi_dbm: -80,
    flags: 40,
    raw: 'MXR3:7,7000,42.50,22.10,21.90,1008.20,25.000000,55.000000,-80,40,ABCD',
    received_at: Date.now(),
    ...overrides
  };
}

async function withTempDb(fn) {
  const originalDbFile = process.env.DB_FILE;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invictus-db-'));
  process.env.DB_FILE = path.join(dir, 'flight.db');

  const dbPath = require.resolve('../db');
  delete require.cache[dbPath];
  const db = require('../db');

  try {
    await fn(db);
  } finally {
    db.close();
    delete require.cache[dbPath];
    if (originalDbFile === undefined) delete process.env.DB_FILE;
    else process.env.DB_FILE = originalDbFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('insertPacket skips exact duplicate packet identity', async () => {
  await withTempDb(async (db) => {
    const first = db.insertPacket(makePacket());
    const second = db.insertPacket(makePacket({ received_at: Date.now() + 1 }));
    const rows = db.getHistory('RIDESHARE', 10);

    assert.deepEqual(first, { changes: 1, duplicate: false });
    assert.deepEqual(second, { changes: 0, duplicate: true });
    assert.equal(rows.length, 1);
  });
});

test('insertPacket allows same sequence metadata with different raw payload', async () => {
  await withTempDb(async (db) => {
    db.insertPacket(makePacket());
    const result = db.insertPacket(makePacket({
      raw: 'MXR3:7,7000,42.50,22.10,21.90,1008.20,25.000000,55.000000,-81,40,1234',
      rssi_dbm: -81,
      received_at: Date.now() + 1
    }));
    const rows = db.getHistory('RIDESHARE', 10);

    assert.deepEqual(result, { changes: 1, duplicate: false });
    assert.equal(rows.length, 2);
  });
});

test('insertPacketsBulk counts skipped duplicate packets', async () => {
  await withTempDb(async (db) => {
    const result = db.insertPacketsBulk([
      makePacket({ pkt_id: 1, timestamp_ms: 1000, raw: 'one' }),
      makePacket({ pkt_id: 1, timestamp_ms: 1000, raw: 'one', received_at: Date.now() + 1 }),
      makePacket({ pkt_id: 2, timestamp_ms: 2000, raw: 'two' })
    ]);
    const rows = db.getHistory('RIDESHARE', 10);

    assert.deepEqual(result, { changes: 2, skipped_duplicates: 1 });
    assert.deepEqual(rows.map((row) => row.pkt_id), [1, 2]);
  });
});
