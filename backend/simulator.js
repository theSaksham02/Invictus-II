const { processPacket } = require('./phase-tracker');
const { insertPacket } = require('./db');

let interval;
let tick = 0;
let lat = 52.5;
let lon = -1.9;

function startSimulation(emitFn) {
  console.log("[SIM MODE] Running simulated flight");
  
  interval = setInterval(() => {
    tick++;
    let alt = 0, accel = 1.0;
    
    if (tick < 30) {
      // IDLE
      alt = 0 + (Math.random()*0.4 - 0.2);
    } else if (tick < 90) {
      // ASCENDING
      alt = (tick - 30) * 10 + (Math.random()*4 - 2);
      accel = 2.0 + (Math.random()*0.1);
    } else if (tick < 95) {
      // APOGEE
      alt = 600 + (tick - 90)*14 - 1.5*Math.pow(tick-90, 2);
      accel = 0.5 + (Math.random()*0.2);
    } else if (tick < 180) {
      // DESCENDING
      alt = Math.max(0, 660 - (tick - 95)*7 + (Math.random()*4 - 2));
      accel = 0.3 + Math.random()*0.1;
    } else {
      // LANDED
      alt = 0 + (Math.random()*0.4 - 0.2);
    }

    lat += (Math.random() * 0.0001 - 0.00005);
    lon += (Math.random() * 0.0001 - 0.00005);

    let flags = 0;
    if (tick >= 30) flags |= 0x01; // launched
    if (tick >= 90) flags |= 0x02; // apogee
    flags |= 0x04; // gps fix

    const pkt = {
      source: 'CANSAT',
      pkt_id: tick,
      timestamp_ms: tick * 1000,
      altitude_m: alt,
      temp_c: 20.0 - (alt * 0.0065) + (Math.random()*0.6-0.3),
      pressure_hpa: 1013.25 * Math.pow(1 - 2.25577e-5 * alt, 5.25588),
      accel_z: accel,
      gyro_x: Math.random() * 2 - 1,
      lat: lat,
      lon: lon,
      rssi_dbm: -60 - Math.floor(alt / 20),
      flags: flags,
      raw: 'SIMULATED',
      received_at: Date.now()
    };

    insertPacket(pkt);
    processPacket(pkt, emitFn);
    
    try { emitFn('packet', { source: 'CANSAT', data: pkt }); } catch (e) {}

  }, 1000);
}

function stopSimulation() {
  if (interval) clearInterval(interval);
}

module.exports = { startSimulation, stopSimulation };