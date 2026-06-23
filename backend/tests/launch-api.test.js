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
    insertUpload: () => ({ changes: 1, lastInsertRowid: 1 }),
    getUpload: () => null,
    getUploadPackets: () => [],
    close: () => {}
  };
}

async function withMockedServer(fn, env = {}) {
  const originalEnv = { ...process.env };
  process.env.PORT = '0';
  Object.assign(process.env, env);
  const roverCalls = [];
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
          NRC: { connected: false },
          MACHX: { connected: false }
        })
      };
    }
    if (request === './rover-proxy') {
      return {
        control: async (left, right) => {
          roverCalls.push({ method: 'control', left, right });
          return {};
        },
        stop: async () => {
          roverCalls.push({ method: 'stop' });
          return {};
        },
        arm: async () => {
          roverCalls.push({ method: 'arm' });
          return {};
        },
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
    await fn(`http://127.0.0.1:${port}`, roverCalls);
  } finally {
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[serverPath];
    process.env = originalEnv;
  }
}

test('POST /api/launch is unavailable because launch is externally controlled', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'CANSAT' })
    });

    assert.equal(res.status, 404);
  });
});

test('backend serial module does not expose a launch command function', () => {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'serialport') {
      return { SerialPort: class MockSerialPort {} };
    }
    if (request === './db') {
      return {
        insertPacket: () => ({ changes: 1 }),
        insertEvent: () => ({ changes: 1 })
      };
    }
    if (request === './phase-tracker') {
      return { processPacket: () => {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const serialPath = require.resolve('../serial');
  delete require.cache[serialPath];

  try {
    const serial = require('../serial');
    assert.equal(Object.hasOwn(serial, 'sendLaunchCommand'), false);
  } finally {
    Module._load = originalLoad;
    delete require.cache[serialPath];
  }
});

test('rover control requires token when configured and never proxies unauthorized commands', async () => {
  await withMockedServer(async (baseUrl, roverCalls) => {
    const denied = await fetch(`${baseUrl}/api/rover/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ left: 10, right: 10 })
    });
    const deniedBody = await denied.json();

    assert.equal(denied.status, 401);
    assert.equal(deniedBody.ok, false);
    assert.equal(deniedBody.request_id.length > 0, true);
    assert.equal(roverCalls.length, 0);

    const allowed = await fetch(`${baseUrl}/api/rover/control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rover-token': 'test-token'
      },
      body: JSON.stringify({ left: 10, right: -10 })
    });
    const allowedBody = await allowed.json();

    assert.equal(allowed.status, 200);
    assert.equal(allowedBody.ok, true);
    assert.deepEqual(roverCalls, [{ method: 'control', left: 10, right: -10 }]);
  }, { ROVER_CONTROL_TOKEN: 'test-token' });
});
