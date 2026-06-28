const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCansat, parseNrc, parseRideshare, parseMachX } = require('../parser');
const {
  CANSAT_MISSION_MODES,
  PACKET_SYNC,
  PACKET_V2_LENGTH_BYTES,
  PACKET_V3_LENGTH_BYTES,
  crc16Ccitt
} = require('../cansat-hardware');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'hardware');
const SKIP_REASON = 'No real PCB hardware parser fixtures captured yet. Run tests/capture-hardware-fixtures.js with connected PCBs.';
const REQUIRE_HARDWARE_FIXTURES = process.env.REQUIRE_HARDWARE_FIXTURES === 'true';

function buildCansatV2(overrides = {}) {
  const values = {
    pkt_id: 10,
    timestamp_ms: 123456,
    altitude_m: 125.5,
    temp_c: 22.25,
    pressure_hpa: 1001.5,
    accel_z: 1.05,
    gyro_x: 0.25,
    lat: 25.2048,
    lon: 55.2708,
    rssi_dbm: -84,
    flags: 0x08 | 0x10 | 0x20,
    ...overrides
  };
  const buf = Buffer.alloc(PACKET_V2_LENGTH_BYTES);
  buf.writeUInt16LE(PACKET_SYNC, 0);
  buf.writeUInt8(2, 2);
  buf.writeUInt8(1, 3);
  buf.writeUInt8(36, 4);
  buf.writeUInt16LE(values.pkt_id, 5);
  buf.writeUInt32LE(values.timestamp_ms, 7);
  buf.writeFloatLE(values.altitude_m, 11);
  buf.writeFloatLE(values.temp_c, 15);
  buf.writeFloatLE(values.pressure_hpa, 19);
  buf.writeFloatLE(values.accel_z, 23);
  buf.writeFloatLE(values.gyro_x, 27);
  buf.writeFloatLE(values.lat, 31);
  buf.writeFloatLE(values.lon, 35);
  buf.writeInt8(values.rssi_dbm, 39);
  buf.writeUInt8(values.flags, 40);
  buf.writeUInt16LE(crc16Ccitt(buf, PACKET_V2_LENGTH_BYTES - 2), PACKET_V2_LENGTH_BYTES - 2);
  return buf;
}

function buildCansatV3(overrides = {}) {
  const values = {
    pkt_id: 20,
    timestamp_ms: 223456,
    mode: CANSAT_MISSION_MODES.DEPLOYED_SCIENCE,
    altitude_m: 78.25,
    temp_c: 21.5,
    pressure_hpa: 1005.25,
    temp_c_1: 20.75,
    temp_c_2: 20.875,
    temp_c_3: 21.0,
    temp_c_4: 21.125,
    accel_z: 0.98,
    gyro_x: -0.5,
    lat: 0,
    lon: 0,
    rssi_dbm: -91,
    flags: 0x01 | 0x02 | 0x08 | 0x10 | 0x20,
    ...overrides
  };
  const buf = Buffer.alloc(PACKET_V3_LENGTH_BYTES);
  buf.writeUInt16LE(PACKET_SYNC, 0);
  buf.writeUInt8(3, 2);
  buf.writeUInt8(1, 3);
  buf.writeUInt8(53, 4);
  buf.writeUInt16LE(values.pkt_id, 5);
  buf.writeUInt32LE(values.timestamp_ms, 7);
  buf.writeUInt8(values.mode, 11);
  buf.writeFloatLE(values.altitude_m, 12);
  buf.writeFloatLE(values.temp_c, 16);
  buf.writeFloatLE(values.pressure_hpa, 20);
  buf.writeFloatLE(values.temp_c_1, 24);
  buf.writeFloatLE(values.temp_c_2, 28);
  buf.writeFloatLE(values.temp_c_3, 32);
  buf.writeFloatLE(values.temp_c_4, 36);
  buf.writeFloatLE(values.accel_z, 40);
  buf.writeFloatLE(values.gyro_x, 44);
  buf.writeFloatLE(values.lat, 48);
  buf.writeFloatLE(values.lon, 52);
  buf.writeInt8(values.rssi_dbm, 56);
  buf.writeUInt8(values.flags, 57);
  buf.writeUInt16LE(crc16Ccitt(buf, PACKET_V3_LENGTH_BYTES - 2), PACKET_V3_LENGTH_BYTES - 2);
  return buf;
}

function readFixtureLines(extension) {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs.readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(extension))
    .flatMap((file) => {
      const content = fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8');
      return content.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
    });
}

function readFixtureLinesForExtensions(extensions) {
  return extensions.flatMap((extension) => readFixtureLines(extension));
}

function requireOrSkipFixture(t, lines, sourceLabel) {
  if (lines.length === 0) {
    if (REQUIRE_HARDWARE_FIXTURES) {
      assert.fail(`${sourceLabel} hardware fixture is required. ${SKIP_REASON}`);
    }
    t.skip(SKIP_REASON);
    return false;
  }
  return true;
}

test('parseRideshare accepts captured Mach-X Rideshare PCB telemetry lines', (t) => {
  const lines = readFixtureLinesForExtensions(['.mxr', '.nrc']);
  if (!requireOrSkipFixture(t, lines, 'Mach-X Rideshare')) return;

  for (const line of lines) {
    const parsed = parseRideshare(line);
    assert.ok(parsed, `failed to parse rideshare fixture: ${line}`);
    assert.equal(parsed.source, 'RIDESHARE');
    assert.equal(parsed.accel_z, null);
    assert.equal(parsed.gyro_x, null);
  }
});

test('parseRideshare validates MXR2 firmware-style CRC properly', () => {
  const body = '1,1000,12.50,20.00,1010.00,25.000000,55.000000,-80,40';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseRideshare(`MXR2:${body},${crcHex}`);

  assert.ok(parsed, 'parseRideshare should parse valid MXR2 telemetry');
  assert.equal(parsed.source, 'RIDESHARE');
  assert.equal(parsed.protocol_prefix, 'MXR2');
  assert.equal(parsed.pkt_id, 1);
  assert.equal(parsed.altitude_m, 12.5);
  assert.equal(parsed.accel_z, null);
  assert.equal(parsed.gyro_x, null);
});

test('parseRideshare validates MXR3 with LM75 temperature', () => {
  const body = '1,1000,12.50,20.00,19.75,1010.00,25.000000,55.000000,-80,40';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseRideshare(`MXR3:${body},${crcHex}`);

  assert.ok(parsed, 'parseRideshare should parse valid MXR3 telemetry');
  assert.equal(parsed.source, 'RIDESHARE');
  assert.equal(parsed.protocol_version, 3);
  assert.equal(parsed.protocol_prefix, 'MXR3');
  assert.equal(parsed.temp_c_1, 19.75);
  assert.equal(parsed.pressure_hpa, 1010);
  assert.equal(parsed.rssi_dbm, -80);
});

test('parseRideshare accepts firmware uint32 packet ids', () => {
  const body = '70000,70000000,12.50,20.00,19.75,1010.00,25.000000,55.000000,-80,40';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseRideshare(`MXR3:${body},${crcHex}`);

  assert.ok(parsed, 'parseRideshare should accept ESP32 uint32 pkt_id values beyond uint16');
  assert.equal(parsed.pkt_id, 70000);
});

test('parseRideshare maps missing MXR3 LM75 sentinel to null', () => {
  const body = '2,2000,13.50,20.50,-999.00,1009.00,25.000000,55.000000,-81,40';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseRideshare(`MXR3:${body},${crcHex}`);

  assert.ok(parsed, 'parseRideshare should parse MXR3 with missing LM75 sentinel');
  assert.equal(parsed.temp_c_1, null);
});

test('parseRideshare accepts stale BMP280 telemetry with last valid pressure and warnings', () => {
  const flags = 0x20 | 0x40;
  const body = `9,9000,12.50,20.00,19.75,1010.00,25.000000,55.000000,-80,${flags}`;
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseRideshare(`MXR3:${body},${crcHex}`);

  assert.ok(parsed, 'parseRideshare should keep degraded packets with valid fallback pressure');
  assert.equal(parsed.flags_decoded.bmp_ok, false);
  assert.equal(parsed.flags_decoded.stale_sensor, true);
  assert.equal(parsed.sensor_health.sd_card.degraded, true);
  assert.match(parsed.warnings.join('\n'), /stale BMP280 data/);
});

test('parseRideshare keeps NRC2 legacy prefix compatible', () => {
  const body = '1,1000,12.50,20.00,1010.00,25.000000,55.000000,-80,40';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const parsed = parseNrc(`NRC2:${body},${crcHex}`);

  assert.ok(parsed, 'parseNrc alias should parse legacy NRC2 telemetry');
  assert.equal(parsed.source, 'RIDESHARE');
  assert.equal(parsed.protocol_prefix, 'NRC2');
});

test('parseCansat accepts captured CanSat PCB frames', (t) => {
  const hexFrames = readFixtureLines('.cansat.hex');
  if (!requireOrSkipFixture(t, hexFrames, 'CanSat')) return;

  for (const hex of hexFrames) {
    const parsed = parseCansat(Buffer.from(hex, 'hex'));
    assert.ok(parsed, `failed to parse CanSat fixture: ${hex}`);
    assert.equal(parsed.source, 'CANSAT');
    assert.equal(Number.isFinite(parsed.accel_z), true);
    assert.equal(Number.isFinite(parsed.gyro_x), true);
  }
});

test('parseCansat accepts generated v2 CANSAT telemetry frames', () => {
  const parsed = parseCansat(buildCansatV2());

  assert.ok(parsed);
  assert.equal(parsed.source, 'CANSAT');
  assert.equal(parsed.protocol_version, 2);
  assert.equal(parsed.mission_mode, 'PRE_DEPLOY');
  assert.equal(parsed.flags_decoded.bmp_ok, true);
  assert.equal(parsed.flags_decoded.gps_recovery, false);
});

test('parseCansat accepts v3 deployed science with four LM75 temperatures', () => {
  const parsed = parseCansat(buildCansatV3());

  assert.ok(parsed);
  assert.equal(parsed.source, 'CANSAT');
  assert.equal(parsed.protocol_version, 3);
  assert.equal(parsed.mission_mode, 'DEPLOYED_SCIENCE');
  assert.equal(parsed.temp_c_1, 20.75);
  assert.equal(parsed.temp_c_4, 21.125);
  assert.equal(parsed.sensor_health.lm75.ok, true);
  assert.equal(parsed.flags_decoded.gps_recovery, false);
  assert.equal(parsed.sensor_health.neo6m.suppressed, true);
});

test('parseCansat accepts v3 GPS recovery and marks non-GPS sensors quiet', () => {
  const parsed = parseCansat(buildCansatV3({
    mode: CANSAT_MISSION_MODES.GPS_RECOVERY,
    altitude_m: 19.5,
    lat: 25.2048,
    lon: 55.2708,
    flags: 0x01 | 0x02 | 0x04 | 0x80
  }));

  assert.ok(parsed);
  assert.equal(parsed.mission_mode, 'GPS_RECOVERY');
  assert.equal(parsed.flags_decoded.gps_recovery, true);
  assert.equal(parsed.sensor_health.bmp388.quiet, true);
  assert.equal(parsed.sensor_health.lm75.quiet, true);
  assert.equal(parsed.sensor_health.sd_card.quiet, true);
  assert.equal(parsed.sensor_health.neo6m.ok, true);
});

test('parseCansat rejects v3 bad CRC, bad length, and out-of-range telemetry', () => {
  const badCrc = buildCansatV3();
  badCrc[20] ^= 0xff;
  assert.equal(parseCansat(badCrc), null);

  assert.equal(parseCansat(buildCansatV3().subarray(0, PACKET_V3_LENGTH_BYTES - 1)), null);

  const badAltitude = buildCansatV3({ altitude_m: 999999 });
  assert.equal(parseCansat(badAltitude), null);

  const badMode = buildCansatV3({ mode: 99 });
  assert.equal(parseCansat(badMode), null);
});
test('parseMachX validates firmware-style CRC properly', () => {
  const body = "1,2000,15.50,1013.25,25.00,26.00,26.10,25.90,26.20,9.81,0.01,45.000000,-120.000000,-85,1";
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const packet = `MACHX2:${body},${crcHex}\n`;

  const parsed = parseMachX(packet);
  assert.ok(parsed, 'parseMachX should successfully parse valid payload');
  assert.equal(parsed.source, 'MACHX');
  assert.equal(parsed.pkt_id, 1);
  assert.equal(parsed.altitude_m, 15.5);
  assert.equal(parsed.temp_c_1, 26.0);
  assert.equal(parsed.temp_c_4, 26.2);
  assert.equal(parsed.rssi_dbm, -85);
  assert.equal(parsed.flags, 1);
});

test('parseMachX rejects packets with malformed comma counts', () => {
  // 14 commas instead of 15
  const malformedBody = "1,2000,15.50,1013.25,25.00,26.00,26.10,25.90,26.20,9.81,0.01,45.000000,-120.000000,-85";
  const crcHex = crc16Ccitt(Buffer.from(malformedBody, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  const packet = `MACHX2:${malformedBody},${crcHex}\n`;

  const parsed = parseMachX(packet);
  assert.equal(parsed, null, 'should reject payload with incorrect number of commas');
});

test('parseMachX rejects packets with bad CRC', () => {
  const body = "1,2000,15.50,1013.25,25.00,26.00,26.10,25.90,26.20,9.81,0.01,45.000000,-120.000000,-85,1";
  const packet = `MACHX2:${body},0000\n`; // Wrong CRC

  const parsed = parseMachX(packet);
  assert.equal(parsed, null, 'should reject payload with wrong CRC');
});

test('parseMachX rejects non-MACHX lines', () => {
  const packet = "SOMERANDOMPREFIX:1,2,3,4,5\n";
  const parsed = parseMachX(packet);
  assert.equal(parsed, null, 'should reject non-MACHX prefix line');
});

test('parseMachX rejects truncated lines', () => {
  const packet = "MACHX2:1,2000,15.50\n";
  const parsed = parseMachX(packet);
  assert.equal(parsed, null, 'should reject truncated/incomplete line');
});

test('parseRideshare rejects malformed CRC and physically impossible values', () => {
  const validBody = '1,1000,12.50,20.00,1010.00,25.000000,55.000000,-80,40';
  assert.equal(parseRideshare(`MXR2:${validBody},ZZZZ`), null);

  const badAltitudeBody = '2,2000,999999.00,20.00,1010.00,25.000000,55.000000,-80,40';
  const crcHex = crc16Ccitt(Buffer.from(badAltitudeBody, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseRideshare(`MXR2:${badAltitudeBody},${crcHex}`), null);

  const badLm75Body = '3,3000,10.00,20.00,9999.00,1010.00,25.000000,55.000000,-80,40';
  const badLm75Crc = crc16Ccitt(Buffer.from(badLm75Body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseRideshare(`MXR3:${badLm75Body},${badLm75Crc}`), null);

  const missingMxr3FieldBody = '4,4000,10.00,20.00,19.00,1010.00,25.000000,55.000000,-80';
  const missingMxr3FieldCrc = crc16Ccitt(Buffer.from(missingMxr3FieldBody, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseRideshare(`MXR3:${missingMxr3FieldBody},${missingMxr3FieldCrc}`), null);
});

test('parseRideshare rejects partial and fractional integer fields even with valid CRC', () => {
  const fractionalIdBody = '1.5,1000,12.50,20.00,19.75,1010.00,25.000000,55.000000,-80,40';
  const fractionalIdCrc = crc16Ccitt(Buffer.from(fractionalIdBody, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseRideshare(`MXR3:${fractionalIdBody},${fractionalIdCrc}`), null);

  const trailingTextBody = '1,1000ms,12.50,20.00,19.75,1010.00,25.000000,55.000000,-80,40';
  const trailingTextCrc = crc16Ccitt(Buffer.from(trailingTextBody, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseRideshare(`MXR3:${trailingTextBody},${trailingTextCrc}`), null);
});

test('parseMachX rejects non-finite and out-of-range values even with valid CRC', () => {
  const body = '1,2000,15.50,1013.25,25.00,26.00,26.10,25.90,26.20,Infinity,0.01,45.000000,-120.000000,-85,1';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseMachX(`MACHX2:${body},${crcHex}`), null);
});

test('parseMachX rejects fractional integer fields even with valid CRC', () => {
  const body = '1,2000,15.50,1013.25,25.00,26.00,26.10,25.90,26.20,9.81,0.01,45.000000,-120.000000,-85.5,1';
  const crcHex = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).padStart(4, '0').toUpperCase();
  assert.equal(parseMachX(`MACHX2:${body},${crcHex}`), null);
});
