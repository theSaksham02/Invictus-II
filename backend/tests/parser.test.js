const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCansat, parseNrc } = require('../parser');

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
