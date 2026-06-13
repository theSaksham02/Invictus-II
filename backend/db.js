const Database = require('better-sqlite3');

const dbFile = process.env.DB_FILE || './flight.db';
const db = new Database(dbFile);

const DEFAULT_HISTORY_LIMIT = 200;
const MAX_HISTORY_LIMIT = 1000;

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS packets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    pkt_id INTEGER,
    timestamp_ms INTEGER,
    altitude_m REAL,
    temp_c REAL,
    pressure_hpa REAL,
    accel_z REAL,
    gyro_x REAL,
    lat REAL,
    lon REAL,
    rssi_dbm INTEGER,
    flags INTEGER,
    raw TEXT,
    received_at INTEGER NOT NULL,
    upload_id INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_source_time ON packets(source, received_at);
  CREATE INDEX IF NOT EXISTS idx_source_pktid ON packets(source, pkt_id);

  CREATE TABLE IF NOT EXISTS mission_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    altitude_m REAL,
    timestamp_ms INTEGER,
    received_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sd_uploads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'CANSAT',
    filename TEXT,
    rows_inserted INTEGER,
    uploaded_at INTEGER NOT NULL
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('packets', 'upload_id', 'INTEGER');
ensureColumn('sd_uploads', 'source', "TEXT NOT NULL DEFAULT 'CANSAT'");
db.exec(`CREATE INDEX IF NOT EXISTS idx_packets_upload_id ON packets(upload_id);`);

const statements = {
  insertPacket: db.prepare(`
    INSERT INTO packets (source, pkt_id, timestamp_ms, altitude_m, temp_c, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, raw, received_at, upload_id)
    VALUES (@source, @pkt_id, @timestamp_ms, @altitude_m, @temp_c, @pressure_hpa, @accel_z, @gyro_x, @lat, @lon, @rssi_dbm, @flags, @raw, @received_at, @upload_id)
  `),
  insertEvent: db.prepare(`
    INSERT INTO mission_events (source, event_type, altitude_m, timestamp_ms, received_at)
    VALUES (@source, @event_type, @altitude_m, @timestamp_ms, @received_at)
  `),
  insertUpload: db.prepare(`
    INSERT INTO sd_uploads (source, filename, rows_inserted, uploaded_at)
    VALUES (@source, @filename, @rows_inserted, @uploaded_at)
  `),
  getRecentPackets: db.prepare(`
    SELECT * FROM packets
    WHERE source = ? AND (? = 0 OR received_at > ?)
    ORDER BY received_at DESC
    LIMIT ?
  `),
  getPacketStats: db.prepare(`
    SELECT
      COUNT(*) as count,
      MAX(altitude_m) as max_alt_m,
      MIN(temp_c) as min_temp_c,
      MIN(received_at) as first_packet_at,
      MAX(received_at) as last_packet_at
    FROM packets WHERE source = ?
  `),
  getLatestPacket: db.prepare(`
    SELECT * FROM packets
    WHERE source = ?
    ORDER BY received_at DESC
    LIMIT 1
  `),
  getEvents: db.prepare(`SELECT * FROM mission_events ORDER BY received_at ASC`),
  getUpload: db.prepare(`
    SELECT * FROM sd_uploads
    WHERE id = ?
  `),
  getUploadPackets: db.prepare(`
    SELECT * FROM packets
    WHERE upload_id = ?
    ORDER BY timestamp_ms ASC, pkt_id ASC, id ASC
  `),
  deleteEvents: db.prepare(`
    DELETE FROM mission_events
    WHERE (? = 'ALL' OR source = ?)
  `),
  exportPackets: db.prepare(`
    SELECT id, source, pkt_id, timestamp_ms, altitude_m, temp_c, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, received_at
    FROM packets
    WHERE (? = 'ALL' OR source = ?)
    ORDER BY received_at ASC
  `)
};

const insertPacketTx = db.transaction((packets) => {
  for (const packet of packets) {
    statements.insertPacket.run(packet);
  }
});

function runOrThrow(operation, fn) {
  try {
    return fn();
  } catch (error) {
    error.message = `[DB] ${operation} failed: ${error.message}`;
    throw error;
  }
}

function toPacketRow(packet) {
  return {
    source: packet.source,
    pkt_id: packet.pkt_id,
    timestamp_ms: packet.timestamp_ms,
    altitude_m: packet.altitude_m,
    temp_c: packet.temp_c,
    pressure_hpa: packet.pressure_hpa,
    accel_z: packet.accel_z,
    gyro_x: packet.gyro_x,
    lat: packet.lat,
    lon: packet.lon,
    rssi_dbm: packet.rssi_dbm,
    flags: packet.flags,
    raw: packet.raw,
    received_at: packet.received_at,
    upload_id: packet.upload_id ?? null
  };
}

function insertPacket(packet) {
  return runOrThrow('insertPacket', () => statements.insertPacket.run(toPacketRow(packet)));
}

function insertPacketsBulk(packets) {
  if (!Array.isArray(packets)) {
    throw new TypeError('[DB] insertPacketsBulk requires an array of packets');
  }
  if (packets.length === 0) {
    return { changes: 0 };
  }
  return runOrThrow('insertPacketsBulk', () => {
    insertPacketTx(packets.map(toPacketRow));
    return { changes: packets.length };
  });
}

function insertEvent(event) {
  return runOrThrow('insertEvent', () => statements.insertEvent.run(event));
}

function insertUpload(upload) {
  return runOrThrow('insertUpload', () => statements.insertUpload.run(upload));
}

function getUpload(id) {
  return runOrThrow('getUpload', () => statements.getUpload.get(id) || null);
}

function getUploadPackets(id) {
  return runOrThrow('getUploadPackets', () => statements.getUploadPackets.all(id));
}

function getHistory(source, limit = DEFAULT_HISTORY_LIMIT, since = 0) {
  const boundedLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || DEFAULT_HISTORY_LIMIT, 1),
    MAX_HISTORY_LIMIT
  );
  const sinceTs = Number.parseInt(since, 10) || 0;

  return runOrThrow('getHistory', () => {
    const rows = statements.getRecentPackets.all(source, sinceTs, sinceTs, boundedLimit);
    return rows.reverse();
  });
}

function getStats(source) {
  return runOrThrow('getStats', () => {
    return statements.getPacketStats.get(source) || {
      count: 0,
      max_alt_m: null,
      min_temp_c: null,
      first_packet_at: null,
      last_packet_at: null
    };
  });
}

function getLatest(source) {
  return runOrThrow('getLatest', () => statements.getLatestPacket.get(source) || null);
}

function getAllEvents() {
  return runOrThrow('getAllEvents', () => statements.getEvents.all());
}

function clearEvents(source = 'ALL') {
  return runOrThrow('clearEvents', () => statements.deleteEvents.run(source, source));
}

function exportCsv(source) {
  return runOrThrow('exportCsv', () => statements.exportPackets.all(source, source));
}

function close() {
  return runOrThrow('close', () => db.close());
}

module.exports = {
  db,
  insertPacket,
  insertPacketsBulk,
  insertEvent,
  insertUpload,
  getUpload,
  getUploadPackets,
  getHistory,
  getLatest,
  getStats,
  getAllEvents,
  clearEvents,
  exportCsv,
  close,
  MAX_HISTORY_LIMIT
};
