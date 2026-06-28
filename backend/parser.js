const {
  CANSAT_SOURCE_ID,
  CANSAT_MISSION_MODE_NAMES,
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_V3_LENGTH_BYTES,
  PACKET_V3_PAYLOAD_LENGTH_BYTES,
  PACKET_V3_VERSION,
  PACKET_VERSION,
  TELEMETRY_LIMITS,
  crc16Ccitt,
  decodeFlags,
  deriveSensorHealth,
  packetIdLimitForSource,
  packetWarnings,
  xorChecksum
} = require('./cansat-hardware');
const { RIDESHARE_SOURCE, isRideshareSource } = require('./source-aliases');

// CANSAT primary frame: 60-byte v3 binary packet with 0xA55A sync and CRC16-CCITT.
// The 43-byte v2 frame and a 37-byte legacy XOR packet are still accepted for
// historical bench captures and older ground receiver firmware.

function isFiniteNumber(value) {
  return Number.isFinite(value);
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

function optionalInRange(value, min, max) {
  return value === null || value === undefined || (isFiniteNumber(value) && inRange(value, min, max));
}

function isValidTelemetryShape(packet) {
  const limits = TELEMETRY_LIMITS;
  const pktIdLimit = packetIdLimitForSource(packet.source);
  const hasMotion = isRideshareSource(packet.source)
    ? (packet.accel_z === null || isFiniteNumber(packet.accel_z)) &&
      (packet.gyro_x === null || isFiniteNumber(packet.gyro_x))
    : isFiniteNumber(packet.accel_z) &&
      isFiniteNumber(packet.gyro_x);
  return (
    Number.isInteger(packet.pkt_id) &&
    inRange(packet.pkt_id, pktIdLimit.min, pktIdLimit.max) &&
    Number.isInteger(packet.timestamp_ms) &&
    inRange(packet.timestamp_ms, limits.timestamp_ms.min, limits.timestamp_ms.max) &&
    isFiniteNumber(packet.altitude_m) &&
    inRange(packet.altitude_m, limits.altitude_m.min, limits.altitude_m.max) &&
    isFiniteNumber(packet.temp_c) &&
    inRange(packet.temp_c, limits.temp_c.min, limits.temp_c.max) &&
    optionalInRange(packet.temp_c_1, limits.temp_c_1.min, limits.temp_c_1.max) &&
    optionalInRange(packet.temp_c_2, limits.temp_c_2.min, limits.temp_c_2.max) &&
    optionalInRange(packet.temp_c_3, limits.temp_c_3.min, limits.temp_c_3.max) &&
    optionalInRange(packet.temp_c_4, limits.temp_c_4.min, limits.temp_c_4.max) &&
    isFiniteNumber(packet.pressure_hpa) &&
    inRange(packet.pressure_hpa, limits.pressure_hpa.min, limits.pressure_hpa.max) &&
    hasMotion &&
    (packet.accel_z === null || inRange(packet.accel_z, limits.accel_z.min, limits.accel_z.max)) &&
    (packet.gyro_x === null || inRange(packet.gyro_x, limits.gyro_x.min, limits.gyro_x.max)) &&
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

function missionModeName(mode) {
  return Object.prototype.hasOwnProperty.call(CANSAT_MISSION_MODE_NAMES, mode)
    ? CANSAT_MISSION_MODE_NAMES[mode]
    : null;
}

function parseLegacyCansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== LEGACY_PACKET_LENGTH_BYTES) return null;

  const xor = xorChecksum(buffer, LEGACY_PACKET_LENGTH_BYTES - 1);
  if (xor !== buffer[36]) return null;

  try {
    const parsed = {
      source: 'CANSAT',
      protocol_version: 1,
      protocol_prefix: 'CANSAT_LEGACY',
      mission_mode_id: 0,
      mission_mode: missionModeName(0),
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
      protocol_prefix: 'CANSAT2',
      mission_mode_id: 0,
      mission_mode: missionModeName(0),
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

function parseV3Cansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== PACKET_V3_LENGTH_BYTES) return null;
  if (buffer.readUInt16LE(0) !== PACKET_SYNC) return null;
  if (buffer.readUInt8(2) !== PACKET_V3_VERSION) return null;
  if (buffer.readUInt8(3) !== CANSAT_SOURCE_ID) return null;
  if (buffer.readUInt8(4) !== PACKET_V3_PAYLOAD_LENGTH_BYTES) return null;

  const expectedCrc = buffer.readUInt16LE(PACKET_V3_LENGTH_BYTES - 2);
  const actualCrc = crc16Ccitt(buffer, PACKET_V3_LENGTH_BYTES - 2);
  if (expectedCrc !== actualCrc) return null;

  try {
    const mode = buffer.readUInt8(11);
    const missionMode = missionModeName(mode);
    if (!missionMode) return null;
    const parsed = {
      source: 'CANSAT',
      protocol_version: PACKET_V3_VERSION,
      protocol_prefix: 'CANSAT3',
      mission_mode_id: mode,
      mission_mode: missionMode,
      pkt_id: buffer.readUInt16LE(5),
      timestamp_ms: buffer.readUInt32LE(7),
      altitude_m: buffer.readFloatLE(12),
      temp_c: buffer.readFloatLE(16),
      pressure_hpa: buffer.readFloatLE(20),
      temp_c_1: normalizeOptionalTemperature(buffer.readFloatLE(24)),
      temp_c_2: normalizeOptionalTemperature(buffer.readFloatLE(28)),
      temp_c_3: normalizeOptionalTemperature(buffer.readFloatLE(32)),
      temp_c_4: normalizeOptionalTemperature(buffer.readFloatLE(36)),
      accel_z: buffer.readFloatLE(40),
      gyro_x: buffer.readFloatLE(44),
      lat: buffer.readFloatLE(48),
      lon: buffer.readFloatLE(52),
      rssi_dbm: buffer.readInt8(56),
      flags: buffer.readUInt8(57),
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
  if (buffer.length === PACKET_V3_LENGTH_BYTES) return parseV3Cansat(buffer);
  if (buffer.length === PACKET_LENGTH_BYTES) return parseV2Cansat(buffer);
  if (buffer.length === LEGACY_PACKET_LENGTH_BYTES) return parseLegacyCansat(buffer);
  return null;
}

function parseTelemetryNumberList(body) {
  const fields = body.trim().split(',');
  if (fields.some((value) => value.trim() === '')) return null;
  const numericPattern = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
  if (fields.some((value) => !numericPattern.test(value.trim()))) return null;
  return fields.map((value) => Number(value));
}

function normalizeOptionalTemperature(value) {
  if (!Number.isFinite(value) || value <= -900) return null;
  return value;
}

function hasIntegerFields(nums, indexes) {
  return indexes.every((index) => Number.isInteger(nums[index]));
}

// Rideshare v2: "MXR2:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_ccitt_hex>\n".
// Rideshare v3: "MXR3:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<lm75_temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>,<flags>,<crc16_ccitt_hex>\n".
// Legacy NRC lines are still accepted: "NRC:<same without flags/crc>" and "NRC2:<same with flags/crc>".
function parseRideshare(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  const isMxrV3 = trimmed.startsWith('MXR3:');
  const isMxrV2 = trimmed.startsWith('MXR2:');
  const isLegacyNrcV2 = trimmed.startsWith('NRC2:');
  const isLegacyNrc = trimmed.startsWith('NRC:');
  const hasCrc = isMxrV3 || isMxrV2 || isLegacyNrcV2;
  if (!hasCrc && !isLegacyNrc) return null;

  const body = trimmed.substring(hasCrc ? 5 : 4);
  let nums;
  if (hasCrc) {
    const lastComma = body.lastIndexOf(',');
    if (lastComma < 0) return null;
    const bodyWithoutCrc = body.slice(0, lastComma);
    const crcField = body.slice(lastComma + 1).trim();
    if (!/^[0-9a-fA-F]{4}$/.test(crcField)) return null;
    const expectedCrc = Number.parseInt(crcField, 16);
    if (!Number.isInteger(expectedCrc)) return null;
    const actualCrc = crc16Ccitt(Buffer.from(bodyWithoutCrc, 'utf8'));
    if (expectedCrc !== actualCrc) return null;
    nums = parseTelemetryNumberList(bodyWithoutCrc);
    if (!nums || nums.length !== (isMxrV3 ? 10 : 9)) return null;
  } else {
    nums = parseTelemetryNumberList(body);
    if (!nums || nums.length !== 8) return null;
  }

  try {
    if (nums.some((value) => Number.isNaN(value))) return null;
    const integerFields = isMxrV3
      ? [0, 1, 8, 9]
      : hasCrc
        ? [0, 1, 7, 8]
        : [0, 1, 7];
    if (!hasIntegerFields(nums, integerFields)) return null;

    const parsed = {
      source: RIDESHARE_SOURCE,
      protocol_version: isMxrV3 ? 3 : hasCrc ? 2 : 1,
      protocol_prefix: isMxrV3 ? 'MXR3' : isMxrV2 ? 'MXR2' : isLegacyNrcV2 ? 'NRC2' : 'NRC',
      pkt_id: Math.trunc(nums[0]),
      timestamp_ms: Math.trunc(nums[1]),
      altitude_m: nums[2],
      temp_c: nums[3],
      temp_c_1: isMxrV3 ? normalizeOptionalTemperature(nums[4]) : null,
      pressure_hpa: isMxrV3 ? nums[5] : nums[4],
      accel_z: null,
      gyro_x: null,
      lat: isMxrV3 ? nums[6] : nums[5],
      lon: isMxrV3 ? nums[7] : nums[6],
      rssi_dbm: Math.trunc(isMxrV3 ? nums[8] : nums[7]),
      flags: hasCrc ? Math.trunc(isMxrV3 ? nums[9] : nums[8]) : 0,
      raw: trimmed,
      received_at: Date.now()
    };
    return isValidTelemetryShape(parsed) ? enrichPacket(parsed) : null;
  } catch {
    return null;
  }
}

const parseNrc = parseRideshare;

function parseMachX(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed.startsWith('MACHX2:')) return null;

  const body = trimmed.substring(7);
  const lastComma = body.lastIndexOf(',');
  if (lastComma < 0) return null;
  const bodyWithoutCrc = body.slice(0, lastComma);
  const crcField = body.slice(lastComma + 1).trim();
  if (!/^[0-9a-fA-F]{4}$/.test(crcField)) return null;
  const expectedCrc = Number.parseInt(crcField, 16);
  if (!Number.isInteger(expectedCrc)) return null;
  const actualCrc = crc16Ccitt(Buffer.from(bodyWithoutCrc, 'utf8'));
  if (expectedCrc !== actualCrc) return null;

  const nums = parseTelemetryNumberList(bodyWithoutCrc);
  if (!nums || nums.length !== 15) return null;

  try {
    if (nums.some((value) => Number.isNaN(value))) return null;
    if (!hasIntegerFields(nums, [0, 1, 13, 14])) return null;

    const parsed = {
      source: 'MACHX',
      protocol_version: 2,
      pkt_id: Math.trunc(nums[0]),
      timestamp_ms: Math.trunc(nums[1]),
      altitude_m: nums[2],
      pressure_hpa: nums[3],
      temp_c: nums[4],
      temp_c_1: nums[5],
      temp_c_2: nums[6],
      temp_c_3: nums[7],
      temp_c_4: nums[8],
      accel_z: nums[9],
      gyro_x: nums[10],
      lat: nums[11],
      lon: nums[12],
      rssi_dbm: Math.trunc(nums[13]),
      flags: Math.trunc(nums[14]),
      raw: trimmed,
      received_at: Date.now()
    };
    return isValidTelemetryShape(parsed) ? enrichPacket(parsed) : null;
  } catch {
    return null;
  }
}

module.exports = { isValidTelemetryShape, parseCansat, parseNrc, parseRideshare, parseMachX };
