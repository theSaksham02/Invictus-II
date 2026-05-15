const {
  CANSAT_SOURCE_ID,
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_VERSION,
  TELEMETRY_LIMITS,
  crc16Ccitt,
  decodeFlags,
  deriveSensorHealth,
  packetWarnings,
  xorChecksum
} = require('./cansat-hardware');

// CANSAT: 37 bytes struct
// uint16 pkt_id, uint32 timestamp_ms, float alt, temp, pres, accelz, gyrox, lat, lon, int8 rssi, uint8 flags, uint8 checksum

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

function isValidTelemetryShape(packet) {
  const limits = TELEMETRY_LIMITS;
  return (
    Number.isInteger(packet.pkt_id) &&
    inRange(packet.pkt_id, limits.pkt_id.min, limits.pkt_id.max) &&
    Number.isInteger(packet.timestamp_ms) &&
    inRange(packet.timestamp_ms, limits.timestamp_ms.min, limits.timestamp_ms.max) &&
    isFiniteNumber(packet.altitude_m) &&
    inRange(packet.altitude_m, limits.altitude_m.min, limits.altitude_m.max) &&
    isFiniteNumber(packet.temp_c) &&
    inRange(packet.temp_c, limits.temp_c.min, limits.temp_c.max) &&
    isFiniteNumber(packet.pressure_hpa) &&
    inRange(packet.pressure_hpa, limits.pressure_hpa.min, limits.pressure_hpa.max) &&
    isFiniteNumber(packet.accel_z) &&
    inRange(packet.accel_z, limits.accel_z.min, limits.accel_z.max) &&
    isFiniteNumber(packet.gyro_x) &&
    inRange(packet.gyro_x, limits.gyro_x.min, limits.gyro_x.max) &&
    isFiniteNumber(packet.lat) &&
    isFiniteNumber(packet.lon) &&
    inRange(packet.lat, limits.lat.min, limits.lat.max) &&
    inRange(packet.lon, limits.lon.min, limits.lon.max) &&
    Number.isInteger(packet.rssi_dbm) &&
    inRange(packet.rssi_dbm, limits.rssi_dbm.min, limits.rssi_dbm.max) &&
    Number.isInteger(packet.flags) &&
    inRange(packet.flags, limits.flags.min, limits.flags.max)
  );
}

function enrichPacket(packet) {
  const flags_decoded = decodeFlags(packet.flags);
  return {
    ...packet,
    flags_decoded,
    sensor_health: deriveSensorHealth(packet),
    warnings: packetWarnings(packet)
  };
}

function buildCansatPacket(parsed) {
  return isValidTelemetryShape(parsed) ? enrichPacket(parsed) : null;
}

function parseLegacyCansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== LEGACY_PACKET_LENGTH_BYTES) return null;

  const xor = xorChecksum(buffer, LEGACY_PACKET_LENGTH_BYTES - 1);
  if (xor !== buffer[36]) return null;

  try {
    const parsed = {
      source: 'CANSAT',
      pkt_id: buffer.readUInt16LE(0),
      timestamp_ms: buffer.readUInt32LE(2),
      altitude_m: buffer.readFloatLE(6),
      temp_c: buffer.readFloatLE(10),
      pressure_hpa: buffer.readFloatLE(14),
      accel_z: buffer.readFloatLE(18),
      gyro_x: buffer.readFloatLE(22),
      lat: buffer.readFloatLE(26),
      lon: buffer.readFloatLE(30),
      rssi_dbm: buffer.readInt8(34),
      flags: buffer.readUInt8(35),
      raw: buffer.toString('hex'),
      received_at: Date.now()
    };
    return buildCansatPacket(parsed);
  } catch {
    return null;
  }
}

function parseV2Cansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== PACKET_LENGTH_BYTES) return null;
  if (buffer.readUInt16LE(0) !== PACKET_SYNC) return null;
  if (buffer.readUInt8(2) !== PACKET_VERSION) return null;
  if (buffer.readUInt8(3) !== CANSAT_SOURCE_ID) return null;
  if (buffer.readUInt8(4) !== PACKET_PAYLOAD_LENGTH_BYTES) return null;

  const expectedCrc = buffer.readUInt16LE(PACKET_LENGTH_BYTES - 2);
  const actualCrc = crc16Ccitt(buffer, PACKET_LENGTH_BYTES - 2);
  if (expectedCrc !== actualCrc) return null;

  try {
    const parsed = {
      source: 'CANSAT',
      protocol_version: PACKET_VERSION,
      pkt_id: buffer.readUInt16LE(5),
      timestamp_ms: buffer.readUInt32LE(7),
      altitude_m: buffer.readFloatLE(11),
      temp_c: buffer.readFloatLE(15),
      pressure_hpa: buffer.readFloatLE(19),
      accel_z: buffer.readFloatLE(23),
      gyro_x: buffer.readFloatLE(27),
      lat: buffer.readFloatLE(31),
      lon: buffer.readFloatLE(35),
      rssi_dbm: buffer.readInt8(39),
      flags: buffer.readUInt8(40),
      raw: buffer.toString('hex'),
      received_at: Date.now()
    };
    return buildCansatPacket(parsed);
  } catch {
    return null;
  }
}

function parseCansat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length === PACKET_LENGTH_BYTES) return parseV2Cansat(buffer);
  if (buffer.length === LEGACY_PACKET_LENGTH_BYTES) return parseLegacyCansat(buffer);
  return null;
}

function parseNrcNumberList(body) {
  return body.trim().split(',').map((value) => Number(value));
}

// NRC legacy: "NRC:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>\n"
// NRC v2: "NRC2:<same fields>,<flags>,<crc16_ccitt_hex>\n" where CRC covers the body before ",crc".
function parseNrc(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  const isV2 = trimmed.startsWith('NRC2:');
  if (!isV2 && !trimmed.startsWith('NRC:')) return null;

  const body = trimmed.substring(isV2 ? 5 : 4);
  let nums;
  if (isV2) {
    const lastComma = body.lastIndexOf(',');
    if (lastComma < 0) return null;
    const bodyWithoutCrc = body.slice(0, lastComma);
    const expectedCrc = Number.parseInt(body.slice(lastComma + 1), 16);
    if (!Number.isInteger(expectedCrc)) return null;
    const actualCrc = crc16Ccitt(Buffer.from(bodyWithoutCrc, 'utf8'));
    if (expectedCrc !== actualCrc) return null;
    nums = parseNrcNumberList(bodyWithoutCrc);
    if (nums.length !== 9) return null;
  } else {
    nums = parseNrcNumberList(body);
    if (nums.length !== 8) return null;
  }

  try {
    if (nums.some((value) => Number.isNaN(value))) return null;

    const parsed = {
      source: 'NRC',
      protocol_version: isV2 ? 2 : 1,
      pkt_id: Math.trunc(nums[0]),
      timestamp_ms: Math.trunc(nums[1]),
      altitude_m: nums[2],
      temp_c: nums[3],
      pressure_hpa: nums[4],
      accel_z: 0.0,
      gyro_x: 0.0,
      lat: nums[5],
      lon: nums[6],
      rssi_dbm: Math.trunc(nums[7]),
      flags: isV2 ? Math.trunc(nums[8]) : 0,
      raw: trimmed,
      received_at: Date.now()
    };
    return isValidTelemetryShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { isValidTelemetryShape, parseCansat, parseNrc };
