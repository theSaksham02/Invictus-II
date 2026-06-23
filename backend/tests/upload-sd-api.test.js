const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function makeDbMock(captured) {
  return {
    MAX_HISTORY_LIMIT: 1000,
    getStats: () => ({ count: 0, max_alt_m: null, min_temp_c: null }),
    getLatest: () => null,
    getHistory: () => captured.packets,
    getAllEvents: () => [],
    exportCsv: () => [],
    insertPacketsBulk: (packets) => {
      captured.packets.push(...packets);
      return { changes: packets.length };
    },
    insertUpload: (upload) => {
      const record = { id: captured.uploads.length + 1, ...upload };
      captured.uploads.push(record);
      return { changes: 1, lastInsertRowid: record.id };
    },
    getUpload: (id) => captured.uploads.find((upload) => upload.id === Number(id)) || null,
    getUploadPackets: (id) => captured.packets.filter((packet) => packet.upload_id === Number(id)),
    close: () => {}
  };
}

async function withMockedServer(fn, env = {}) {
  const originalEnv = { ...process.env };
  process.env.PORT = '0';
  Object.assign(process.env, env);
  const captured = { packets: [], uploads: [] };
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './db') return makeDbMock(captured);
    if (request === './serial') {
      return {
        initSerial: () => {},
        shutdown: async () => {},
        getSignalState: () => ({
          mode: 'hardware',
          CANSAT: { connected: false },
          NRC: { connected: false }
        })
      };
    }
    if (request === './rover-proxy') {
      return {
        control: async () => ({}),
        stop: async () => ({}),
        arm: async () => ({}),
        data: async () => ({})
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const { server } = require('../server');
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });

  try {
    const port = server.address().port;
    await fn(`http://127.0.0.1:${port}`, captured);
  } finally {
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[serverPath];
    process.env = originalEnv;
  }
}

test('POST /api/upload-sd accepts NRC CSV with apogee columns and returns apogee summary', async () => {
  await withMockedServer(async (baseUrl, captured) => {
    const csv = [
      'pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,lat,lon,rssi_dbm,flags,max_altitude_m,apogee_detected',
      '1,1000,0.00,22.10,1013.20,0,0,-70,40,0.00,0',
      '2,2000,42.50,22.00,1008.20,0,0,-69,41,42.50,0',
      '3,3000,61.25,21.80,1001.50,0,0,-68,43,61.25,1',
      '4,4000,55.00,21.70,1004.10,0,0,-67,43,61.25,1'
    ].join('\n');

    const fd = new FormData();
    fd.append('source', 'NRC');
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'flight.csv');

    const res = await fetch(`${baseUrl}/api/upload-sd`, {
      method: 'POST',
      body: fd
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.source, 'NRC');
    assert.equal(body.upload_id, 1);
    assert.equal(body.inserted, 4);
    assert.equal(body.skipped, 0);
    assert.equal(body.duration_s, 3);
    assert.deepEqual(body.apogee, {
      altitude_m: 61.25,
      timestamp_ms: 3000,
      pkt_id: 3
    });
    assert.equal(captured.packets.length, 4);
    assert.equal(captured.uploads.length, 1);
    assert.equal(captured.uploads[0].source, 'NRC');
    assert.equal(captured.packets.every((packet) => packet.upload_id === 1), true);

    const packetsRes = await fetch(`${baseUrl}/api/sd-uploads/${body.upload_id}/packets`);
    const packetsBody = await packetsRes.json();
    assert.equal(packetsRes.status, 200);
    assert.equal(packetsBody.ok, true);
    assert.equal(packetsBody.upload_id, 1);
    assert.equal(packetsBody.source, 'NRC');
    assert.equal(packetsBody.count, 4);
    assert.deepEqual(packetsBody.packets.map((packet) => packet.pkt_id), [1, 2, 3, 4]);
  });
});

test('POST /api/upload-sd keeps CANSAT upload behavior compatible', async () => {
  await withMockedServer(async (baseUrl, captured) => {
    const csv = [
      'pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags',
      '1,1000,0.00,22.10,1013.20,1.00,0.10,0,0,40',
      '2,2000,12.50,22.00,1008.20,1.20,0.20,0,0,41'
    ].join('\n');

    const fd = new FormData();
    fd.append('source', 'CANSAT');
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'cansat.csv');

    const res = await fetch(`${baseUrl}/api/upload-sd`, {
      method: 'POST',
      body: fd
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.ok, true);
    assert.equal(body.source, 'CANSAT');
    assert.equal(body.upload_id, 1);
    assert.equal(body.inserted, 2);
    assert.equal(body.duration_s, 1);
    assert.equal(captured.uploads[0].source, 'CANSAT');
    assert.equal(captured.packets.every((packet) => packet.upload_id === 1), true);
  });
});

test('POST /api/upload-sd skips out-of-range telemetry rows instead of importing corrupt data', async () => {
  await withMockedServer(async (baseUrl, captured) => {
    const csv = [
      'pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,rssi_dbm,flags',
      '1,1000,0.00,22.10,1013.20,1.00,0.10,0,0,-70,40',
      '2,2000,999999.00,22.00,1008.20,1.20,0.20,0,0,-69,41',
      '3,3000,10.00,22.00,9999.20,1.20,0.20,0,0,-69,41',
      '4,4000,11.00,22.00,1008.20,99.20,0.20,0,0,-69,41'
    ].join('\n');

    const fd = new FormData();
    fd.append('source', 'CANSAT');
    fd.append('file', new Blob([csv], { type: 'text/csv' }), 'cansat.csv');

    const res = await fetch(`${baseUrl}/api/upload-sd`, {
      method: 'POST',
      body: fd
    });
    const body = await res.json();

    assert.equal(res.status, 201);
    assert.equal(body.inserted, 1);
    assert.equal(body.skipped, 3);
    assert.deepEqual(captured.packets.map((packet) => packet.pkt_id), [1]);
  });
});

test('POST /api/upload-sd returns structured request IDs for invalid uploads', async () => {
  await withMockedServer(async (baseUrl) => {
    const fd = new FormData();
    fd.append('source', 'CANSAT');
    fd.append('file', new Blob(['pkt_id,timestamp_ms\n'], { type: 'text/csv' }), 'bad.csv');

    const res = await fetch(`${baseUrl}/api/upload-sd`, {
      method: 'POST',
      headers: { 'x-request-id': 'audit-upload-1' },
      body: fd
    });
    const body = await res.json();

    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.request_id, 'audit-upload-1');
  });
});

test('POST /api/upload-sd enforces configured row count cap', async () => {
  await withMockedServer(async (baseUrl) => {
    const rows = ['pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,flags'];
    for (let i = 1; i <= 101; i++) {
      rows.push(`${i},${i * 1000},0,20,1013,1,0,0,0,40`);
    }

    const fd = new FormData();
    fd.append('source', 'CANSAT');
    fd.append('file', new Blob([rows.join('\n')], { type: 'text/csv' }), 'too-many.csv');

    const res = await fetch(`${baseUrl}/api/upload-sd`, {
      method: 'POST',
      body: fd
    });
    const body = await res.json();

    assert.equal(res.status, 413);
    assert.equal(body.ok, false);
    assert.equal(body.details.max_rows, 100);
  }, { SD_UPLOAD_MAX_ROWS: '100' });
});
