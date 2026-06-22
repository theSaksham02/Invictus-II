const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { parseMachX } = require('./parser');

function closePort(port) {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

function createMachxSerial({
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
  let machxPort = null;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (!shouldReconnect() || reconnectTimer) return;
    diagnostics.MACHX.reconnects++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const connect = () => {
    if (disabledPortPath === portPath) {
      const message = 'MACHX disabled because CANSAT and MACHX are configured with the same serial port';
      diagnostics.MACHX.last_error = message;
      sourceState.MACHX.connected = false;
      console.warn(`[SERIAL] ${message}`);
      return;
    }

    try {
      machxPort = new PortClass({ path: portPath, baudRate });

      const parser = machxPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        const trimmed = typeof line === 'string' ? line.trim() : '';
        if (!trimmed.startsWith('MACHX2:')) return;
        const parsed = parseMachX(line);
        if (parsed) {
          handlePacket(parsed);
        } else {
          diagnostics.MACHX.parse_errors++;
          safeEmit(emitFn, 'ingest_error', { source: 'MACHX', error: 'Rejected MACHX telemetry line' });
        }
      });

      machxPort.on('open', () => {
        diagnostics.MACHX.open = true;
        diagnostics.MACHX.last_error = null;
        sourceState.MACHX.connected = true;
        sourceState.MACHX.port = portPath;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      });

      machxPort.on('error', (err) => {
        diagnostics.MACHX.serial_errors++;
        diagnostics.MACHX.last_error = err.message;
        sourceState.MACHX.connected = false;
        console.warn('[SERIAL] MACHX Error:', err.message);
        scheduleReconnect();
      });

      machxPort.on('close', () => {
        diagnostics.MACHX.open = false;
        sourceState.MACHX.connected = false;
        console.warn('[SERIAL] MACHX Closed, reconnecting...');
        scheduleReconnect();
      });
    } catch (error) {
      diagnostics.MACHX.serial_errors++;
      diagnostics.MACHX.last_error = error.message;
      sourceState.MACHX.connected = false;
      console.warn('[SERIAL] MACHX Init Error:', error.message);
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
      return closePort(machxPort);
    },
    getPort: () => machxPort
  };
}

module.exports = { createMachxSerial };
