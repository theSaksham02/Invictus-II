const Database = require('better-sqlite3');
const { createHash } = require('crypto');
const { sourceAliases } = require('./source-aliases');

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
    packet_hash TEXT,
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
ensureColumn('packets', 'temp_c_1', 'REAL');
ensureColumn('packets', 'temp_c_2', 'REAL');
ensureColumn('packets', 'temp_c_3', 'REAL');
ensureColumn('packets', 'temp_c_4', 'REAL');
ensureColumn('packets', 'protocol_version', 'INTEGER');
ensureColumn('packets', 'mission_mode_id', 'INTEGER');
ensureColumn('packets', 'mission_mode', 'TEXT');
ensureColumn('packets', 'packet_hash', 'TEXT');
ensureColumn('sd_uploads', 'source', "TEXT NOT NULL DEFAULT 'CANSAT'");
db.exec(`CREATE INDEX IF NOT EXISTS idx_packets_upload_id ON packets(upload_id);`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_packets_source_hash_unique ON packets(source, packet_hash) WHERE packet_hash IS NOT NULL;`);

const statements = {
  insertPacket: db.prepare(`
    INSERT INTO packets (source, protocol_version, mission_mode_id, mission_mode, pkt_id, timestamp_ms, altitude_m, temp_c, temp_c_1, temp_c_2, temp_c_3, temp_c_4, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, raw, packet_hash, received_at, upload_id)
    VALUES (@source, @protocol_version, @mission_mode_id, @mission_mode, @pkt_id, @timestamp_ms, @altitude_m, @temp_c, @temp_c_1, @temp_c_2, @temp_c_3, @temp_c_4, @pressure_hpa, @accel_z, @gyro_x, @lat, @lon, @rssi_dbm, @flags, @raw, @packet_hash, @received_at, @upload_id)
  `),
  insertEvent: db.prepare(`
    INSERT INTO mission_events (source, event_type, altitude_m, timestamp_ms, received_at)
    VALUES (@source, @event_type, @altitude_m, @timestamp_ms, @received_at)
  `),
  insertUpload: db.prepare(`
    INSERT INTO sd_uploads (source, filename, rows_inserted, uploaded_at)
    VALUES (@source, @filename, @rows_inserted, @uploaded_at)
  `),
  updateUploadRowsInserted: db.prepare(`
    UPDATE sd_uploads
    SET rows_inserted = ?
    WHERE id = ?
  `),
  getRecentPackets: db.prepare(`
    SELECT * FROM packets
    WHERE source = ? AND (? = 0 OR received_at > ?)
    ORDER BY received_at DESC, timestamp_ms DESC, pkt_id DESC, id DESC
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
    ORDER BY received_at DESC, timestamp_ms DESC, pkt_id DESC, id DESC
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
    SELECT id, source, protocol_version, mission_mode_id, mission_mode, pkt_id, timestamp_ms, altitude_m, temp_c, temp_c_1, temp_c_2, temp_c_3, temp_c_4, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, received_at
    FROM packets
    WHERE (? = 'ALL' OR source = ?)
    ORDER BY received_at ASC
  `)
};

const insertPacketTx = db.transaction((packets) => {
  let changes = 0;
  let skippedDuplicates = 0;
  for (const packet of packets) {
    try {
      const result = statements.insertPacket.run(packet);
      changes += result.changes || 0;
    } catch (error) {
      if (isDuplicatePacketError(error)) {
        skippedDuplicates++;
        continue;
      }
      throw error;
    }
  }
  return { changes, skipped_duplicates: skippedDuplicates };
});

function runOrThrow(operation, fn) {
  try {
    return fn();
  } catch (error) {
    error.message = `[DB] ${operation} failed: ${error.message}`;
    throw error;
  }
}

function sourceWhereClause(source, column = 'source') {
  const aliases = sourceAliases(source);
  return {
    aliases,
    clause: aliases.map(() => `${column} = ?`).join(' OR ')
  };
}

function computePacketHash(packet) {
  if (!packet || !packet.source) return null;
  const identity = [
    packet.source,
    packet.protocol_version ?? '',
    packet.pkt_id ?? '',
    packet.timestamp_ms ?? '',
    packet.raw ?? ''
  ].join('\x1f');
  return createHash('sha256').update(identity).digest('hex');
}

function isDuplicatePacketError(error) {
  return error && (
    error.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (error.code === 'SQLITE_CONSTRAINT' && /idx_packets_source_hash_unique|UNIQUE constraint failed: packets\.source, packets\.packet_hash/.test(error.message || ''))
  );
}

function toPacketRow(packet) {
  return {
    source: packet.source,
    protocol_version: packet.protocol_version ?? null,
    mission_mode_id: packet.mission_mode_id ?? null,
    mission_mode: packet.mission_mode ?? null,
    pkt_id: packet.pkt_id,
    timestamp_ms: packet.timestamp_ms,
    altitude_m: packet.altitude_m,
    temp_c: packet.temp_c,
    temp_c_1: packet.temp_c_1 ?? null,
    temp_c_2: packet.temp_c_2 ?? null,
    temp_c_3: packet.temp_c_3 ?? null,
    temp_c_4: packet.temp_c_4 ?? null,
    pressure_hpa: packet.pressure_hpa,
    accel_z: packet.accel_z,
    gyro_x: packet.gyro_x,
    lat: packet.lat,
    lon: packet.lon,
    rssi_dbm: packet.rssi_dbm,
    flags: packet.flags,
    raw: packet.raw,
    packet_hash: packet.packet_hash ?? computePacketHash(packet),
    received_at: packet.received_at,
    upload_id: packet.upload_id ?? null
  };
}

function insertPacket(packet) {
  return runOrThrow('insertPacket', () => {
    try {
      const result = statements.insertPacket.run(toPacketRow(packet));
      return { changes: result.changes || 0, duplicate: false };
    } catch (error) {
      if (isDuplicatePacketError(error)) return { changes: 0, duplicate: true };
      throw error;
    }
  });
}

function insertPacketsBulk(packets) {
  if (!Array.isArray(packets)) {
    throw new TypeError('[DB] insertPacketsBulk requires an array of packets');
  }
  if (packets.length === 0) {
    return { changes: 0, skipped_duplicates: 0 };
  }
  return runOrThrow('insertPacketsBulk', () => {
    return insertPacketTx(packets.map(toPacketRow));
  });
}

function insertEvent(event) {
  return runOrThrow('insertEvent', () => statements.insertEvent.run(event));
}

function insertUpload(upload) {
  return runOrThrow('insertUpload', () => statements.insertUpload.run(upload));
}

function updateUploadRowsInserted(id, rowsInserted) {
  return runOrThrow('updateUploadRowsInserted', () => statements.updateUploadRowsInserted.run(rowsInserted, id));
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
    const { aliases, clause } = sourceWhereClause(source);
    const rows = db.prepare(`
      SELECT * FROM packets
      WHERE (${clause}) AND (? = 0 OR received_at > ?)
      ORDER BY received_at DESC, timestamp_ms DESC, pkt_id DESC, id DESC
      LIMIT ?
    `).all(...aliases, sinceTs, sinceTs, boundedLimit);
    return rows.reverse();
  });
}

function getStats(source) {
  return runOrThrow('getStats', () => {
    const { aliases, clause } = sourceWhereClause(source);
    return db.prepare(`
      SELECT
        COUNT(*) as count,
        MAX(altitude_m) as max_alt_m,
        MIN(temp_c) as min_temp_c,
        MIN(received_at) as first_packet_at,
        MAX(received_at) as last_packet_at
      FROM packets WHERE ${clause}
    `).get(...aliases) || {
      count: 0,
      max_alt_m: null,
      min_temp_c: null,
      first_packet_at: null,
      last_packet_at: null
    };
  });
}

function getLatest(source) {
  return runOrThrow('getLatest', () => {
    const { aliases, clause } = sourceWhereClause(source);
    return db.prepare(`
      SELECT * FROM packets
      WHERE ${clause}
      ORDER BY received_at DESC, timestamp_ms DESC, pkt_id DESC, id DESC
      LIMIT 1
    `).get(...aliases) || null;
  });
}

function getAllEvents() {
  return runOrThrow('getAllEvents', () => statements.getEvents.all());
}

function clearEvents(source = 'ALL') {
  return runOrThrow('clearEvents', () => {
    if (source === 'ALL') return statements.deleteEvents.run(source, source);
    const { aliases, clause } = sourceWhereClause(source);
    return db.prepare(`DELETE FROM mission_events WHERE ${clause}`).run(...aliases);
  });
}

function exportCsv(source) {
  return runOrThrow('exportCsv', () => {
    if (source === 'ALL') return statements.exportPackets.all(source, source);
    const { aliases, clause } = sourceWhereClause(source);
    return db.prepare(`
      SELECT id, source, protocol_version, mission_mode_id, mission_mode, pkt_id, timestamp_ms, altitude_m, temp_c, temp_c_1, temp_c_2, temp_c_3, temp_c_4, pressure_hpa, accel_z, gyro_x, lat, lon, rssi_dbm, flags, received_at
      FROM packets
      WHERE ${clause}
      ORDER BY received_at ASC
    `).all(...aliases);
  });
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
  updateUploadRowsInserted,
  getUpload,
  getUploadPackets,
  getHistory,
  getLatest,
  getStats,
  getAllEvents,
  clearEvents,
  exportCsv,
  close,
  MAX_HISTORY_LIMIT,
  computePacketHash
};
