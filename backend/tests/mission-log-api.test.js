const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function makeDbMock(captured) {
  return {
    MAX_HISTORY_LIMIT: 1000,
    getStats: () => ({ count: 0, max_alt_m: null, min_temp_c: null }),
    getLatest: () => null,
    getHistory: () => [],
    getAllEvents: () => captured.events,
    clearEvents: (source) => {
      const before = captured.events.length;
      captured.events = source === 'ALL'
        ? []
        : captured.events.filter((event) => event.source !== source);
      return { changes: before - captured.events.length };
    },
    exportCsv: () => [],
    insertPacketsBulk: () => ({ changes: 0 }),
    insertUpload: () => ({ changes: 1, lastInsertRowid: 1 }),
    getUpload: () => null,
    getUploadPackets: () => [],
    close: () => {}
  };
}

async function withMockedServer(fn) {
  process.env.PORT = '0';
  const captured = {
    events: [
      { source: 'NRC', event_type: 'ASCENDING', altitude_m: 12, timestamp_ms: 3000, received_at: Date.now() },
      { source: 'CANSAT', event_type: 'ASCENDING', altitude_m: 15, timestamp_ms: 3000, received_at: Date.now() }
    ]
  };
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
        }),
        sendLaunchCommand: async () => ({ ok: false, partial: false, results: [] })
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
  }
}

test('DELETE /api/events clears mission log events for the requested source', async () => {
  await withMockedServer(async (baseUrl, captured) => {
    const res = await fetch(`${baseUrl}/api/events?source=NRC`, { method: 'DELETE' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.source, 'NRC');
    assert.equal(body.cleared, 1);
    assert.deepEqual(captured.events.map((event) => event.source), ['CANSAT']);
  });
});
