const { SerialPort, SerialPortMock } = require('serialport');
const { ReadlineParser } = require('serialport');
const { parseCansat, parseNrc } = require('./parser');
const { CansatFrameParser } = require('./cansat-framer');
const { insertPacket, insertEvent } = require('./db');
const { processPacket } = require('./phase-tracker');

const CANSAT_PORT = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
const NRC_PORT    = process.env.SERIAL_PORT_NRC    || '/dev/ttyUSB1';
const CANSAT_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT || '9600', 10);
const NRC_BAUD    = parseInt(process.env.SERIAL_BAUD_NRC || '9600', 10);

let cansatPort, nrcPort, cansatFrameParser;
let shuttingDown = false;
let fallbackTriggered = false;
let watchdogInterval = null;

const SIGNAL_TIMEOUT_MS = Math.max(
  Number.parseInt(process.env.SIGNAL_TIMEOUT_MS || '5000', 10) || 5000,
  1000
);
const RECONNECT_DELAY_MS = Math.max(
  Number.parseInt(process.env.SERIAL_RECONNECT_MS || '3000', 10) || 3000,
  250
);
const sourceState = {
  CANSAT: { lastSeenAt: null, lost: false },
  NRC: { lastSeenAt: null, lost: false }
};
const diagnostics = {
  CANSAT: { port: CANSAT_PORT, baud: CANSAT_BAUD, open: false, packets: 0, parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null },
  NRC: { port: NRC_PORT, baud: NRC_BAUD, open: false, packets: 0, parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null }
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
  enableSimFallback();
}

function initSerial(emitFn, enableSimFallback) {
  shuttingDown = false;
  fallbackTriggered = false;
  const isSimMode = process.env.SIM_MODE === 'true';
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
    diagnostics[pkt.source].packets++;

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

  const connectCansat = () => {
    try {
      cansatPort = new PortClass({ path: CANSAT_PORT, baudRate: CANSAT_BAUD });
      if (isSimMode) global.mockCansat = cansatPort;

      cansatFrameParser = cansatPort.pipe(new CansatFrameParser());
      cansatFrameParser.on('error', (err) => {
        diagnostics.CANSAT.parse_errors++;
        diagnostics.CANSAT.last_error = err.message;
        console.warn('[SERIAL] CANSAT parser error:', err.message);
        safeEmit(emitFn, 'ingest_error', { source: 'CANSAT', error: err.message });
      });

      const parser = cansatFrameParser;
      parser.on('data', (buf) => {
        const parsed = parseCansat(buf);
        if (parsed) {
          handlePacket(parsed);
        } else {
          diagnostics.CANSAT.parse_errors++;
          safeEmit(emitFn, 'ingest_error', { source: 'CANSAT', error: 'Rejected CANSAT frame after resync' });
        }
      });

      cansatPort.on('open', () => {
        diagnostics.CANSAT.open = true;
        diagnostics.CANSAT.last_error = null;
      });
      cansatPort.on('error', (err) => {
        diagnostics.CANSAT.serial_errors++;
        diagnostics.CANSAT.last_error = err.message;
        console.warn('[SERIAL] CANSAT Error:', err.message);
        if (!isSimMode) triggerFallback(enableSimFallback, err.message);
      });
      cansatPort.on('close', () => {
        diagnostics.CANSAT.open = false;
        if (shuttingDown) return;
        diagnostics.CANSAT.reconnects++;
        console.warn('[SERIAL] CANSAT Closed, reconnecting...');
        setTimeout(connectCansat, RECONNECT_DELAY_MS);
      });
    } catch (e) {
      diagnostics.CANSAT.serial_errors++;
      diagnostics.CANSAT.last_error = e.message;
      console.warn('[SERIAL] CANSAT Init Error:', e.message);
      if (!isSimMode) triggerFallback(enableSimFallback, e.message);
    }
  };

  const connectNrc = () => {
    if (CANSAT_PORT === NRC_PORT) return;
    try {
      nrcPort = new PortClass({ path: NRC_PORT, baudRate: NRC_BAUD });
      if (isSimMode) global.mockNrc = nrcPort;
      const parser = nrcPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        const parsed = parseNrc(line);
        if (parsed) {
          handlePacket(parsed);
        } else {
          diagnostics.NRC.parse_errors++;
          safeEmit(emitFn, 'ingest_error', { source: 'NRC', error: 'Rejected NRC telemetry line' });
        }
      });

      nrcPort.on('open', () => {
        diagnostics.NRC.open = true;
        diagnostics.NRC.last_error = null;
      });
      nrcPort.on('error', (err) => {
        diagnostics.NRC.serial_errors++;
        diagnostics.NRC.last_error = err.message;
        console.warn('[SERIAL] NRC Error:', err.message);
      });
      nrcPort.on('close', () => {
        diagnostics.NRC.open = false;
        if (shuttingDown) return;
        diagnostics.NRC.reconnects++;
        console.warn('[SERIAL] NRC Closed, reconnecting...');
        setTimeout(connectNrc, RECONNECT_DELAY_MS);
      });
    } catch (e) {
      diagnostics.NRC.serial_errors++;
      diagnostics.NRC.last_error = e.message;
      console.warn('[SERIAL] NRC Init Error:', e.message);
    }
  };

  connectCansat();
  connectNrc();
}

function getSignalState() {
  return {
    CANSAT: {
      lost: sourceState.CANSAT.lost,
      last_seen_ms: sourceState.CANSAT.lastSeenAt || 0,
      diagnostics: {
        ...diagnostics.CANSAT,
        framer: cansatFrameParser && typeof cansatFrameParser.getStats === 'function'
          ? cansatFrameParser.getStats()
          : null
      }
    },
    NRC: { lost: sourceState.NRC.lost, last_seen_ms: sourceState.NRC.lastSeenAt || 0, diagnostics: { ...diagnostics.NRC } }
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
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  await Promise.all([closePort(cansatPort), closePort(nrcPort)]);
}

module.exports = { initSerial, getSignalState, shutdown };
