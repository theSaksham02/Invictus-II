const {
  PACKET_LENGTH_BYTES,
  TELEMETRY_LIMITS,
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

function parseCansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== PACKET_LENGTH_BYTES) return null;

  const xor = xorChecksum(buffer);
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
    return isValidTelemetryShape(parsed) ? enrichPacket(parsed) : null;
  } catch {
    return null;
  }
}

// NRC: "NRC:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>\n"
function parseNrc(line) {
  if (typeof line !== 'string' || !line.startsWith('NRC:')) return null;
  const parts = line.substring(4).trim().split(',');
  if (parts.length !== 8) return null;

  try {
    const nums = parts.map((value) => Number(value));
    if (nums.some((value) => Number.isNaN(value))) return null;

    const parsed = {
      source: 'NRC',
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
      flags: 0,
      raw: line.trim(),
      received_at: Date.now()
    };
    return isValidTelemetryShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { isValidTelemetryShape, parseCansat, parseNrc };
