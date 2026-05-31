const { SerialPortMock } = require('serialport');
const {
  CANSAT_SOURCE_ID,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_VERSION,
  crc16Ccitt
} = require('./cansat-hardware');

let interval;
let tick = 0;
let lat = 52.5;
let lon = -1.9;

function startEmulator() {
  if (interval) return;
  console.log("[HITL EMULATOR] 🚀 Hardware-in-the-loop byte-level emulator starting...");

  const cansatPath = process.env.SERIAL_PORT_CANSAT || '/dev/ttyUSB0';
  const nrcPath = process.env.SERIAL_PORT_NRC || '/dev/ttyUSB1';
  
  // Create virtual hardware ports
  try {
    SerialPortMock.binding.createPort(cansatPath, { echo: false, record: false });
  } catch (error) {
    if (!/exists|exist|already/i.test(error.message)) throw error;
  }
  if (cansatPath !== nrcPath) {
    try {
      SerialPortMock.binding.createPort(nrcPath, { echo: false, record: false });
    } catch (error) {
      if (!/exists|exist|already/i.test(error.message)) throw error;
    }
  }

  interval = setInterval(() => {
    tick++;
    let alt = 0, accel = 1.0;
    
    if (tick < 30) {
      alt = 0 + (Math.random()*0.4 - 0.2); // IDLE
    } else if (tick < 90) {
      alt = (tick - 30) * 10 + (Math.random()*4 - 2);
      accel = 2.0 + (Math.random()*0.1); // ASCENDING
    } else if (tick < 95) {
      alt = 600 + (tick - 90)*14 - 1.5*Math.pow(tick-90, 2);
      accel = 0.5 + (Math.random()*0.2); // APOGEE
    } else if (tick < 180) {
      alt = Math.max(0, 660 - (tick - 95)*7 + (Math.random()*4 - 2));
      accel = 0.3 + Math.random()*0.1; // DESCENDING
    } else {
      alt = 0 + (Math.random()*0.4 - 0.2); // LANDED
    }

    if (process.env.BENCH_ALT === 'true') {
      alt = alt / 150.0; // Scale 660m peak down to ~4.4m (14.4 feet)
    }


    // Simulated GPS Trajectory (Wind Drift)
    let windLat = 0;
    let windLon = 0;
    
    if (tick >= 30 && tick < 95) {
      // Ascending: Fast vertical, minimal lateral drift
      windLat = 0.00001;
      windLon = 0.00002;
    } else if (tick >= 95 && tick < 180) {
      // Descending: Under parachute, significant wind drift
      windLat = 0.00004;
      windLon = 0.00009;
    }
    
    // Apply smooth trajectory + micro-realistic NEO-6M sensor noise
    lat += windLat + (Math.random() * 0.000002 - 0.000001);
    lon += windLon + (Math.random() * 0.000002 - 0.000001);

    let flags = 0;
    if (tick >= 30) flags |= 0x01; // launched
    if (tick >= 90) flags |= 0x02; // apogee
    if (tick >= 10) flags |= 0x04; // gps fix (takes 10s to acquire)
    if (tick >= 2) flags |= 0x08; // bmp_ok
    if (tick >= 4) flags |= 0x10; // mpu_ok
    if (tick >= 6) flags |= 0x20; // sd_ok

    // ═══════════════════════════════════════════════════════════
    // 1. CANSAT BINARY INGESTION (v2 fixed frame, little-endian)
    // ═══════════════════════════════════════════════════════════
    const buf = Buffer.alloc(PACKET_LENGTH_BYTES);
    buf.writeUInt16LE(PACKET_SYNC, 0);
    buf.writeUInt8(PACKET_VERSION, 2);
    buf.writeUInt8(CANSAT_SOURCE_ID, 3);
    buf.writeUInt8(PACKET_PAYLOAD_LENGTH_BYTES, 4);
    buf.writeUInt16LE(tick, 5); // pkt_id
    buf.writeUInt32LE(tick * 1000, 7); // timestamp_ms
    buf.writeFloatLE(alt, 11); // altitude_m
    buf.writeFloatLE(20.0 - (alt * 0.0065) + (Math.random()*0.6-0.3), 15); // temp_c
    buf.writeFloatLE(1013.25 * Math.pow(1 - 2.25577e-5 * alt, 5.25588), 19); // pressure_hpa
    buf.writeFloatLE(accel, 23); // accel_z
    buf.writeFloatLE(Math.random() * 2 - 1, 27); // gyro_x
    buf.writeFloatLE(lat, 31); // lat
    buf.writeFloatLE(lon, 35); // lon
    buf.writeInt8(-60 - Math.floor(alt / 20), 39); // rssi_dbm
    buf.writeUInt8(flags, 40); // flags

    let crc = crc16Ccitt(buf, PACKET_LENGTH_BYTES - 2);
    
    // Simulate 5% CANSAT Packet Corruption (Intentionally break the checksum)
    if (Math.random() < 0.05) {
       console.log(`[HITL EMULATOR] ⚠️ Simulating CANSAT RF corruption on pkt ${tick}`);
       crc ^= 0xffff; // Flips bits so the backend parser rejects it
    }
    buf.writeUInt16LE(crc, PACKET_LENGTH_BYTES - 2);

    // Push the raw byte array directly into the virtual serial port
    if (global.mockCansat && global.mockCansat.isOpen && global.mockCansat.port) {
       global.mockCansat.port.emitData(buf);
    }

    // ═══════════════════════════════════════════════════════════
    // 2. NRC ASCII INGESTION
    // ═══════════════════════════════════════════════════════════
    let nrcFlags = 0;
    if (tick >= 30) nrcFlags |= 0x01; // FLAG_LAUNCHED
    if (tick >= 90) nrcFlags |= 0x02; // FLAG_APOGEE
    if (tick >= 10) nrcFlags |= 0x04; // FLAG_GPS_FIX
    if (tick >= 2)  nrcFlags |= 0x08; // FLAG_BARO_OK
    if (tick >= 6)  nrcFlags |= 0x20; // FLAG_SD_OK

    const nrcBody = `${tick},${tick*1000},${alt.toFixed(2)},${(20.0 - alt*0.0065).toFixed(2)},${(1013.25 * Math.pow(1 - 2.25577e-5 * alt, 5.25588)).toFixed(2)},${lat.toFixed(5)},${lon.toFixed(5)},${-60 - Math.floor(alt / 20)},${nrcFlags}`;
    const nrcCrc = crc16Ccitt(Buffer.from(nrcBody, 'utf8')).toString(16).toUpperCase().padStart(4, '0');
    const nrcStr = `NRC2:${nrcBody},${nrcCrc}\n`;
    
    // Simulate 5% NRC Packet Drop (Complete signal loss for 1 tick)
    if (Math.random() < 0.05) {
       console.log(`[HITL EMULATOR] ⚠️ Simulating NRC LoRa drop on pkt ${tick}`);
    } else {
       if (global.mockNrc && global.mockNrc.isOpen && global.mockNrc.port) {
          global.mockNrc.port.emitData(Buffer.from(nrcStr, 'utf-8'));
       }
    }

  }, 1000);
}

function stopEmulator() {
  if (interval) clearInterval(interval);
  interval = null;
}

module.exports = { startEmulator, stopEmulator };
