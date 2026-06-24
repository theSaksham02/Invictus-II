const test = require('node:test');
const assert = require('node:assert/strict');
const { CansatFrameParser } = require('../cansat-framer');
const { PACKET_SYNC, PACKET_V3_LENGTH_BYTES, crc16Ccitt } = require('../cansat-hardware');

function buildV3Frame() {
  const buf = Buffer.alloc(PACKET_V3_LENGTH_BYTES);
  buf.writeUInt16LE(PACKET_SYNC, 0);
  buf.writeUInt8(3, 2);
  buf.writeUInt8(1, 3);
  buf.writeUInt8(53, 4);
  buf.writeUInt16LE(7, 5);
  buf.writeUInt32LE(7000, 7);
  buf.writeUInt8(1, 11);
  buf.writeFloatLE(44.5, 12);
  buf.writeFloatLE(22.5, 16);
  buf.writeFloatLE(1002.25, 20);
  buf.writeFloatLE(22.0, 24);
  buf.writeFloatLE(22.1, 28);
  buf.writeFloatLE(22.2, 32);
  buf.writeFloatLE(22.3, 36);
  buf.writeFloatLE(1.0, 40);
  buf.writeFloatLE(0.0, 44);
  buf.writeFloatLE(0.0, 48);
  buf.writeFloatLE(0.0, 52);
  buf.writeInt8(-90, 56);
  buf.writeUInt8(0x01 | 0x02 | 0x08 | 0x10 | 0x20, 57);
  buf.writeUInt16LE(crc16Ccitt(buf, PACKET_V3_LENGTH_BYTES - 2), PACKET_V3_LENGTH_BYTES - 2);
  return buf;
}

test('CansatFrameParser preserves split 60-byte v3 frames', async () => {
  const frame = buildV3Frame();
  const parser = new CansatFrameParser();
  const frames = [];
  parser.on('data', (chunk) => frames.push(Buffer.from(chunk)));

  parser.write(frame.subarray(0, 32));
  assert.equal(frames.length, 0);

  parser.write(frame.subarray(32));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, PACKET_V3_LENGTH_BYTES);
  assert.deepEqual(frames[0], frame);
});
