require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const serial = require('./serial');
const emulator = require('./emulator');
const rover = require('./rover-proxy');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const upload = multer({ dest: 'uploads/' });

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/vendor', express.static(path.resolve(__dirname, 'node_modules/three/build')));

let uptimeStart = Date.now();
let isSimMode = process.env.SIM_MODE === 'true';

// ── FIX: Define filtered emitToAll BEFORE passing to serial.initSerial ──────
// Per-socket source subscription filtering for 'packet' events.
// All other events broadcast to everyone.
let emitToAll = (evt, payload) => {
  if (evt === 'packet') {
    io.sockets.sockets.forEach(s => {
      if (!s.data.source || s.data.source === 'ALL' || s.data.source === payload.source) {
        try { s.emit(evt, payload); } catch (e) {}
      }
    });
  } else {
    try { io.emit(evt, payload); } catch (e) {}
  }
};

// ── SIGNAL LOST WATCHDOG ──────────────────────────────────────────────────────
// Emits 'signal_lost' if no packet received from a source for 5 seconds.
// Emits 'signal_recovered' when packets resume after a gap.
const lastPacketTime = { CANSAT: 0, NRC: 0 };
const signalLost = { CANSAT: false, NRC: false };
const SIGNAL_TIMEOUT_MS = 5000;

function onPacketReceived(source) {
  const now = Date.now();
  if (signalLost[source]) {
    const gapMs = now - lastPacketTime[source];
    signalLost[source] = false;
    try { emitToAll('signal_recovered', { source, gap_ms: gapMs }); } catch (e) {}
    console.log(`[SIGNAL] ${source} recovered after ${(gapMs / 1000).toFixed(1)}s`);
  }
  lastPacketTime[source] = now;
}

setInterval(() => {
  const now = Date.now();
  ['CANSAT', 'NRC'].forEach(source => {
    if (lastPacketTime[source] === 0) return; // never received, don't alert
    const gap = now - lastPacketTime[source];
    if (gap > SIGNAL_TIMEOUT_MS && !signalLost[source]) {
      signalLost[source] = true;
      try { emitToAll('signal_lost', { source, last_seen_ms: lastPacketTime[source] }); } catch (e) {}
      console.warn(`[SIGNAL] ${source} signal lost — no packet for ${(gap / 1000).toFixed(1)}s`);
    }
  });
}, 1000);

// Wrap emitToAll to intercept 'packet' events and update watchdog
const _emitToAll = emitToAll;
emitToAll = (evt, payload) => {
  if (evt === 'packet' && payload && payload.source) {
    onPacketReceived(payload.source);
  }
  _emitToAll(evt, payload);
};

// ── INIT SERIAL OR SIM ────────────────────────────────────────────────────────
let simStarted = false;
if (isSimMode) {
  process.env.SIM_MODE = 'true';
  emulator.startEmulator();
  simStarted = true;
}

serial.initSerial(emitToAll, () => {
  if (!simStarted && !isSimMode) {
    console.log('[SYS] Hardware Not Found: Falling back to HITL Emulator');
    isSimMode = true;
    process.env.SIM_MODE = 'true';
    simStarted = true;
    emulator.startEmulator();
  }
});

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const dashPath = path.resolve(__dirname, process.env.DASHBOARD_PATH || '../dashboard/ground-station.html');
  if (fs.existsSync(dashPath)) res.sendFile(dashPath);
  else res.send('<h1 style="font-family:monospace;color:#00d4ff;background:#020817;padding:2rem">INVICTUS II Ground Station — backend running, dashboard not yet deployed.</h1>');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime_s: Math.floor((Date.now() - uptimeStart) / 1000),
    serial_connected: !isSimMode,
    db_packet_count: db.getStats('CANSAT').count + db.getStats('NRC').count,
    sim_mode: isSimMode,
    signal: {
      CANSAT: { lost: signalLost.CANSAT, last_seen_ms: lastPacketTime.CANSAT },
      NRC:    { lost: signalLost.NRC,    last_seen_ms: lastPacketTime.NRC }
    }
  });
});

app.get('/api/packets', (req, res) => {
  const src = req.query.source || 'CANSAT';
  const limit = Math.min(parseInt(req.query.limit) || 200, 1000);
  const since = parseInt(req.query.since) || 0;
  const packets = db.getHistory(src, limit, since);
  res.json({ source: src, count: packets.length, packets });
});

app.get('/api/stats', (req, res) => {
  res.json({
    cansat: db.getStats('CANSAT'),
    nrc: db.getStats('NRC'),
    events: db.getAllEvents(),
    uptime_s: Math.floor((Date.now() - uptimeStart) / 1000)
  });
});

app.post('/api/upload-sd', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'No file' });
  const lines = fs.readFileSync(req.file.path, 'utf-8').split('\n');
  let inserted = 0, skipped = 0;
  const now = Date.now();

  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].trim().split(',');
    if (p.length < 10) { skipped++; continue; }
    const pkt = {
      source: 'SD_CARD',
      pkt_id: parseInt(p[0]),
      timestamp_ms: parseInt(p[1]),
      altitude_m: parseFloat(p[2]),
      temp_c: parseFloat(p[3]),
      pressure_hpa: parseFloat(p[4]),
      accel_z: parseFloat(p[5]),
      gyro_x: parseFloat(p[6]),
      lat: parseFloat(p[7]),
      lon: parseFloat(p[8]),
      flags: parseInt(p[9]),
      rssi_dbm: 0,
      raw: lines[i].trim(),
      received_at: now
    };
    if (isNaN(pkt.altitude_m) || isNaN(pkt.timestamp_ms)) { skipped++; continue; }
    db.insertPacket(pkt);
    inserted++;
  }
  db.insertUpload({ filename: req.file.originalname, rows_inserted: inserted, uploaded_at: now });
  try { fs.unlinkSync(req.file.path); } catch (e) {}

  const resp = { ok: true, inserted, skipped, filename: req.file.originalname };
  emitToAll('sd_upload_complete', resp);
  res.json(resp);
});

app.get('/api/export', (req, res) => {
  const src = req.query.source || 'CANSAT';
  const rows = db.exportCsv(src);
  const csv = ['id,source,pkt_id,timestamp_ms,altitude_m,temp_c,pressure_hpa,accel_z,gyro_x,lat,lon,rssi_dbm,flags,received_at']
    .concat(rows.map(r => `${r.id},${r.source},${r.pkt_id},${r.timestamp_ms},${r.altitude_m},${r.temp_c},${r.pressure_hpa},${r.accel_z},${r.gyro_x},${r.lat},${r.lon},${r.rssi_dbm},${r.flags},${r.received_at}`))
    .join('\n');
  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', `attachment; filename="flight-${src}-${Date.now()}.csv"`);
  res.send(csv);
});

app.post('/api/rover/control', async (req, res) => res.json(await rover.control(req.body.left, req.body.right)));
app.post('/api/rover/stop',    async (req, res) => res.json(await rover.stop()));
app.get('/api/rover/data',     async (req, res) => res.json(await rover.data()));

// ── SOCKET.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  try {
    socket.emit('history', {
      cansat: db.getHistory('CANSAT', 60),
      nrc:    db.getHistory('NRC', 60),
      events: db.getAllEvents()
    });
  } catch (e) {}

  socket.on('subscribe_source', (data) => {
    if (data && data.source) socket.data.source = data.source;
  });

  socket.on('request_history', (data) => {
    if (!data || !data.source) return;
    try {
      socket.emit('history', {
        source: data.source,
        packets: db.getHistory(data.source, data.limit || 200)
      });
    } catch (e) {}
  });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SYS] INVICTUS II Ground Station running on http://localhost:${PORT}`));

// ── GRACEFUL SHUTDOWN ─────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n[SYS] Shutting down ground station...');
  if (isSimMode) { try { emulator.stopEmulator(); } catch (e) {} }
  try { db.db.close(); } catch (e) {}
  console.log('[SYS] Serial port released. DB closed. Bye.');
  process.exit(0);
});
