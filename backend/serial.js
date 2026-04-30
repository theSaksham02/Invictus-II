const { SerialPort, SerialPortMock } = require('serialport');
const { ReadlineParser } = require('serialport');
const { parseCansat, parseNrc } = require('./parser');
const { insertPacket, insertEvent } = require('./db');
const { processPacket } = require('./phase-tracker');

const CANSAT_PORT = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
const NRC_PORT    = process.env.SERIAL_PORT_NRC    || '/dev/ttyUSB1';
const CANSAT_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT || '9600', 10);
const NRC_BAUD    = parseInt(process.env.SERIAL_BAUD_NRC || '9600', 10);

let cansatPort, nrcPort;
let shuttingDown = false;
let fallbackTriggered = false;
let watchdogInterval = null;
let activeMode = process.env.SIM_MODE === 'true' ? 'sim' : 'hardware';
let cansatBuffer = Buffer.alloc(0);

const SIGNAL_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.SIGNAL_TIMEOUT_MS || '5000', 10) || 5000,
  1000
);
const RECONNECT_DELAY_MS = Math.max(
  Number.parseInt(process.env.SERIAL_RECONNECT_MS || '3000', 10) || 3000,
  250
);
const sourceState = {
  CANSAT: { lastSeenAt: null, lost: false, connected: false, port: CANSAT_PORT },
  NRC: { lastSeenAt: null, lost: false, connected: false, port: NRC_PORT }
};

function safeEmit(emitFn, event, payload) {
  try {
    emitFn(event, payload);
  } catch (error) {
    console.warn(`[SERIAL] emit ${event} failed:`, error.message);
  }
}

function markSignalRecovered(source, emitFn, now) {
  const state = sourceState[source];
  if (!state.lost || state.lastSeenAt === null) return;
  const gapMs = now - state.lastSeenAt;
  state.lost = false;
  safeEmit(emitFn, 'signal_recovered', { source, gap_ms: gapMs });
}

function triggerSignalLost(source, emitFn, now) {
  const state = sourceState[source];
  if (state.lastSeenAt === null || state.lost) return;
  const gapMs = now - state.lastSeenAt;
  if (gapMs <= SIGNAL_TIMEOUT_MS) return;

  state.lost = true;
  safeEmit(emitFn, 'signal_lost', { source, last_seen_ms: state.lastSeenAt, gap_ms: gapMs });
  try {
    insertEvent({
      source,
      event_type: 'SIGNAL_LOST',
      altitude_m: 0,
      timestamp_ms: 0,
      received_at: now
    });
  } catch (error) {
    console.error('[SERIAL] failed to persist signal_lost event:', error.message);
  }
}

function triggerFallback(enableSimFallback, reason) {
  if (!enableSimFallback || fallbackTriggered) return;
  fallbackTriggered = true;
  console.warn('[SERIAL] enabling simulator fallback:', reason);
  Promise.resolve(enableSimFallback(reason)).catch((error) => {
    console.error('[SERIAL] simulator fallback failed:', error.message);
  });
}

function initSerial(emitFn, enableSimFallback) {
  shuttingDown = false;
  fallbackTriggered = false;
  cansatBuffer = Buffer.alloc(0);
  const isSimMode = process.env.SIM_MODE === 'true';
  activeMode = isSimMode ? 'sim' : 'hardware';
  const PortClass = isSimMode ? SerialPortMock : SerialPort;

  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = setInterval(() => {
    const now = Date.now();
    triggerSignalLost('CANSAT', emitFn, now);
    triggerSignalLost('NRC', emitFn, now);
  }, 1000);

  const handlePacket = (pkt) => {
    if (!pkt) return;
    const now = Date.now();
    markSignalRecovered(pkt.source, emitFn, now);
    sourceState[pkt.source].lastSeenAt = now;

    try {
      insertPacket(pkt);
      processPacket(pkt, emitFn);
      safeEmit(emitFn, 'packet', { source: pkt.source, data: pkt });
    } catch (error) {
      console.error('[SERIAL] packet handling failed:', error.message);
      safeEmit(emitFn, 'ingest_error', {
        source: pkt.source,
        pkt_id: pkt.pkt_id,
        error: error.message
      });
    }
    if (process.env.LOG_PACKETS === 'true') console.log(pkt);
  };

  const handleCansatBytes = (chunk) => {
    cansatBuffer = Buffer.concat([cansatBuffer, chunk]);

    while (cansatBuffer.length >= 37) {
      const candidate = cansatBuffer.subarray(0, 37);
      const parsed = parseCansat(candidate);
      if (parsed) {
        handlePacket(parsed);
        cansatBuffer = cansatBuffer.subarray(37);
      } else {
        cansatBuffer = cansatBuffer.subarray(1);
      }
    }

    if (cansatBuffer.length > 370) {
      cansatBuffer = cansatBuffer.subarray(cansatBuffer.length - 36);
    }
  };

  const connectCansat = () => {
    try {
      cansatPort = new PortClass({ path: CANSAT_PORT, baudRate: CANSAT_BAUD });
      if (isSimMode) global.mockCansat = cansatPort;
      cansatPort.on('open', () => {
        sourceState.CANSAT.connected = true;
        sourceState.CANSAT.port = CANSAT_PORT;
      });

      cansatPort.on('data', handleCansatBytes);

      cansatPort.on('error', (err) => {
        sourceState.CANSAT.connected = false;
        console.warn('[SERIAL] CANSAT Error:', err.message);
        if (!isSimMode) triggerFallback(enableSimFallback, err.message);
      });
      cansatPort.on('close', () => {
        sourceState.CANSAT.connected = false;
        if (shuttingDown) return;
        console.warn('[SERIAL] CANSAT Closed, reconnecting...');
        setTimeout(connectCansat, RECONNECT_DELAY_MS);
      });
    } catch (e) {
      console.warn('[SERIAL] CANSAT Init Error:', e.message);
      if (!isSimMode) triggerFallback(enableSimFallback, e.message);
    }
  };

  const connectNrc = () => {
    if (CANSAT_PORT === NRC_PORT) {
      console.warn('[SERIAL] NRC disabled because CANSAT and NRC are configured with the same serial port');
      return;
    }
    try {
      nrcPort = new PortClass({ path: NRC_PORT, baudRate: NRC_BAUD });
      if (isSimMode) global.mockNrc = nrcPort;
      nrcPort.on('open', () => {
        sourceState.NRC.connected = true;
        sourceState.NRC.port = NRC_PORT;
      });
      const parser = nrcPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        const parsed = parseNrc(line);
        if (parsed) handlePacket(parsed);
      });

      nrcPort.on('error', (err) => {
        sourceState.NRC.connected = false;
        console.warn('[SERIAL] NRC Error:', err.message);
      });
      nrcPort.on('close', () => {
        sourceState.NRC.connected = false;
        if (shuttingDown) return;
        console.warn('[SERIAL] NRC Closed, reconnecting...');
        setTimeout(connectNrc, RECONNECT_DELAY_MS);
      });
    } catch (e) {
      console.warn('[SERIAL] NRC Init Error:', e.message);
    }
  };

  connectCansat();
  connectNrc();
}

function getSignalState() {
  return {
    mode: activeMode,
    CANSAT: {
      lost: sourceState.CANSAT.lost,
      connected: sourceState.CANSAT.connected,
      port: sourceState.CANSAT.port,
      last_seen_ms: sourceState.CANSAT.lastSeenAt || 0
    },
    NRC: {
      lost: sourceState.NRC.lost,
      connected: sourceState.NRC.connected,
      port: sourceState.NRC.port,
      last_seen_ms: sourceState.NRC.lastSeenAt || 0
    }
  };
}

function closePort(port) {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

async function shutdown() {
  shuttingDown = true;
  sourceState.CANSAT.connected = false;
  sourceState.NRC.connected = false;
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  await Promise.all([closePort(cansatPort), closePort(nrcPort)]);
}

module.exports = { initSerial, getSignalState, shutdown };
