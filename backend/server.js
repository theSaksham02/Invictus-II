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
const simulator = require('./simulator');
const rover = require('./rover-proxy');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const upload = multer({ dest: 'uploads/' });

app.use(cors({ origin: ['http://localhost:3000', 'http://localhost:5500'] }));
app.use(express.json());

let uptimeStart = Date.now();
let isSimMode = process.env.SIM_MODE === 'true';

// Broadcast helper wrapped in try/catch
let emitToAll = (evt, payload) => {
  try { io.emit(evt, payload); } catch (e) {}
};

// Init Serial or Sim
let simStarted = false;
serial.initSerial(emitToAll, () => {
  if (!simStarted && !isSimMode) {
    console.log('[SYS] Falling back to simulation mode');
    isSimMode = true;
    simStarted = true;
    simulator.startSimulation(emitToAll);
  }
});
if (isSimMode && !simStarted) {
  simStarted = true;
  simulator.startSimulation(emitToAll);
}

// Routes
app.get('/', (req, res) => {
  const dashPath = path.resolve(__dirname, process.env.DASHBOARD_PATH || '../dashboard/ground-station.html');
  if (fs.existsSync(dashPath)) res.sendFile(dashPath);
  else res.send('<h1>Ground station starting...</h1>');
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime_s: Math.floor((Date.now() - uptimeStart) / 1000),
    serial_connected: !isSimMode,
    db_packet_count: db.getStats('CANSAT').count + db.getStats('NRC').count,
    sim_mode: isSimMode
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
  fs.unlinkSync(req.file.path);
  
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
app.post('/api/rover/stop', async (req, res) => res.json(await rover.stop()));
app.get('/api/rover/data', async (req, res) => res.json(await rover.data()));

// Socket.io
io.on('connection', (socket) => {
  try {
    socket.emit('history', {
      cansat: db.getHistory('CANSAT', 60),
      nrc: db.getHistory('NRC', 60),
      events: db.getAllEvents()
    });
  } catch (e) {}

  socket.on('subscribe_source', (data) => { if(data && data.source) socket.data.source = data.source; });
  socket.on('request_history', (data) => {
    if(!data || !data.source) return;
    try { socket.emit('history', { source: data.source, packets: db.getHistory(data.source, data.limit || 200) }); } catch(e){}
  });
});

const rawEmitToAll = emitToAll;
emitToAll = (evt, payload) => {
  if (evt === 'packet') {
    io.sockets.sockets.forEach(s => {
      if (!s.data.source || s.data.source === 'ALL' || s.data.source === payload.source) {
        try { s.emit(evt, payload); } catch(e){}
      }
    });
  } else {
    rawEmitToAll(evt, payload);
  }
};

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`[SYS] Server running on port ${PORT}`));

process.on('SIGINT', () => {
  console.log('\\n[SYS] Shutting down...');
  if(isSimMode) simulator.stopSimulation();
  try { db.db.close(); } catch(e){}
  process.exit(0);
});