const { Transform } = require('stream');
const {
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_SYNC
} = require('./cansat-hardware');
const { parseCansat } = require('./parser');

class CansatFrameParser extends Transform {
  constructor(options = {}) {
    super({ readableObjectMode: false });
    this.buffer = Buffer.alloc(0);
    this.maxBufferBytes = options.maxBufferBytes || 4096;
    this.stats = {
      frames: 0,
      resyncs: 0,
      dropped_bytes: 0,
      rejected_windows: 0,
      max_buffer_bytes: 0
    };
  }

  _transform(chunk, encoding, callback) {
    try {
      if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk, encoding);
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.stats.max_buffer_bytes = Math.max(this.stats.max_buffer_bytes, this.buffer.length);
      this.drainFrames();
      callback();
    } catch (error) {
      callback(error);
    }
  }

  drainFrames() {
    const minFrameBytes = Math.min(PACKET_LENGTH_BYTES, LEGACY_PACKET_LENGTH_BYTES);
    while (this.buffer.length >= minFrameBytes) {
      const frameOffset = this.findNextFrameOffset();

      if (frameOffset < 0) {
        const keep = PACKET_LENGTH_BYTES - 1;
        const drop = Math.max(0, this.buffer.length - keep);
        if (drop > 0) this.dropBytes(drop);
        return;
      }

      if (frameOffset > 0) {
        this.stats.resyncs++;
        this.dropBytes(frameOffset);
      }

      const frameLength = this.detectFrameLengthAtStart();
      if (frameLength === 0) return;

      const frame = this.buffer.subarray(0, frameLength);
      this.buffer = this.buffer.subarray(frameLength);
      this.stats.frames++;
      this.push(frame);
    }

    if (this.buffer.length > this.maxBufferBytes) {
      this.dropBytes(this.buffer.length - (PACKET_LENGTH_BYTES - 1));
    }
  }

  findNextFrameOffset() {
    const maxStart = this.buffer.length - Math.min(PACKET_LENGTH_BYTES, LEGACY_PACKET_LENGTH_BYTES);
    for (let offset = 0; offset <= maxStart; offset++) {
      const v2Candidate = this.buffer.subarray(offset, offset + PACKET_LENGTH_BYTES);
      if (v2Candidate.length === PACKET_LENGTH_BYTES && parseCansat(v2Candidate)) return offset;

      const legacyCandidate = this.buffer.subarray(offset, offset + LEGACY_PACKET_LENGTH_BYTES);
      if (
        legacyCandidate.length === LEGACY_PACKET_LENGTH_BYTES &&
        this.buffer.readUInt16LE(offset) !== PACKET_SYNC &&
        parseCansat(legacyCandidate)
      ) {
        return offset;
      }
      this.stats.rejected_windows++;
    }
    return -1;
  }

  detectFrameLengthAtStart() {
    if (this.buffer.length >= PACKET_LENGTH_BYTES) {
      const candidate = this.buffer.subarray(0, PACKET_LENGTH_BYTES);
      if (parseCansat(candidate)) return PACKET_LENGTH_BYTES;
    }
    if (this.buffer.length >= LEGACY_PACKET_LENGTH_BYTES) {
      const candidate = this.buffer.subarray(0, LEGACY_PACKET_LENGTH_BYTES);
      if (this.buffer.readUInt16LE(0) !== PACKET_SYNC && parseCansat(candidate)) {
        return LEGACY_PACKET_LENGTH_BYTES;
      }
    }
    return 0;
  }

  dropBytes(count) {
    this.stats.dropped_bytes += count;
    this.buffer = this.buffer.subarray(count);
  }

  getStats() {
    return {
      ...this.stats,
      buffered_bytes: this.buffer.length
    };
  }
}

module.exports = { CansatFrameParser };
