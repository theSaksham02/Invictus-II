const { ReadlineParser } = require('serialport');
const { parseNrc } = require('./parser');

function closePort(port) {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) return resolve();
    port.close(() => resolve());
  });
}

function writePort(port, command) {
  return new Promise((resolve, reject) => {
    if (!port || !port.isOpen) {
      reject(new Error('NRC serial port is not open'));
      return;
    }
    port.write(command, (writeError) => {
      if (writeError) return reject(writeError);
      if (typeof port.drain !== 'function') return resolve();
      port.drain((drainError) => drainError ? reject(drainError) : resolve());
    });
  });
}

function createNrcSerial({
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
  let nrcPort = null;
  let reconnectTimer = null;

  const scheduleReconnect = () => {
    if (!shouldReconnect() || reconnectTimer) return;
    diagnostics.NRC.reconnects++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const connect = () => {
    if (disabledPortPath === portPath) {
      const message = 'NRC disabled because CANSAT and NRC are configured with the same serial port';
      diagnostics.NRC.last_error = message;
      sourceState.NRC.connected = false;
      console.warn(`[SERIAL] ${message}`);
      return;
    }

    try {
      nrcPort = new PortClass({ path: portPath, baudRate });

      const parser = nrcPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => {
        const trimmed = typeof line === 'string' ? line.trim() : '';
        if (!trimmed.startsWith('NRC:') && !trimmed.startsWith('NRC2:')) return;
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
        sourceState.NRC.connected = true;
        sourceState.NRC.port = portPath;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      });

      nrcPort.on('error', (err) => {
        diagnostics.NRC.serial_errors++;
        diagnostics.NRC.last_error = err.message;
        sourceState.NRC.connected = false;
        console.warn('[SERIAL] NRC Error:', err.message);
        scheduleReconnect();
      });

      nrcPort.on('close', () => {
        diagnostics.NRC.open = false;
        sourceState.NRC.connected = false;
        console.warn('[SERIAL] NRC Closed, reconnecting...');
        scheduleReconnect();
      });
    } catch (error) {
      diagnostics.NRC.serial_errors++;
      diagnostics.NRC.last_error = error.message;
      sourceState.NRC.connected = false;
      console.warn('[SERIAL] NRC Init Error:', error.message);
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
      return closePort(nrcPort);
    },
    sendLaunchCommand: () => writePort(nrcPort, 'CMD:LAUNCH\n'),
    getPort: () => nrcPort
  };
}

module.exports = { createNrcSerial };
