require('dotenv').config();
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const db = require('./db');
const serial = require('./serial');
const rover = require('./rover-proxy');
const { log } = require('./logger');
const {
  CIRCUIT,
  NRC_PAYLOAD_CIRCUIT,
  TELEMETRY_LIMITS,
  decodeFlags,
  deriveSensorHealth,
  packetWarnings
} = require('./cansat-hardware');

const app = express();
const server = http.createServer(app);
const CONFIGURED_PORT = Number.parseInt(process.env.PORT || '3000', 10);
const DEFAULT_ALLOWED_ORIGINS = [
  `http://localhost:${CONFIGURED_PORT}`,
  `http://127.0.0.1:${CONFIGURED_PORT}`,
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'null'
];
const allowedOrigins = (process.env.CORS_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOptions = {
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    const error = new Error('Origin not allowed by CORS');
    error.status = 403;
    cb(error);
  }
};
const io = new Server(server, { cors: corsOptions });

const SD_UPLOAD_MAX_FILE_BYTES = Math.max(
  Number.parseInt(process.env.SD_UPLOAD_MAX_FILE_BYTES || '5242880', 10) || 5242880,
  1024
);
const SD_UPLOAD_MAX_ROWS = Math.max(
  Number.parseInt(process.env.SD_UPLOAD_MAX_ROWS || '50000', 10) || 50000,
  100
);
const TELEMETRY_SOURCES = new Set(['CANSAT', 'NRC', 'MACHX', 'SUGAR']);
const EXPORT_SOURCES = new Set(['CANSAT', 'NRC', 'ALL', 'MACHX', 'SUGAR']);

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: SD_UPLOAD_MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extension !== '.csv') {
      cb(new HttpError(400, 'Only .csv files are accepted for SD upload'));
      return;
    }
    cb(null, true);
  }
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use('/vendor', express.static(path.resolve(__dirname, 'node_modules/three/build')));
app.use('/images', express.static(path.resolve(__dirname, '../images')));

let uptimeStart = Date.now();
let shuttingDown = false;

class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function parseSource(value, allowedSet, fallback) {
  const candidate = (value || fallback || '').toString().toUpperCase();
  if (!allowedSet.has(candidate)) {
    throw new HttpError(400, 'Invalid source parameter', {
      source: candidate,
      allowed: [...allowedSet]
    });
  }
  return candidate;
}

function parseBoundedInt(value, fallback, min, max, field) {
  const parsed = Number.parseInt(value, 10);
  const effective = Number.isNaN(parsed) ? fallback : parsed;
  if (!Number.isInteger(effective) || effective < min || effective > max) {
    throw new HttpError(400, `Invalid ${field} parameter`, { field, min, max });
  }
  return effective;
}

function parseRequiredBoundedInt(value, min, max, field) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `Invalid ${field} parameter`, { field, min, max });
  }
  return parsed;
}

function parseRoverInput(value, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new HttpError(400, `Invalid rover ${field} value`, { field });
  }
  if (numeric < -100 || numeric > 100) {
    throw new HttpError(400, `Rover ${field} must be between -100 and 100`, { field });
  }
  return numeric;
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const asString = String(value);
  if (/[,"\n]/.test(asString)) return `"${asString.replace(/"/g, '""')}"`;
  return asString;
}

function parseCsvRecords(content) {
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(field.trim());
      if (row.some((value) => value !== '')) records.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  row.push(field.trim());
  if (row.some((value) => value !== '')) records.push(row);
  if (inQuotes) throw new HttpError(400, 'CSV contains an unterminated quoted field');
  return records;
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function makeHeaderLookup(headers) {
  const lookup = new Map();
  headers.forEach((header, index) => lookup.set(normalizeHeader(header), index));
  return lookup;
}

function getCsvValue(row, lookup, names) {
  for (const name of names) {
    const index = lookup.get(name);
    if (index !== undefined) return row[index];
  }
  return undefined;
}

function parseOptionalCsvFloat(row, lookup, names) {
  const rawValue = getCsvValue(row, lookup, names);
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return null;
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function inTelemetryRange(value, field) {
  const limit = TELEMETRY_LIMITS[field];
  if (!limit) return true;
  return Number.isFinite(value) && value >= limit.min && value <= limit.max;
}

function optionalInTelemetryRange(value, field) {
  return value === null || inTelemetryRange(value, field);
}

function parseSdPacketRow(row, lookup, raw, receivedAt, source) {
  const accelZ = parseOptionalCsvFloat(row, lookup, ['accel_z', 'acceleration_z']);
  const gyroX = parseOptionalCsvFloat(row, lookup, ['gyro_x', 'gyroscope_x']);
  const rssiRaw = getCsvValue(row, lookup, ['rssi_dbm', 'rssi']);
  const rssiDbm = rssiRaw === undefined || String(rssiRaw).trim() === ''
    ? 0
    : Number.parseInt(rssiRaw, 10);
  const packet = {
    source,
    pkt_id: Number.parseInt(getCsvValue(row, lookup, ['pkt_id', 'packet_id', 'id']), 10),
    timestamp_ms: Number.parseInt(getCsvValue(row, lookup, ['timestamp_ms', 'time_ms', 'timestamp']), 10),
    altitude_m: Number.parseFloat(getCsvValue(row, lookup, ['altitude_m', 'alt_m', 'altitude'])),
    temp_c: Number.parseFloat(getCsvValue(row, lookup, ['temp_c', 'temperature_c', 'temperature'])),
    temp_c_1: parseOptionalCsvFloat(row, lookup, ['temp_c_1', 'temperature_c_1']),
    temp_c_2: parseOptionalCsvFloat(row, lookup, ['temp_c_2', 'temperature_c_2']),
    temp_c_3: parseOptionalCsvFloat(row, lookup, ['temp_c_3', 'temperature_c_3']),
    temp_c_4: parseOptionalCsvFloat(row, lookup, ['temp_c_4', 'temperature_c_4']),
    pressure_hpa: Number.parseFloat(getCsvValue(row, lookup, ['pressure_hpa', 'pressure'])),
    accel_z: accelZ,
    gyro_x: gyroX,
    lat: Number.parseFloat(getCsvValue(row, lookup, ['lat', 'latitude'])),
    lon: Number.parseFloat(getCsvValue(row, lookup, ['lon', 'lng', 'longitude'])),
    flags: Number.parseInt(getCsvValue(row, lookup, ['flags', 'flag']), 10),
    rssi_dbm: rssiDbm,
    raw,
    received_at: receivedAt
  };

  return (
    Number.isInteger(packet.pkt_id) &&
    inTelemetryRange(packet.pkt_id, 'pkt_id') &&
    Number.isInteger(packet.timestamp_ms) &&
    inTelemetryRange(packet.timestamp_ms, 'timestamp_ms') &&
    inTelemetryRange(packet.altitude_m, 'altitude_m') &&
    inTelemetryRange(packet.temp_c, 'temp_c') &&
    optionalInTelemetryRange(packet.temp_c_1, 'temp_c_1') &&
    optionalInTelemetryRange(packet.temp_c_2, 'temp_c_2') &&
    optionalInTelemetryRange(packet.temp_c_3, 'temp_c_3') &&
    optionalInTelemetryRange(packet.temp_c_4, 'temp_c_4') &&
    inTelemetryRange(packet.pressure_hpa, 'pressure_hpa') &&
    (source === 'NRC' ? optionalInTelemetryRange(packet.accel_z, 'accel_z') : inTelemetryRange(packet.accel_z, 'accel_z')) &&
    (source === 'NRC' ? optionalInTelemetryRange(packet.gyro_x, 'gyro_x') : inTelemetryRange(packet.gyro_x, 'gyro_x')) &&
    inTelemetryRange(packet.lat, 'lat') &&
    inTelemetryRange(packet.lon, 'lon') &&
    Number.isInteger(packet.rssi_dbm) &&
    inTelemetryRange(packet.rssi_dbm, 'rssi_dbm') &&
    Number.isInteger(packet.flags) &&
    inTelemetryRange(packet.flags, 'flags')
  ) ? packet : null;
}

function summarizeApogee(packets) {
  if (!Array.isArray(packets) || packets.length === 0) return null;
  let apogeePacket = null;
  for (const packet of packets) {
    if (!Number.isFinite(packet.altitude_m)) continue;
    if (!apogeePacket || packet.altitude_m > apogeePacket.altitude_m) {
      apogeePacket = packet;
    }
  }
  if (!apogeePacket) return null;
  return {
    altitude_m: apogeePacket.altitude_m,
    timestamp_ms: apogeePacket.timestamp_ms,
    pkt_id: apogeePacket.pkt_id
  };
}

function summarizeDurationSeconds(packets) {
  if (!Array.isArray(packets) || packets.length === 0) return 0;
  const times = packets
    .map((packet) => packet.timestamp_ms)
    .filter((timestamp) => Number.isFinite(timestamp));
  if (times.length === 0) return 0;
  const min = Math.min(...times);
  const max = Math.max(...times);
  return Math.max(0, (max - min) / 1000);
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function requireRoverControlAuth(req, res, next) {
  const expected = process.env.ROVER_CONTROL_TOKEN;
  if (!expected) return next();

  const headerToken = req.headers['x-rover-token'];
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (headerToken === expected || bearer === expected) return next();

  throw new HttpError(401, 'Rover control token required');
}

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

let emitToAll = (event, payload) => {
  if (event === 'packet') {
    io.sockets.sockets.forEach((socket) => {
      if (!socket.data.source || socket.data.source === 'ALL' || socket.data.source === payload.source) {
        socket.emit(event, payload);
      }
    });
    return;
  }
  io.emit(event, payload);
};

serial.initSerial(emitToAll);

app.get('/', (req, res) => {
  const dashPath = path.resolve(__dirname, '../dashboard/index.html');
  if (fs.existsSync(dashPath)) {
    res.sendFile(dashPath);
    return;
  }
  res.send('<h1 style="font-family:monospace;color:#00d4ff;background:#020817;padding:2rem">MACH-26 Ground Station — backend running, index not found.</h1>');
});

app.get('/avionics', (req, res) => res.redirect('/nrc'));

app.get('/nrc', (req, res) => {
  const dashPath = path.resolve(__dirname, '../dashboard/nrc.html');
  if (fs.existsSync(dashPath)) res.sendFile(dashPath);
  else res.status(404).send('National Rocketry Championship Dashboard missing');
});

app.get('/ort', (req, res) => {
  const dashPath = path.resolve(__dirname, '../dashboard/ort.html');
  if (fs.existsSync(dashPath)) res.sendFile(dashPath);
  else res.status(404).send('ORT Dashboard missing');
});

app.get('/mach-x', (req, res) => {
  const dashPath = path.resolve(__dirname, '../dashboard/mach-x.html');
  if (fs.existsSync(dashPath)) res.sendFile(dashPath);
  else res.status(404).send('Mach-X Dashboard missing');
});

app.get('/api/health', (req, res) => {
  const signal = serial.getSignalState();
  const cansatStats = db.getStats('CANSAT');
  const nrcStats = db.getStats('NRC');

  res.json({
    status: 'ok',
    uptime_s: Math.floor((Date.now() - uptimeStart) / 1000),
    serial_connected: Boolean(signal.CANSAT.connected || signal.NRC.connected || signal.MACHX.connected),
    db_packet_count: cansatStats.count + nrcStats.count,
    signal
  });
});

app.get('/api/cansat/hardware', (req, res) => {
  res.json({
    ok: true,
    circuit: CIRCUIT
  });
});

app.get('/api/nrc/hardware', (req, res) => {
  res.json({
    ok: true,
    circuit: NRC_PAYLOAD_CIRCUIT
  });
});

app.get('/api/cansat/status', (req, res) => {
  const latest = db.getLatest('CANSAT');
  const signal = serial.getSignalState().CANSAT;
  res.json({
    ok: true,
    signal,
    latest: latest
      ? {
          ...latest,
          flags_decoded: decodeFlags(latest.flags),
          sensor_health: deriveSensorHealth(latest),
          warnings: packetWarnings(latest)
        }
      : null
  });
});

app.get('/api/nrc/status', (req, res) => {
  const latest = db.getLatest('NRC');
  const signal = serial.getSignalState().NRC;
  res.json({
    ok: true,
    signal,
    latest: latest
      ? {
          ...latest,
          flags_decoded: decodeFlags(latest.flags),
          sensor_health: deriveSensorHealth(latest),
          warnings: packetWarnings(latest)
        }
      : null
  });
});

app.get('/api/packets', (req, res) => {
  const source = parseSource(req.query.source, TELEMETRY_SOURCES, 'CANSAT');
  const limit = parseBoundedInt(req.query.limit, 200, 1, db.MAX_HISTORY_LIMIT, 'limit');
  const since = parseBoundedInt(req.query.since, 0, 0, Number.MAX_SAFE_INTEGER, 'since');
  const packets = db.getHistory(source, limit, since);
  res.json({ source, count: packets.length, packets });
});

app.get('/api/stats', (req, res) => {
  res.json({
    cansat: db.getStats('CANSAT'),
    nrc: db.getStats('NRC'),
    events: db.getAllEvents(),
    uptime_s: Math.floor((Date.now() - uptimeStart) / 1000)
  });
});

app.delete('/api/events', (req, res) => {
  const source = parseSource(req.body?.source || req.query?.source, EXPORT_SOURCES, 'ALL');
  const result = db.clearEvents(source);
  const payload = {
    ok: true,
    source,
    cleared: result.changes || 0
  };
  emitToAll('mission_log_cleared', payload);
  res.json(payload);
});

app.post('/api/upload-sd', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  const source = parseSource(req.body?.source || req.query?.source, new Set(['CANSAT', 'NRC']), 'CANSAT');

  const now = Date.now();
  let content = '';
  try {
    content = await fs.promises.readFile(req.file.path, 'utf-8');
  } finally {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }

  const records = parseCsvRecords(content);
  if (records.length < 2) throw new HttpError(400, 'CSV must include a header and at least one data row');
  if (records.length - 1 > SD_UPLOAD_MAX_ROWS) {
    throw new HttpError(413, 'CSV row count exceeds configured upload limit', { max_rows: SD_UPLOAD_MAX_ROWS });
  }

  const headerLookup = makeHeaderLookup(records[0]);
  const packets = [];
  let skipped = 0;
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    if (row.length < 8) {
      skipped++;
      continue;
    }

    const packet = parseSdPacketRow(row, headerLookup, row.map(csvEscape).join(','), now, source);
    if (!packet) {
      skipped++;
      continue;
    }
    packets.push(packet);
  }

  if (packets.length === 0) throw new HttpError(400, 'No valid telemetry rows found in uploaded CSV');

  const uploadResult = db.insertUpload({
    source,
    filename: req.file.originalname,
    rows_inserted: packets.length,
    uploaded_at: now
  });
  const uploadId = Number(uploadResult.lastInsertRowid || uploadResult.id || 0);
  packets.forEach((packet) => {
    packet.upload_id = uploadId || null;
  });
  db.insertPacketsBulk(packets);

  const response = {
    ok: true,
    source,
    upload_id: uploadId || null,
    inserted: packets.length,
    skipped,
    duration_s: summarizeDurationSeconds(packets),
    filename: req.file.originalname,
    apogee: summarizeApogee(packets)
  };
  emitToAll('sd_upload_complete', response);
  res.status(201).json(response);
}));

app.get('/api/sd-uploads/:upload_id/packets', (req, res) => {
  const uploadId = parseRequiredBoundedInt(req.params.upload_id, 1, Number.MAX_SAFE_INTEGER, 'upload_id');
  const uploadRecord = db.getUpload(uploadId);
  if (!uploadRecord) throw new HttpError(404, 'SD upload not found', { upload_id: uploadId });
  const packets = db.getUploadPackets(uploadId);
  res.json({
    ok: true,
    upload_id: uploadId,
    source: uploadRecord.source,
    count: packets.length,
    packets
  });
});

app.get('/api/export', (req, res) => {
  const source = parseSource(req.query.source, EXPORT_SOURCES, 'CANSAT');
  const rows = db.exportCsv(source);
  const columns = ['id', 'source', 'pkt_id', 'timestamp_ms', 'altitude_m', 'temp_c', 'temp_c_1', 'temp_c_2', 'temp_c_3', 'temp_c_4', 'pressure_hpa', 'accel_z', 'gyro_x', 'lat', 'lon', 'rssi_dbm', 'flags', 'received_at'];
  const csv = [columns.join(',')]
    .concat(rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')))
    .join('\n');

  res.header('Content-Type', 'text/csv');
  res.header('Content-Disposition', `attachment; filename="flight-${source}-${Date.now()}.csv"`);
  res.send(csv);
});

app.post('/api/rover/control', requireRoverControlAuth, asyncRoute(async (req, res) => {
  const left = parseRoverInput(req.body?.left, 'left');
  const right = parseRoverInput(req.body?.right, 'right');
  const data = await rover.control(left, right);
  res.json({ ok: true, data });
}));

app.post('/api/rover/stop', requireRoverControlAuth, asyncRoute(async (req, res) => {
  const data = await rover.stop();
  res.json({ ok: true, data });
}));

app.post('/api/rover/arm', requireRoverControlAuth, asyncRoute(async (req, res) => {
  const data = await rover.arm();
  res.json({ ok: true, data });
}));

app.get('/api/rover/data', asyncRoute(async (req, res) => {
  const data = await rover.data();
  res.json({ ok: true, data });
}));

io.on('connection', (socket) => {
  try {
    socket.emit('history', {
      cansat: db.getHistory('CANSAT', 60),
      nrc: db.getHistory('NRC', 60),
      events: db.getAllEvents()
    });
  } catch (error) {
    log('warn', 'Failed to emit initial history', { error: error.message });
  }

  socket.on('subscribe_source', (data) => {
    if (!data || !data.source) return;
    const source = data.source.toString().toUpperCase();
    if (source === 'ALL' || TELEMETRY_SOURCES.has(source)) {
      socket.data.source = source;
    }
  });

  socket.on('request_history', (data) => {
    if (!data || !data.source) return;
    try {
      const source = parseSource(data.source, TELEMETRY_SOURCES, 'CANSAT');
      const limit = parseBoundedInt(data.limit, 200, 1, db.MAX_HISTORY_LIMIT, 'limit');
      socket.emit('history', {
        source,
        packets: db.getHistory(source, limit)
      });
    } catch (error) {
      socket.emit('server_error', { message: error.message });
    }
  });
});

app.use((error, req, res, next) => {
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({
      ok: false,
      error: 'Upload exceeds allowed file size',
      code: 'LIMIT_FILE_SIZE',
      request_id: req.requestId
    });
    return;
  }

  const status = error instanceof HttpError
    ? error.status
    : Number.isInteger(error.status)
      ? error.status
      : 500;

  const payload = {
    ok: false,
    error: error.message || 'Internal server error',
    request_id: req.requestId
  };
  if (error.code) payload.code = error.code;
  if (error.details) payload.details = error.details;

  if (status >= 500) {
    log('error', 'Unhandled backend error', {
      request_id: req.requestId,
      path: req.path,
      method: req.method,
      status,
      error: error.message
    });
  }

  res.status(status).json(payload);
});

const PORT = CONFIGURED_PORT;
server.listen(PORT, () => {
  log('info', 'MACH-26 Ground Station started', { port: PORT, mode: 'hardware' });
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'Shutting down ground station', { signal });

  try {
    await serial.shutdown();
  } catch (error) {
    log('warn', 'Serial shutdown reported error', { error: error.message });
  }

  try {
    db.close();
  } catch (error) {
    log('warn', 'DB close reported error', { error: error.message });
  }

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
