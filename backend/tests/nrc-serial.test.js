const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { createRideshareSerial } = require('../rideshare-serial');
const { crc16Ccitt } = require('../cansat-hardware');

test('rideshare serial schedules reconnect after port error', async () => {
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
    RIDESHARE: { parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null }
  };
  const sourceState = {
    RIDESHARE: { connected: false }
  };
  let reconnecting = true;
  const serial = createRideshareSerial({
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
  assert.ok(diagnostics.RIDESHARE.reconnects >= 1);
  assert.equal(sourceState.RIDESHARE.connected, false);
});

async function withMockedSerialModule(env, fn, options = {}) {
  const openedPaths = [];
  const parsers = {};
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
      parsers[this.path] = parser;
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

  process.env = { ...originalEnv };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'serialport') return { SerialPort: MockPort };
    if (request === './db') {
      return {
        insertPacket: options.insertPacket || (() => ({ changes: 1, duplicate: false })),
        insertEvent: () => ({ changes: 1 })
      };
    }
    if (request === './phase-tracker') {
      return { processPacket: options.processPacket || (() => {}) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const serialPath = require.resolve('../serial');
  delete require.cache[serialPath];
  const serial = require('../serial');

  try {
    await fn(serial, openedPaths, parsers);
  } finally {
    await serial.shutdown();
    Module._load = originalLoad;
    process.env = originalEnv;
    delete require.cache[serialPath];
  }
}

function makeMxr3Line(pktId, timestampMs, altitudeM, rssi = -80) {
  const body = `${pktId},${timestampMs},${altitudeM.toFixed(2)},20.00,19.50,1010.00,25.000000,55.000000,${rssi},40`;
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  return `MXR3:${body},${crcHex}`;
}

test('serial opens Mach-X Rideshare live ingest by default', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: '',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: '/dev/rideshare'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(openedPaths.includes('/dev/cansat'), true);
    assert.equal(openedPaths.includes('/dev/rideshare'), true);
    const signal = serial.getSignalState();
    assert.equal(signal.RIDESHARE.live_enabled, true);
    assert.equal(signal.RIDESHARE.connected, true);
    assert.equal(signal.RIDESHARE.diagnostics.last_error, null);
    assert.equal(signal.NRC.connected, true);
  });
});

test('serial accepts legacy NRC env vars as rideshare aliases', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: undefined,
    ENABLE_NRC_LIVE: 'true',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: undefined,
    SERIAL_PORT_NRC: '/dev/legacy-nrc'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(openedPaths.includes('/dev/legacy-nrc'), true);
    const signal = serial.getSignalState();
    assert.equal(signal.RIDESHARE.live_enabled, true);
    assert.equal(signal.RIDESHARE.connected, true);
  });
});

test('serial disables Mach-X Rideshare live ingest only when explicitly disabled', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: 'false',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: '/dev/rideshare'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(openedPaths.includes('/dev/cansat'), true);
    assert.equal(openedPaths.includes('/dev/rideshare'), false);
    const signal = serial.getSignalState();
    assert.equal(signal.RIDESHARE.live_enabled, false);
    assert.equal(signal.RIDESHARE.connected, false);
    assert.equal(signal.RIDESHARE.diagnostics.last_error, 'Mach-X Rideshare live telemetry disabled');
  });
});

test('serial disables MACHX live ingest when it collides with CANSAT port', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: 'false',
    ENABLE_MACHX_LIVE: 'true',
    SERIAL_PORT_CANSAT: '/dev/shared',
    SERIAL_PORT_MACHX: '/dev/shared'
  }, async (serial, openedPaths) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(openedPaths, ['/dev/shared']);
    const signal = serial.getSignalState();
    assert.equal(signal.MACHX.live_enabled, true);
    assert.equal(signal.MACHX.connected, false);
    assert.equal(signal.MACHX.diagnostics.last_error, 'MACHX disabled because CANSAT and MACHX are configured with the same serial port');
  });
});

test('serial shutdown clears all source connection flags', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: 'true',
    ENABLE_MACHX_LIVE: 'true',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: '/dev/rideshare',
    SERIAL_PORT_MACHX: '/dev/machx'
  }, async (serial) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    await serial.shutdown();
    const signal = serial.getSignalState();
    assert.equal(signal.CANSAT.connected, false);
    assert.equal(signal.RIDESHARE.connected, false);
    assert.equal(signal.NRC.connected, false);
    assert.equal(signal.MACHX.connected, false);
  });
});

test('serial tracks rideshare packet-loss diagnostics without affecting CanSat connection state', async () => {
  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: 'true',
    ENABLE_MACHX_LIVE: 'false',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: '/dev/rideshare'
  }, async (serial, openedPaths, parsers) => {
    serial.initSerial(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(openedPaths.sort(), ['/dev/cansat', '/dev/rideshare']);

    parsers['/dev/rideshare'].emit('data', makeMxr3Line(1, 1000, 10));
    parsers['/dev/rideshare'].emit('data', makeMxr3Line(4, 4000, 13));
    parsers['/dev/rideshare'].emit('data', makeMxr3Line(4, 4000, 13));
    parsers['/dev/rideshare'].emit('data', makeMxr3Line(3, 3000, 12));

    const signal = serial.getSignalState();
    assert.equal(signal.CANSAT.connected, true);
    assert.equal(signal.RIDESHARE.connected, true);
    assert.equal(signal.RIDESHARE.diagnostics.packets, 4);
    assert.equal(signal.RIDESHARE.diagnostics.missed_packets, 2);
    assert.equal(signal.RIDESHARE.diagnostics.duplicate_packets, 1);
    assert.equal(signal.RIDESHARE.diagnostics.out_of_order_packets, 1);
    assert.equal(signal.RIDESHARE.diagnostics.last_protocol_prefix, 'MXR3');
    assert.equal(signal.RIDESHARE.diagnostics.last_rssi_dbm, -80);
    assert.equal(Number.isFinite(signal.RIDESHARE.diagnostics.last_packet_age_ms), true);
  });
});

test('serial skips phase processing and socket emission for DB duplicate packets', async () => {
  const emittedPackets = [];
  let insertCalls = 0;
  let phaseCalls = 0;

  await withMockedSerialModule({
    ENABLE_RIDESHARE_LIVE: 'true',
    ENABLE_MACHX_LIVE: 'false',
    SERIAL_PORT_CANSAT: '/dev/cansat',
    SERIAL_PORT_RIDESHARE: '/dev/rideshare'
  }, async (serial, openedPaths, parsers) => {
    serial.initSerial((event, payload) => {
      if (event === 'packet') emittedPackets.push(payload);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(openedPaths.sort(), ['/dev/cansat', '/dev/rideshare']);

    const line = makeMxr3Line(8, 8000, 18);
    parsers['/dev/rideshare'].emit('data', line);
    parsers['/dev/rideshare'].emit('data', line);

    const signal = serial.getSignalState();
    assert.equal(signal.RIDESHARE.diagnostics.packets, 2);
    assert.equal(signal.RIDESHARE.diagnostics.duplicate_packets, 1);
  }, {
    insertPacket: () => {
      insertCalls++;
      return insertCalls === 1
        ? { changes: 1, duplicate: false }
        : { changes: 0, duplicate: true };
    },
    processPacket: () => {
      phaseCalls++;
    }
  });

  assert.equal(insertCalls, 2);
  assert.equal(phaseCalls, 1);
  assert.equal(emittedPackets.length, 1);
});
