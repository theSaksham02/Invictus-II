const { SerialPort, SerialPortMock } = require('serialport');
const { parseCansat } = require('./parser');
const { CansatFrameParser } = require('./cansat-framer');
const { insertPacket, insertEvent } = require('./db');
const { processPacket } = require('./phase-tracker');
const { createNrcSerial } = require('./nrc-serial');

const CANSAT_PORT = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
const NRC_PORT    = process.env.SERIAL_PORT_NRC    || '/dev/ttyUSB1';
const CANSAT_CMD_PORT = process.env.SERIAL_PORT_CANSAT_CMD || '';
const CANSAT_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT || '115200', 10);
const NRC_BAUD    = parseInt(process.env.SERIAL_BAUD_NRC || '115200', 10);
const CANSAT_CMD_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT_CMD || String(CANSAT_BAUD), 10);

let cansatPort, cansatCmdPort, nrcSerial, cansatFrameParser;
let shuttingDown = false;
let fallbackTriggered = false;
let watchdogInterval = null;
let cansatReconnectTimer = null;
let cansatCmdReconnectTimer = null;
let activeMode = process.env.SIM_MODE === 'true' ? 'sim' : 'hardware';

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
const diagnostics = {
  CANSAT: { port: CANSAT_PORT, baud: CANSAT_BAUD, open: false, packets: 0, parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null },
  NRC: { port: NRC_PORT, baud: NRC_BAUD, open: false, packets: 0, parse_errors: 0, serial_errors: 0, reconnects: 0, last_error: null }
};

function clearTimer(timer) {
  if (timer) clearTimeout(timer);
  return null;
}

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

  const scheduleCansatReconnect = (connectFn) => {
    if (shuttingDown || cansatReconnectTimer) return;
    diagnostics.CANSAT.reconnects++;
    cansatReconnectTimer = setTimeout(() => {
      cansatReconnectTimer = null;
      connectFn();
    }, RECONNECT_DELAY_MS);
  };

  const scheduleCansatCommandReconnect = (connectFn) => {
    if (shuttingDown || cansatCmdReconnectTimer) return;
    cansatCmdReconnectTimer = setTimeout(() => {
      cansatCmdReconnectTimer = null;
      connectFn();
    }, RECONNECT_DELAY_MS);
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
        sourceState.CANSAT.connected = true;
        sourceState.CANSAT.port = CANSAT_PORT;
        cansatReconnectTimer = clearTimer(cansatReconnectTimer);
      });
      cansatPort.on('error', (err) => {
        diagnostics.CANSAT.serial_errors++;
        diagnostics.CANSAT.last_error = err.message;
        sourceState.CANSAT.connected = false;
        console.warn('[SERIAL] CANSAT Error:', err.message);
        if (!isSimMode) triggerFallback(enableSimFallback, err.message);
        scheduleCansatReconnect(connectCansat);
      });
      cansatPort.on('close', () => {
        diagnostics.CANSAT.open = false;
        sourceState.CANSAT.connected = false;
        console.warn('[SERIAL] CANSAT Closed, reconnecting...');
        scheduleCansatReconnect(connectCansat);
      });
    } catch (e) {
      diagnostics.CANSAT.serial_errors++;
      diagnostics.CANSAT.last_error = e.message;
      console.warn('[SERIAL] CANSAT Init Error:', e.message);
      if (!isSimMode) triggerFallback(enableSimFallback, e.message);
      scheduleCansatReconnect(connectCansat);
    }
  };

  const connectCansatCommand = () => {
    if (!CANSAT_CMD_PORT || CANSAT_CMD_PORT === CANSAT_PORT) return;
    try {
      cansatCmdPort = new PortClass({ path: CANSAT_CMD_PORT, baudRate: CANSAT_CMD_BAUD });
      cansatCmdPort.on('open', () => {
        cansatCmdReconnectTimer = clearTimer(cansatCmdReconnectTimer);
      });
      cansatCmdPort.on('error', (err) => {
        console.warn('[SERIAL] CANSAT command port error:', err.message);
        scheduleCansatCommandReconnect(connectCansatCommand);
      });
      cansatCmdPort.on('close', () => {
        console.warn('[SERIAL] CANSAT command port closed, reconnecting...');
        scheduleCansatCommandReconnect(connectCansatCommand);
      });
    } catch (error) {
      console.warn('[SERIAL] CANSAT command port init error:', error.message);
      scheduleCansatCommandReconnect(connectCansatCommand);
    }
  };

  nrcSerial = createNrcSerial({
    PortClass,
    portPath: NRC_PORT,
    baudRate: NRC_BAUD,
    disabledPortPath: CANSAT_PORT,
    isSimMode,
    reconnectDelayMs: RECONNECT_DELAY_MS,
    diagnostics,
    sourceState,
    emitFn,
    safeEmit,
    handlePacket,
    shouldReconnect: () => !shuttingDown
  });

  connectCansat();
  connectCansatCommand();
  nrcSerial.connect();
}

function writePort(port, command, unavailableMessage) {
  return new Promise((resolve, reject) => {
    if (!port || !port.isOpen) {
      reject(new Error(unavailableMessage));
      return;
    }
    port.write(command, (writeError) => {
      if (writeError) return reject(writeError);
      if (typeof port.drain !== 'function') return resolve();
      port.drain((drainError) => drainError ? reject(drainError) : resolve());
    });
  });
}

async function sendLaunchCommand(source) {
  const normalizedSource = String(source || '').toUpperCase();
  if (!['CANSAT', 'NRC', 'ALL'].includes(normalizedSource)) {
    throw new Error(`Unsupported launch source: ${source}`);
  }

  const targets = normalizedSource === 'ALL' ? ['NRC', 'CANSAT'] : [normalizedSource];
  const results = [];

  for (const target of targets) {
    try {
      if (target === 'NRC') {
        if (!nrcSerial) throw new Error('NRC serial is not initialized');
        await nrcSerial.sendLaunchCommand();
        results.push({ source: target, ok: true, status: 'sent' });
      } else if (target === 'CANSAT') {
        if (!CANSAT_CMD_PORT) {
          results.push({ source: target, ok: false, status: 'unavailable', error: 'SERIAL_PORT_CANSAT_CMD is not configured' });
        } else {
          const port = CANSAT_CMD_PORT === CANSAT_PORT ? cansatPort : cansatCmdPort;
          await writePort(port, 'CMD:LAUNCH\n', 'CANSAT command serial port is not open');
          results.push({ source: target, ok: true, status: 'sent' });
        }
      }
    } catch (error) {
      results.push({ source: target, ok: false, status: 'failed', error: error.message });
    }
  }

  return {
    ok: results.some((result) => result.ok),
    partial: results.some((result) => result.ok) && results.some((result) => !result.ok),
    results
  };
}

function getSignalState() {
  return {
    mode: activeMode,
    CANSAT: {
      lost: sourceState.CANSAT.lost,
      connected: sourceState.CANSAT.connected,
      port: sourceState.CANSAT.port,
      last_seen_ms: sourceState.CANSAT.lastSeenAt || 0,
      diagnostics: {
        ...diagnostics.CANSAT,
        framer: cansatFrameParser && typeof cansatFrameParser.getStats === 'function'
          ? cansatFrameParser.getStats()
          : null
      }
    },
    NRC: {
      lost: sourceState.NRC.lost,
      connected: sourceState.NRC.connected,
      port: sourceState.NRC.port,
      last_seen_ms: sourceState.NRC.lastSeenAt || 0,
      diagnostics: { ...diagnostics.NRC }
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
  cansatReconnectTimer = clearTimer(cansatReconnectTimer);
  cansatCmdReconnectTimer = clearTimer(cansatCmdReconnectTimer);
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  await Promise.all([
    closePort(cansatPort),
    closePort(cansatCmdPort),
    nrcSerial ? nrcSerial.close() : Promise.resolve()
  ]);
}

module.exports = { initSerial, getSignalState, sendLaunchCommand, shutdown };
