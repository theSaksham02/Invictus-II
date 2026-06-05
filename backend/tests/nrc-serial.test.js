const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
