const { SerialPort } = require('serialport');
const { parseCansat } = require('./parser');
const { CansatFrameParser } = require('./cansat-framer');
const { insertPacket, insertEvent } = require('./db');
const { processPacket } = require('./phase-tracker');
const { createRideshareSerial } = require('./rideshare-serial');
const { createMachxSerial } = require('./machx-serial');
const { LEGACY_RIDESHARE_SOURCE, RIDESHARE_SOURCE } = require('./source-aliases');

const CANSAT_PORT = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB1';
const RIDESHARE_PORT = process.env.SERIAL_PORT_RIDESHARE || process.env.SERIAL_PORT_NRC || '/dev/ttyUSB2';
const CANSAT_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT || '115200', 10);
const RIDESHARE_BAUD = parseInt(process.env.SERIAL_BAUD_RIDESHARE || process.env.SERIAL_BAUD_NRC || '115200', 10);
const MACHX_PORT = process.env.SERIAL_PORT_MACHX || '/dev/ttyUSB0';
const MACHX_BAUD = parseInt(process.env.SERIAL_BAUD_MACHX || '115200', 10);
const ENABLE_RIDESHARE_LIVE = process.env.ENABLE_RIDESHARE_LIVE !== undefined
  ? process.env.ENABLE_RIDESHARE_LIVE !== 'false'
  : process.env.ENABLE_NRC_LIVE !== 'false';
const ENABLE_MACHX_LIVE = process.env.ENABLE_MACHX_LIVE !== 'false';

let cansatPort, rideshareSerial, machxSerial, cansatFrameParser;
let shuttingDown = false;
let watchdogInterval = null;
let cansatReconnectTimer = null;
let activeMode = 'hardware';

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
  RIDESHARE: { lastSeenAt: null, lost: false, connected: false, port: RIDESHARE_PORT, live_enabled: ENABLE_RIDESHARE_LIVE },
  MACHX: { lastSeenAt: null, lost: false, connected: false, port: MACHX_PORT, live_enabled: ENABLE_MACHX_LIVE }
};

function makeDiagnostics(port, baud, lastError = null) {
  return {
    port,
    baud,
    open: false,
    packets: 0,
    parse_errors: 0,
    serial_errors: 0,
    reconnects: 0,
    missed_packets: 0,
    duplicate_packets: 0,
    out_of_order_packets: 0,
    last_pkt_id: null,
    last_timestamp_ms: null,
    last_rssi_dbm: null,
    last_protocol_prefix: null,
    last_packet_received_at: null,
    last_error: lastError
  };
}

const diagnostics = {
  CANSAT: makeDiagnostics(CANSAT_PORT, CANSAT_BAUD),
  RIDESHARE: makeDiagnostics(
    RIDESHARE_PORT,
    RIDESHARE_BAUD,
    ENABLE_RIDESHARE_LIVE ? null : 'Mach-X Rideshare live telemetry disabled'
  ),
  MACHX: makeDiagnostics(MACHX_PORT, MACHX_BAUD, ENABLE_MACHX_LIVE ? null : 'MACHX live telemetry disabled')
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
  const timeoutLimit = (source === 'MACHX' || source === 'SUGAR') ? 15000 : SIGNAL_TIMEOUT_MS;
  if (gapMs <= timeoutLimit) return;

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

function updatePacketDiagnostics(pkt, now) {
  const diag = diagnostics[pkt.source];
  if (!diag) return { duplicate: false };

  const pktId = Number.isInteger(pkt.pkt_id) ? pkt.pkt_id : null;
  const timestampMs = Number.isInteger(pkt.timestamp_ms) ? pkt.timestamp_ms : null;
  const lastPktId = diag.last_pkt_id;
  const lastTimestampMs = diag.last_timestamp_ms;
  let sequenceAnomaly = false;

  if (pktId !== null && lastPktId !== null) {
    if (pktId === lastPktId && timestampMs === lastTimestampMs) {
      diag.duplicate_packets++;
      sequenceAnomaly = true;
    } else if (pktId > lastPktId + 1) {
      diag.missed_packets += pktId - lastPktId - 1;
    } else if (pktId < lastPktId || (pktId === lastPktId && timestampMs !== lastTimestampMs)) {
      diag.out_of_order_packets++;
      sequenceAnomaly = true;
    }
  }

  if (!sequenceAnomaly) {
    diag.last_pkt_id = pktId;
    diag.last_timestamp_ms = timestampMs;
  }
  diag.last_rssi_dbm = Number.isInteger(pkt.rssi_dbm) ? pkt.rssi_dbm : diag.last_rssi_dbm;
  diag.last_protocol_prefix = pkt.protocol_prefix || diag.last_protocol_prefix;
  diag.last_packet_received_at = now;
  return { duplicate: sequenceAnomaly && pktId === lastPktId && timestampMs === lastTimestampMs };
}

function diagnosticsSnapshot(source) {
  const diag = diagnostics[source] || {};
  const lastSeenAt = sourceState[source]?.lastSeenAt || diag.last_packet_received_at || null;
  return {
    ...diag,
    last_packet_age_ms: lastSeenAt ? Math.max(0, Date.now() - lastSeenAt) : null
  };
}

function initSerial(emitFn) {
  shuttingDown = false;
  activeMode = 'hardware';
  const PortClass = SerialPort;

  if (watchdogInterval) clearInterval(watchdogInterval);
  watchdogInterval = setInterval(() => {
    const now = Date.now();
    triggerSignalLost('CANSAT', emitFn, now);
    if (ENABLE_RIDESHARE_LIVE) triggerSignalLost(RIDESHARE_SOURCE, emitFn, now);
    if (ENABLE_MACHX_LIVE) triggerSignalLost('MACHX', emitFn, now);
  }, 1000);

  const handlePacket = (pkt) => {
    if (!pkt) return;
    const now = Date.now();
    markSignalRecovered(pkt.source, emitFn, now);
    sourceState[pkt.source].lastSeenAt = now;
    diagnostics[pkt.source].packets++;
    const sequence = updatePacketDiagnostics(pkt, now);

    try {
      const insertResult = insertPacket(pkt);
      if (insertResult.duplicate) {
        if (!sequence.duplicate) diagnostics[pkt.source].duplicate_packets++;
        if (process.env.LOG_PACKETS === 'true') console.log('[SERIAL] duplicate packet skipped', pkt);
        return;
      }
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

  const connectCansat = () => {
    try {
      cansatPort = new PortClass({ path: CANSAT_PORT, baudRate: CANSAT_BAUD });

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
      scheduleCansatReconnect(connectCansat);
    }
  };

  if (ENABLE_RIDESHARE_LIVE) {
    rideshareSerial = createRideshareSerial({
      PortClass,
      portPath: RIDESHARE_PORT,
      baudRate: RIDESHARE_BAUD,
      disabledPortPath: CANSAT_PORT,
      reconnectDelayMs: RECONNECT_DELAY_MS,
      diagnostics,
      sourceState,
      emitFn,
      safeEmit,
      handlePacket,
      shouldReconnect: () => !shuttingDown
    });
  } else {
    rideshareSerial = null;
    sourceState[RIDESHARE_SOURCE].connected = false;
    sourceState[RIDESHARE_SOURCE].lost = false;
    diagnostics[RIDESHARE_SOURCE].open = false;
    diagnostics[RIDESHARE_SOURCE].last_error = 'Mach-X Rideshare live telemetry disabled';
  }

  if (ENABLE_MACHX_LIVE) {
    machxSerial = createMachxSerial({
      PortClass,
      portPath: MACHX_PORT,
      baudRate: MACHX_BAUD,
      disabledPortPath: CANSAT_PORT,
      reconnectDelayMs: RECONNECT_DELAY_MS,
      diagnostics,
      sourceState,
      emitFn,
      safeEmit,
      handlePacket,
      shouldReconnect: () => !shuttingDown
    });
  } else {
    machxSerial = null;
    sourceState.MACHX.connected = false;
    sourceState.MACHX.lost = false;
    diagnostics.MACHX.open = false;
    diagnostics.MACHX.last_error = 'MACHX live telemetry disabled';
  }

  connectCansat();
  if (rideshareSerial) rideshareSerial.connect();
  if (machxSerial) machxSerial.connect();
}

function getSignalState() {
  const rideshare = {
    lost: sourceState[RIDESHARE_SOURCE].lost,
    connected: sourceState[RIDESHARE_SOURCE].connected,
    live_enabled: ENABLE_RIDESHARE_LIVE,
    port: sourceState[RIDESHARE_SOURCE].port,
    last_seen_ms: sourceState[RIDESHARE_SOURCE].lastSeenAt || 0,
    diagnostics: diagnosticsSnapshot(RIDESHARE_SOURCE)
  };
  return {
    mode: activeMode,
    CANSAT: {
      lost: sourceState.CANSAT.lost,
      connected: sourceState.CANSAT.connected,
      port: sourceState.CANSAT.port,
      last_seen_ms: sourceState.CANSAT.lastSeenAt || 0,
      diagnostics: {
        ...diagnosticsSnapshot('CANSAT'),
        framer: cansatFrameParser && typeof cansatFrameParser.getStats === 'function'
          ? cansatFrameParser.getStats()
          : null
      }
    },
    [RIDESHARE_SOURCE]: rideshare,
    [LEGACY_RIDESHARE_SOURCE]: rideshare,
    MACHX: {
      lost: sourceState.MACHX.lost,
      connected: sourceState.MACHX.connected,
      live_enabled: ENABLE_MACHX_LIVE,
      port: sourceState.MACHX.port,
      last_seen_ms: sourceState.MACHX.lastSeenAt || 0,
      diagnostics: diagnosticsSnapshot('MACHX')
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
  sourceState[RIDESHARE_SOURCE].connected = false;
  sourceState.MACHX.connected = false;
  cansatReconnectTimer = clearTimer(cansatReconnectTimer);
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  await Promise.all([
    closePort(cansatPort),
    rideshareSerial ? rideshareSerial.close() : Promise.resolve(),
    machxSerial ? machxSerial.close() : Promise.resolve()
  ]);
}

module.exports = { initSerial, getSignalState, shutdown };
