const { SerialPort } = require('serialport');
const { ByteLengthParser, ReadlineParser } = require('serialport');
const { parseCansat, parseNrc } = require('./parser');
const { insertPacket, insertEvent } = require('./db');
const { processPacket } = require('./phase-tracker');

const CANSAT_PORT = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
const NRC_PORT    = process.env.SERIAL_PORT_NRC    || '/dev/ttyUSB1';
const CANSAT_BAUD = parseInt(process.env.SERIAL_BAUD_CANSAT || '9600', 10);
const NRC_BAUD    = parseInt(process.env.SERIAL_BAUD_NRC || '9600', 10);
const SIM_MODE    = process.env.SIM_MODE === 'true';

let cansatPort, nrcPort;
let lastSeen = { CANSAT: Date.now(), NRC: Date.now() };
let lostReported = { CANSAT: false, NRC: false };

function initSerial(emitFn, enableSimFallback) {
  if (SIM_MODE) return enableSimFallback();

  setInterval(() => {
    const now = Date.now();
    ['CANSAT', 'NRC'].forEach(src => {
      if (now - lastSeen[src] > 5000 && !lostReported[src]) {
        lostReported[src] = true;
        try { emitFn('signal_lost', { source: src, last_seen_ms: lastSeen[src] }); } catch(e) {}
        insertEvent({ source: src, event_type: 'SIGNAL_LOST', altitude_m: 0, timestamp_ms: 0, received_at: now });
      }
    });
  }, 1000);

  const handlePacket = (pkt) => {
    if (!pkt) return;
    lastSeen[pkt.source] = Date.now();
    if (lostReported[pkt.source]) {
      lostReported[pkt.source] = false;
      try { emitFn('signal_recovered', { source: pkt.source, gap_ms: lastSeen[pkt.source] - (lastSeen[pkt.source]-5000) }); } catch(e) {}
    }
    insertPacket(pkt);
    processPacket(pkt, emitFn);
    try { emitFn('packet', { source: pkt.source, data: pkt }); } catch (e) {}
    if (process.env.LOG_PACKETS === 'true') console.log(pkt);
  };

  const connectCansat = () => {
    try {
      cansatPort = new SerialPort({ path: CANSAT_PORT, baudRate: CANSAT_BAUD });
      
      const parser = cansatPort.pipe(new ByteLengthParser({ length: 37 }));
      parser.on('data', (buf) => handlePacket(parseCansat(buf)));
      
      cansatPort.on('error', (err) => {
        console.warn('[SERIAL] CANSAT Error:', err.message);
        if (!cansatPort.isOpen && enableSimFallback) enableSimFallback();
      });
      cansatPort.on('close', () => {
        console.warn('[SERIAL] CANSAT Closed, reconnecting...');
        setTimeout(connectCansat, 3000);
      });
    } catch (e) {
      console.warn('[SERIAL] CANSAT Init Error:', e.message);
      if (enableSimFallback) enableSimFallback();
    }
  };

  const connectNrc = () => {
    if (CANSAT_PORT === NRC_PORT) return; 
    try {
      nrcPort = new SerialPort({ path: NRC_PORT, baudRate: NRC_BAUD });
      const parser = nrcPort.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', (line) => handlePacket(parseNrc(line)));
      
      nrcPort.on('error', (err) => console.warn('[SERIAL] NRC Error:', err.message));
      nrcPort.on('close', () => {
        console.warn('[SERIAL] NRC Closed, reconnecting...');
        setTimeout(connectNrc, 3000);
      });
    } catch (e) {
      console.warn('[SERIAL] NRC Init Error:', e.message);
    }
  };

  connectCansat();
  connectNrc();
}

module.exports = { initSerial };