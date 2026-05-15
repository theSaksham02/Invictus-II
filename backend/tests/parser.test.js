const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCansat, parseNrc } = require('../parser');
const { CansatFrameParser } = require('../cansat-framer');
const {
  CANSAT_SOURCE_ID,
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_VERSION,
  crc16Ccitt
} = require('../cansat-hardware');

function makeValidLegacyCansatPacket() {
  const buffer = Buffer.alloc(LEGACY_PACKET_LENGTH_BYTES);
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

function makeValidCansatPacket() {
  const buffer = Buffer.alloc(PACKET_LENGTH_BYTES);
  buffer.writeUInt16LE(PACKET_SYNC, 0);
  buffer.writeUInt8(PACKET_VERSION, 2);
  buffer.writeUInt8(CANSAT_SOURCE_ID, 3);
  buffer.writeUInt8(PACKET_PAYLOAD_LENGTH_BYTES, 4);
  buffer.writeUInt16LE(42, 5);
  buffer.writeUInt32LE(123456, 7);
  buffer.writeFloatLE(125.5, 11);
  buffer.writeFloatLE(21.2, 15);
  buffer.writeFloatLE(1008.4, 19);
  buffer.writeFloatLE(0.8, 23);
  buffer.writeFloatLE(-0.3, 27);
  buffer.writeFloatLE(25.201, 31);
  buffer.writeFloatLE(55.271, 35);
  buffer.writeInt8(-70, 39);
  buffer.writeUInt8(0x03, 40);
  buffer.writeUInt16LE(crc16Ccitt(buffer, PACKET_LENGTH_BYTES - 2), PACKET_LENGTH_BYTES - 2);
  return buffer;
}

test('parseCansat parses valid binary packet', () => {
  const parsed = parseCansat(makeValidCansatPacket());
  assert.ok(parsed);
  assert.equal(parsed.source, 'CANSAT');
  assert.equal(parsed.protocol_version, 2);
  assert.equal(parsed.pkt_id, 42);
  assert.equal(parsed.timestamp_ms, 123456);
  assert.equal(parsed.flags, 0x03);
  assert.equal(parsed.flags_decoded.launched, true);
  assert.equal(parsed.sensor_health.rfm69hcw.ok, true);
});

test('parseCansat rejects invalid checksum', () => {
  const corrupted = makeValidCansatPacket();
  corrupted.writeUInt16LE(corrupted.readUInt16LE(PACKET_LENGTH_BYTES - 2) ^ 0xffff, PACKET_LENGTH_BYTES - 2);
  const parsed = parseCansat(corrupted);
  assert.equal(parsed, null);
});

test('parseCansat still accepts legacy XOR packet', () => {
  const parsed = parseCansat(makeValidLegacyCansatPacket());
  assert.ok(parsed);
  assert.equal(parsed.source, 'CANSAT');
  assert.equal(parsed.pkt_id, 42);
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

test('parseNrc parses v2 line with CRC and flags', () => {
  const body = '7,7000,101.2,22.5,1006.1,25.10,55.19,-64,12';
  const crc = crc16Ccitt(Buffer.from(body, 'utf8')).toString(16).toUpperCase().padStart(4, '0');
  const parsed = parseNrc(`NRC2:${body},${crc}\n`);
  assert.ok(parsed);
  assert.equal(parsed.source, 'NRC');
  assert.equal(parsed.protocol_version, 2);
  assert.equal(parsed.flags, 12);
});

test('parseNrc rejects malformed line', () => {
  const parsed = parseNrc('NRC:7,7000,broken\n');
  assert.equal(parsed, null);
});

test('CansatFrameParser resynchronizes after noise before a valid frame', async () => {
  const parser = new CansatFrameParser();
  const frames = [];
  parser.on('data', (frame) => frames.push(frame));

  parser.write(Buffer.from([0x99, 0x88, 0x77, 0x66]));
  parser.write(makeValidCansatPacket());
  parser.end();

  await new Promise((resolve) => parser.on('finish', resolve));
  assert.equal(frames.length, 1);
  assert.equal(parseCansat(frames[0]).pkt_id, 42);
  assert.equal(parser.getStats().resyncs, 1);
});
