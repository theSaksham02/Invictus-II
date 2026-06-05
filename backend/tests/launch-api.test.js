const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function makeDbMock() {
  return {
    MAX_HISTORY_LIMIT: 1000,
    getStats: () => ({ count: 0, max_alt_m: null, min_temp_c: null }),
    getLatest: () => null,
    getHistory: () => [],
    getAllEvents: () => [],
    exportCsv: () => [],
    insertPacketsBulk: () => ({ changes: 0 }),
    insertUpload: () => ({ changes: 1 }),
    close: () => {}
  };
}

async function withMockedServer(sendLaunchCommand, fn) {
  process.env.PORT = '0';
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './db') return makeDbMock();
    if (request === './serial') {
      return {
        initSerial: () => {},
        shutdown: async () => {},
        getSignalState: () => ({
          mode: 'hardware',
          CANSAT: { connected: false },
          NRC: { connected: false }
        }),
        sendLaunchCommand
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
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[serverPath];
  }
}

test('POST /api/launch sends valid source to serial layer', async () => {
  await withMockedServer(async (source) => {
    assert.equal(source, 'NRC');
    return { ok: true, partial: false, results: [{ source: 'NRC', ok: true, status: 'sent' }] };
  }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'NRC' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.results[0].status, 'sent');
  });
});

test('POST /api/launch reports unavailable command paths as 503', async () => {
  await withMockedServer(async () => ({
    ok: false,
    partial: false,
    results: [{ source: 'CANSAT', ok: false, status: 'unavailable', error: 'SERIAL_PORT_CANSAT_CMD is not configured' }]
  }), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'CANSAT' })
    });
    const body = await res.json();
    assert.equal(res.status, 503);
    assert.equal(body.ok, false);
    assert.equal(body.results[0].status, 'unavailable');
  });
});

test('POST /api/launch reports partial success for ALL when CANSAT command port is missing', async () => {
  await withMockedServer(async (source) => {
    assert.equal(source, 'ALL');
    return {
      ok: true,
      partial: true,
      results: [
        { source: 'NRC', ok: true, status: 'sent' },
        { source: 'CANSAT', ok: false, status: 'unavailable', error: 'SERIAL_PORT_CANSAT_CMD is not configured' }
      ]
    };
  }, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'ALL' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.partial, true);
    assert.equal(body.results[1].status, 'unavailable');
  });
});

test('POST /api/launch rejects invalid source', async () => {
  await withMockedServer(async () => ({ ok: true, partial: false, results: [] }), async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'ROVER' })
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.equal(body.ok, false);
    assert.equal(body.error, 'Invalid source parameter');
  });
});
