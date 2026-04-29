const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCansat, parseNrc } = require('../parser');

function makeValidCansatPacket() {
  const buffer = Buffer.alloc(37);
  buffer.writeUInt16LE(42, 0);
  buffer.writeUInt32LE(123456, 2);
  buffer.writeFloatLE(125.5, 6);
  buffer.writeFloatLE(21.2, 10);
  buffer.writeFloatLE(1008.4, 14);
  buffer.writeFloatLE(0.8, 18);
  buffer.writeFloatLE(-0.3, 22);
  buffer.writeFloatLE(25.201, 26);
  buffer.writeFloatLE(55.271, 30);
  buffer.writeInt8(-70, 34);
  buffer.writeUInt8(0x03, 35);

  let checksum = 0;
  for (let i = 0; i < 36; i++) checksum ^= buffer[i];
  buffer.writeUInt8(checksum, 36);
  return buffer;
}

test('parseCansat parses valid binary packet', () => {
  const parsed = parseCansat(makeValidCansatPacket());
  assert.ok(parsed);
  assert.equal(parsed.source, 'CANSAT');
  assert.equal(parsed.pkt_id, 42);
  assert.equal(parsed.timestamp_ms, 123456);
  assert.equal(parsed.flags, 0x03);
});

test('parseCansat rejects invalid checksum', () => {
  const corrupted = makeValidCansatPacket();
  corrupted.writeUInt8(corrupted[36] ^ 0xff, 36);
  const parsed = parseCansat(corrupted);
  assert.equal(parsed, null);
});

test('parseNrc parses valid line', () => {
  const line = 'NRC:7,7000,101.2,22.5,1006.1,25.10,55.19,-64\n';
  const parsed = parseNrc(line);
  assert.ok(parsed);
  assert.equal(parsed.source, 'NRC');
  assert.equal(parsed.pkt_id, 7);
  assert.equal(parsed.timestamp_ms, 7000);
  assert.equal(parsed.flags, 0);
});

test('parseNrc rejects malformed line', () => {
  const parsed = parseNrc('NRC:7,7000,broken\n');
  assert.equal(parsed, null);
});
