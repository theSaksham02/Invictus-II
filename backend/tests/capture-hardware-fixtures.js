#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { CansatFrameParser } = require('../cansat-framer');

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const source = arg('source').toUpperCase();
const portPath = arg('port');
const outPath = arg('out');
const baudRate = Number.parseInt(arg('baud', '115200'), 10);
const maxPackets = Number.parseInt(arg('count', '20'), 10);

if (!['NRC', 'CANSAT'].includes(source) || !portPath || !outPath) {
  console.error('Usage: node tests/capture-hardware-fixtures.js --source NRC|CANSAT --port /dev/cu.usb... --out tests/fixtures/hardware/name.nrc|name.cansat.hex [--baud 115200] [--count 20]');
  process.exit(2);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const stream = fs.createWriteStream(outPath, { flags: 'a' });
const port = new SerialPort({ path: portPath, baudRate });
let captured = 0;

function record(line) {
  stream.write(`${line}\n`);
  captured++;
  console.log(`[capture] ${captured}/${maxPackets} ${line}`);
  if (captured >= maxPackets) {
    port.close(() => {
      stream.end();
      process.exit(0);
    });
  }
}

if (source === 'NRC') {
  port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (line) => {
    const trimmed = String(line).trim();
    if (trimmed.startsWith('NRC:') || trimmed.startsWith('NRC2:')) record(trimmed);
  });
} else {
  port.pipe(new CansatFrameParser()).on('data', (frame) => record(frame.toString('hex')));
}

port.on('error', (error) => {
  console.error(`[capture] serial error: ${error.message}`);
  process.exit(1);
});
