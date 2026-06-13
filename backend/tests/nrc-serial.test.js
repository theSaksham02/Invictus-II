const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { createNrcSerial } = require('../nrc-serial');

test('NRC serial schedules reconnect after port error', async () => {
  let attempts = 0;
  class FailingPort extends EventEmitter {
    constructor() {
      super();
      this.isOpen = false;
      attempts++;
      process.nextTick(() => this.emit('error', new Error('missing port')));
    }
    pipe() {
      return new EventEmitter();
    }
    close(done) {
      if (done) done();
    }
  }

  const diagnostics = {
    NRC: { parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null }
  };
  const sourceState = {
    NRC: { connected: false }
  };
  let reconnecting = true;
  const serial = createNrcSerial({
    PortClass: FailingPort,
    portPath: '/dev/missing',
    baudRate: 115200,
    disabledPortPath: '/dev/other',
    reconnectDelayMs: 10,
    diagnostics,
    sourceState,
    emitFn: () => {},
    safeEmit: () => {},
    handlePacket: () => {},
    shouldReconnect: () => reconnecting
  });

  serial.connect();
  await new Promise((resolve) => setTimeout(resolve, 35));
  reconnecting = false;
  await serial.close();

  assert.ok(attempts >= 2);
  assert.ok(diagnostics.NRC.reconnects >= 1);
  assert.equal(sourceState.NRC.connected, false);
});

async function withMockedSerialModule(env, fn) {
  const openedPaths = [];
  const originalEnv = { ...process.env };
  const originalLoad = Module._load;

  class MockPort extends EventEmitter {
    constructor(options) {
      super();
      this.path = options.path;
      this.isOpen = true;
      openedPaths.push(options.path);
      process.nextTick(() => this.emit('open'));
    }
    pipe(parser) {
      return parser;
    }
    write(_command, done) {
      if (done) done();
    }
    drain(done) {
      if (done) done();
    }
    close(done) {
      this.isOpen = false;
      if (done) done();
    }
  }

  process.env = { ...originalEnv, ...env };
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'serialport') return { SerialPort: MockPort };
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
  const serial = require('../serial');

  try {
    await fn(serial, openedPaths);
  } finally {
    await serial.shutdown();
    Module._load = originalLoad;
    process.env = originalEnv;
    delete require.cache[serialPath];
  }
}

test('serial disables NRC live ingest by default', async () => {
  await withMockedSerialModule({
    ENABLE_NRC_LIVE: '',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_NRC: '/dev/nrc'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(openedPaths.includes('/dev/cansat'), true);
    assert.equal(openedPaths.includes('/dev/nrc'), false);
    const signal = serial.getSignalState();
    assert.equal(signal.NRC.live_enabled, false);
    assert.equal(signal.NRC.connected, false);
    assert.equal(signal.NRC.diagnostics.last_error, 'NRC live telemetry disabled');
  });
});

test('serial opens NRC live ingest only when explicitly enabled', async () => {
  await withMockedSerialModule({
    ENABLE_NRC_LIVE: 'true',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_NRC: '/dev/nrc'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(openedPaths.includes('/dev/cansat'), true);
    assert.equal(openedPaths.includes('/dev/nrc'), true);
    const signal = serial.getSignalState();
    assert.equal(signal.NRC.live_enabled, true);
    assert.equal(signal.NRC.connected, true);
  });
});
