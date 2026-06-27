const { ReadlineParser } = require('serialport');
const { parseRideshare } = require('./parser');
const { RIDESHARE_SOURCE } = require('./source-aliases');

function closePort(port) {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

function createRideshareSerial({
  PortClass,
  portPath,
  baudRate,
  disabledPortPath,
  reconnectDelayMs,
  diagnostics,
  sourceState,
  emitFn,
  safeEmit,
  handlePacket,
  shouldReconnect
}) {
  let ridesharePort = null;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (!shouldReconnect() || reconnectTimer) return;
    diagnostics[RIDESHARE_SOURCE].reconnects++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const connect = () => {
    if (disabledPortPath === portPath) {
      const message = 'Mach-X Rideshare disabled because CANSAT and RIDESHARE are configured with the same serial port';
      diagnostics[RIDESHARE_SOURCE].last_error = message;
      sourceState[RIDESHARE_SOURCE].connected = false;
      console.warn(`[SERIAL] ${message}`);
      return;
    }

    try {
      ridesharePort = new PortClass({ path: portPath, baudRate });

      const parser = ridesharePort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        const trimmed = typeof line === 'string' ? line.trim() : '';
        if (!trimmed.startsWith('MXR3:') && !trimmed.startsWith('MXR2:') && !trimmed.startsWith('NRC2:') && !trimmed.startsWith('NRC:')) return;
        const parsed = parseRideshare(line);
        if (parsed) {
          handlePacket(parsed);
        } else {
          diagnostics[RIDESHARE_SOURCE].parse_errors++;
          safeEmit(emitFn, 'ingest_error', { source: RIDESHARE_SOURCE, error: 'Rejected Mach-X Rideshare telemetry line' });
        }
      });

      ridesharePort.on('open', () => {
        diagnostics[RIDESHARE_SOURCE].open = true;
        diagnostics[RIDESHARE_SOURCE].last_error = null;
        sourceState[RIDESHARE_SOURCE].connected = true;
        sourceState[RIDESHARE_SOURCE].port = portPath;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      });

      ridesharePort.on('error', (err) => {
        diagnostics[RIDESHARE_SOURCE].serial_errors++;
        diagnostics[RIDESHARE_SOURCE].last_error = err.message;
        sourceState[RIDESHARE_SOURCE].connected = false;
        console.warn('[SERIAL] RIDESHARE Error:', err.message);
        scheduleReconnect();
      });

      ridesharePort.on('close', () => {
        diagnostics[RIDESHARE_SOURCE].open = false;
        sourceState[RIDESHARE_SOURCE].connected = false;
        console.warn('[SERIAL] RIDESHARE Closed, reconnecting...');
        scheduleReconnect();
      });
    } catch (error) {
      diagnostics[RIDESHARE_SOURCE].serial_errors++;
      diagnostics[RIDESHARE_SOURCE].last_error = error.message;
      sourceState[RIDESHARE_SOURCE].connected = false;
      console.warn('[SERIAL] RIDESHARE Init Error:', error.message);
      scheduleReconnect();
    }
  };

  return {
    connect,
    close: () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      return closePort(ridesharePort);
    },
    getPort: () => ridesharePort
  };
}

module.exports = { createRideshareSerial };
