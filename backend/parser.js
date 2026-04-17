// CANSAT: 37 bytes struct
// uint16 pkt_id, uint32 timestamp_ms, float alt, temp, pres, accelz, gyrox, lat, lon, int8 rssi, uint8 flags, uint8 checksum

function parseCansat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== 37) return null;
  
  // Verify checksum (XOR of 0-35)
  let xor = 0;
  for (let i = 0; i < 36; i++) xor ^= buffer[i];
  if (xor !== buffer[36]) return null;

  try {
    return {
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
  } catch (e) {
    return null;
  }
}

// NRC: "NRC:<pkt_id>,<timestamp_ms>,<altitude_m>,<temp_c>,<pressure_hpa>,<lat>,<lon>,<rssi_dbm>\n"
function parseNrc(line) {
  if (typeof line !== 'string' || !line.startsWith('NRC:')) return null;
  const parts = line.substring(4).trim().split(',');
  if (parts.length !== 8) return null;
  
  try {
    const nums = parts.map(p => Number(p));
    if (nums.some(n => isNaN(n))) return null;
    
    return {
      source: 'NRC',
      pkt_id: nums[0],
      timestamp_ms: nums[1],
      altitude_m: nums[2],
      temp_c: nums[3],
      pressure_hpa: nums[4],
      accel_z: 0.0,
      gyro_x: 0.0,
      lat: nums[5],
      lon: nums[6],
      rssi_dbm: nums[7],
      flags: 0,
      raw: line.trim(),
      received_at: Date.now()
    };
  } catch (e) {
    return null;
  }
}

module.exports = { parseCansat, parseNrc };