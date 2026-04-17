const Database = require('better-sqlite3');
const path = require('path');

const dbFile = process.env.DB_FILE || './flight.db';
const db = new Database(dbFile);

// Create tables
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
    received_at INTEGER NOT NULL
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
    filename TEXT,
    rows_inserted INTEGER,
    uploaded_at INTEGER NOT NULL
  );
`);

const statements = {
  insertPacket: db.prepare(`
    INSERT INTO packets (source, pkt_id, timestamp_ms, altitude_m, temp_c, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, raw, received_at)
    VALUES (@source, @pkt_id, @timestamp_ms, @altitude_m, @temp_c, @pressure_hpa, @accel_z, @gyro_x, @lat, @lon, @rssi_dbm, @flags, @raw, @received_at)
  `),
  insertEvent: db.prepare(`
    INSERT INTO mission_events (source, event_type, altitude_m, timestamp_ms, received_at)
    VALUES (@source, @event_type, @altitude_m, @timestamp_ms, @received_at)
  `),
  insertUpload: db.prepare(`
    INSERT INTO sd_uploads (filename, rows_inserted, uploaded_at)
    VALUES (@filename, @rows_inserted, @uploaded_at)
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
  getEvents: db.prepare(`SELECT * FROM mission_events ORDER BY received_at ASC`),
  exportPackets: db.prepare(`SELECT id, source, pkt_id, timestamp_ms, altitude_m, temp_c, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, received_at FROM packets WHERE (? = 'ALL' OR source = ?) ORDER BY received_at ASC`)
};

function insertPacket(p) {
  try { return statements.insertPacket.run(p); } 
  catch (e) { console.error('[DB] insertPacket error:', e.message); }
}

function insertEvent(e) {
  try { return statements.insertEvent.run(e); } 
  catch (err) { console.error('[DB] insertEvent error:', err.message); }
}

function insertUpload(u) {
  try { return statements.insertUpload.run(u); } 
  catch (err) { console.error('[DB] insertUpload error:', err.message); }
}

function getHistory(source, limit = 200, since = 0) {
  try {
    const rows = statements.getRecentPackets.all(source, since, since, limit);
    return rows.reverse(); // oldest->newest
  } catch (err) {
    console.error('[DB] getHistory error:', err.message);
    return [];
  }
}

function getStats(source) {
  try { return statements.getPacketStats.get(source) || { count: 0 }; } 
  catch (err) { console.error('[DB] getStats error:', err.message); return { count: 0 }; }
}

function getAllEvents() {
  try { return statements.getEvents.all(); } 
  catch (err) { console.error('[DB] getAllEvents error:', err.message); return []; }
}

function exportCsv(source) {
  try { return statements.exportPackets.all(source, source); } 
  catch (err) { console.error('[DB] exportCsv error:', err.message); return []; }
}

module.exports = {
  db,
  insertPacket,
  insertEvent,
  insertUpload,
  getHistory,
  getStats,
  getAllEvents,
  exportCsv
};