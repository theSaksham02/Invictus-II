const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCansat, parseNrc, parseMachX } = require('../parser');
const { crc16Ccitt } = require('../cansat-hardware');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'hardware');
const SKIP_REASON = 'No real PCB hardware parser fixtures captured yet. Run tests/capture-hardware-fixtures.js with connected PCBs.';

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

test('parseNrc accepts captured NRC PCB telemetry lines', (t) => {
  const lines = readFixtureLines('.nrc');
  if (lines.length === 0) {
    t.skip(SKIP_REASON);
    return;
  }

  for (const line of lines) {
    const parsed = parseNrc(line);
    assert.ok(parsed, `failed to parse NRC fixture: ${line}`);
    assert.equal(parsed.source, 'NRC');
    assert.equal(parsed.accel_z, null);
    assert.equal(parsed.gyro_x, null);
  }
});

test('parseCansat accepts captured CanSat PCB frames', (t) => {
  const hexFrames = readFixtureLines('.cansat.hex');
  if (hexFrames.length === 0) {
    t.skip(SKIP_REASON);
    return;
  }

  for (const hex of hexFrames) {
    const parsed = parseCansat(Buffer.from(hex, 'hex'));
    assert.ok(parsed, `failed to parse CanSat fixture: ${hex}`);
    assert.equal(parsed.source, 'CANSAT');
    assert.equal(Number.isFinite(parsed.accel_z), true);
    assert.equal(Number.isFinite(parsed.gyro_x), true);
  }
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
