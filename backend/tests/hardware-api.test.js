const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { deriveSensorHealth, packetIdLimitForSource } = require('../cansat-hardware');

function makeDbMock() {
  return {
    MAX_HISTORY_LIMIT: 1000,
    getStats: () => ({ count: 0, max_alt_m: null, min_temp_c: null }),
    getLatest: () => null,
    getHistory: () => [],
    getAllEvents: () => [],
    exportCsv: () => [],
    insertPacketsBulk: () => ({ changes: 0 }),
    insertUpload: () => ({ changes: 1, lastInsertRowid: 1 }),
    getUpload: () => null,
    getUploadPackets: () => [],
    close: () => {}
  };
}

async function withMockedServer(fn) {
  process.env.PORT = '0';
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === './db') return makeDbMock();
    if (request === './serial') {
      return {
        initSerial: () => {},
        shutdown: async () => {},
        getSignalState: () => ({
          mode: 'hardware',
          CANSAT: { connected: false },
          RIDESHARE: { connected: false },
          NRC: { connected: false },
          MACHX: { connected: false }
        })
      };
    }
    if (request === './rover-proxy') {
      return {
        control: async () => ({}),
        stop: async () => ({}),
        arm: async () => ({}),
        data: async () => ({})
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const { server } = require('../server');
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.on('listening', resolve);
  });

  try {
    const port = server.address().port;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    Module._load = originalLoad;
    await new Promise((resolve) => server.close(resolve));
    delete require.cache[serverPath];
  }
}

test('GET /api/rideshare/hardware exposes payload circuit pins from PAYLOAD_CIRCUIT.md', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/rideshare/hardware`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.circuit.controller, 'Heltec WiFi LoRa 32 V3');
    assert.deepEqual(body.circuit.buses.i2c.pins, { sda: 'GPIO1', scl: 'GPIO2' });
    assert.deepEqual(body.circuit.buses.gps_uart.pins, { rx: 'GPIO7', tx: 'GPIO6' });
    assert.deepEqual(body.circuit.buses.sd_spi.pins, { cs: 'GPIO38', sck: 'GPIO39', mosi: 'GPIO41', miso: 'GPIO42' });
    assert.equal(body.circuit.buses.sd_spi.connections.power, 'SDCardModule1 VCC -> 5V_BUS, GND -> GROUND');
    assert.deepEqual(body.circuit.buses.lora_internal_spi.pins, {
      cs: 'GPIO8',
      dio1: 'GPIO14',
      rst: 'GPIO12',
      busy: 'GPIO13',
      sck: 'GPIO9',
      miso: 'GPIO11',
      mosi: 'GPIO10'
    });
    assert.equal(body.circuit.buses.lora_internal_spi.radio.coding_rate, '4/5');
    assert.equal(body.circuit.camera.backend_streaming, false);
    assert.equal(body.circuit.camera.integration, 'local_sd_recording_only');
    assert.match(body.circuit.camera.reason, /powers ESP32-CAM1 continuously from 5V_BUS/);
    assert.equal(body.circuit.telemetry.protocol_prefixes.includes('MXR3:'), true);
  });
});

test('GET /api/nrc/hardware remains a rideshare hardware alias', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/nrc/hardware`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.circuit.name, 'INVICTUS II MACH-X RIDESHARE PAYLOAD');
  });
});

test('GET /mach-x-rideshare serves the Mach-X Rideshare mission-control dashboard', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/mach-x-rideshare`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(body, /Mach-X CanSat — Mission Control|MACH-X CANSAT/);
    assert.match(body, /Mach-X Rideshare/);
    assert.match(body, /MACH-X RIDESHARE/);
    assert.match(body, /WAITING RIDESHARE LINK/);
    assert.match(body, /liveDashboardSources/);
    assert.match(body, /renderHistoryPayload/);
    assert.match(body, /processPacket\(p, \{ fromHistory: true \}\)/);
    assert.doesNotMatch(body, /NRC Flight Review/);
    assert.doesNotMatch(body, /Waiting for recovered NRC SD data/);
  });
});

test('Mach-X Rideshare dashboard renders successful SD uploads', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../dashboard/mach-x.html'), 'utf8');

  assert.match(dashboard, /async function renderUploadedPackets/);
  assert.match(dashboard, /\/api\/sd-uploads\/'\s*\+\s*encodeURIComponent\(uploadId\)\s*\+\s*'\/packets/);
  assert.match(dashboard, /s\.on\('sd_upload_complete'/);
  assert.match(dashboard, /await renderUploadedPackets\(payload\.upload_id\)/);
  assert.match(dashboard, /UPLOAD FAILED/);
});

test('GET /cansat serves the CanSat dashboard with waiting and recovery states', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/cansat`);
    const body = await res.text();

    assert.equal(res.status, 200);
    assert.match(body, /INVICTUS II CANSAT/);
    assert.match(body, /WAITING CANSAT DEPLOYMENT/);
    assert.match(body, /GPS RECOVERY/);
    assert.match(body, /GPS_REC/);
    assert.match(body, /liveSessionSeenPacket/);
  });
});

test('GET /nrc redirects to the canonical Mach-X Rideshare route', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/nrc`, { redirect: 'manual' });

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/mach-x-rideshare');
  });
});

test('GET /api/packets accepts RIDESHARE and legacy NRC source aliases', async () => {
  await withMockedServer(async (baseUrl) => {
    const canonical = await fetch(`${baseUrl}/api/packets?source=RIDESHARE`);
    const canonicalBody = await canonical.json();
    const legacy = await fetch(`${baseUrl}/api/packets?source=NRC`);
    const legacyBody = await legacy.json();

    assert.equal(canonical.status, 200);
    assert.equal(canonicalBody.source, 'RIDESHARE');
    assert.equal(legacy.status, 200);
    assert.equal(legacyBody.source, 'RIDESHARE');
  });
});

test('GET /api/cansat/hardware exposes flight CanSat circuit truth', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/cansat/hardware`);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.circuit.controller, 'STM32 Bluepill');
    assert.deepEqual(body.circuit.buses.i2c.pins, { scl: 'PB6', sda: 'PB7' });
    assert.equal(body.circuit.telemetry_packet_bytes, 60);
    assert.equal(body.circuit.telemetry_packet_v2_bytes, 43);
    assert.equal(body.circuit.telemetry_packet_v3_bytes, 60);
    assert.deepEqual(body.circuit.packet_versions_accepted, [2, 3]);
    assert.equal(body.circuit.mission_modes.GPS_RECOVERY, 2);
    assert.equal(body.circuit.recovery_altitude_agl_m, 20);
    assert.deepEqual(body.circuit.ground_station_receiver.accepted_frame_bytes, [43, 60]);
    assert.equal(body.circuit.ground_station_receiver.radio, 'RFM69HCW 433 MHz');
    assert.equal(body.circuit.ground_station_receiver.frequency_mhz, 433.0);
    assert.deepEqual(body.circuit.buses.sd_spi.pins, { cs: 'PA4', clk: 'PA5', miso: 'PA6', mosi: 'PA7' });
    assert.deepEqual(body.circuit.buses.avionics_spi.pins, { sck: 'PB13', miso: 'PB14', mosi: 'PB15' });
    assert.equal(body.circuit.buses.avionics_spi.devices[0].name, 'RFM69HCW1');
    assert.equal(body.circuit.buses.avionics_spi.devices[0].frequency_mhz, 433.0);
    assert.deepEqual(body.circuit.buses.camera_uart.pins, { stm32_rx: 'PA10', stm32_tx: 'PA9' });
    assert.equal(body.circuit.indicators.led.stm32_pin, 'PA0');
    assert.equal(body.circuit.indicators.buzzer.stm32_pin, 'PA1');
    assert.equal(body.circuit.power.rails['5V_BUS'].includes('ESP32-CAM 5V'), true);
    assert.equal(body.circuit.power.rails['3V3_BUS'].includes('RFM69HCW 3.3V'), true);
    assert.deepEqual(
      body.circuit.buses.i2c.devices.filter((device) => device.name.startsWith('LM75')).map((device) => device.address),
      ['0x48', '0x49', '0x4A', '0x4C']
    );
  });
});

test('CanSat firmware uses RFM69 433 MHz and flight indicator pins', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/cansat/src/main.cpp'), 'utf8');
  const telemetry = fs.readFileSync(path.resolve(__dirname, '../../firmware/cansat/include/telemetry.h'), 'utf8');
  assert.match(firmware, /#include <RH_RF69\.h>/);
  assert.match(firmware, /#define RFM69_CS\s+PA15/);
  assert.match(firmware, /#define RFM69_INT\s+PB5/);
  assert.match(firmware, /#define RFM69_FREQ\s+433\.0/);
  assert.match(firmware, /#define LED_PIN\s+PA0/);
  assert.match(firmware, /#define BUZZER_PIN\s+PA1/);
  assert.match(firmware, /#define RECOVERY_ALTITUDE_AGL_M\s+20\.0f/);
  assert.match(firmware, /FLAG_GPS_RECOVERY\s+0x80/);
  assert.match(firmware, /missionMode\s*==\s*CANSAT_MODE_GPS_RECOVERY/);
  assert.match(firmware, /txFlags &= ~\(FLAG_BMP_OK \| FLAG_IMU_OK \| FLAG_SD_OK \| FLAG_STALE_SENSOR\)/);
  assert.match(firmware, /TelemetryPacket packet/);
  assert.match(telemetry, /#define TELEMETRY_VERSION\s+3/);
  assert.match(telemetry, /#define TELEMETRY_PAYLOAD_LEN\s+53/);
  assert.match(telemetry, /static_assert\(sizeof\(TelemetryPacket\) == 60/);
  assert.match(telemetry, /float\s+temp_c_4/);
  assert.match(telemetry, /uint8_t\s+mode/);
  assert.doesNotMatch(firmware, /RH_RF95|RFM95_FREQ|868\.0/);
});

test('CanSat ground receiver accepts v2 and v3 frames indefinitely', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/ground-station/src/main.cpp'), 'utf8');

  assert.match(firmware, /TELEMETRY_FRAME_BYTES_V2\s+43/);
  assert.match(firmware, /TELEMETRY_FRAME_BYTES_V3\s+60/);
  assert.match(firmware, /TELEMETRY_RSSI_OFFSET_V2\s+39/);
  assert.match(firmware, /TELEMETRY_RSSI_OFFSET_V3\s+56/);
  assert.match(firmware, /TELEMETRY_CRC_OFFSET_V2\s+41/);
  assert.match(firmware, /TELEMETRY_CRC_OFFSET_V3\s+58/);
  assert.match(firmware, /frameMetaForLength/);
  assert.match(firmware, /Serial\.write\(buf, meta\.len\)/);
});

test('Mach-X Rideshare firmware uses MXR3 live telemetry prefix', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');
  const platformio = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/platformio.ini'), 'utf8');

  assert.match(firmware, /Live telemetry contract \(MXR3/);
  assert.match(firmware, /#define ENABLE_RIDESHARE_LIVE/);
  assert.match(firmware, /"MXR3:%s,%04X"/);
  assert.match(firmware, /const int bodyLen\s*=\s*snprintf\(body/);
  assert.match(firmware, /bodyLen\s*<=\s*0\s*\|\|\s*bodyLen\s*>=\s*\(int\)sizeof\(body\)/);
  assert.match(firmware, /const int packetLen\s*=\s*snprintf\(buffer/);
  assert.match(firmware, /packetLen\s*<=\s*0\s*\|\|\s*packetLen\s*>=\s*\(int\)sizeof\(buffer\)/);
  assert.match(firmware, /if\s*\(livePacketReady\)\s*Serial\.println\(buffer\)/);
  assert.doesNotMatch(firmware, /;\s*Serial\.println\(buffer\);/);
  assert.doesNotMatch(firmware, /"NRC2:%s,%04X"/);
  assert.match(platformio, /-DENABLE_RIDESHARE_LIVE=1/);
  assert.match(platformio, /LORA_DUTY_LIMIT_PPM=<ppm>/);
  assert.match(platformio, /-DARDUINO_USB_CDC_ON_BOOT=0/);
});

test('Mach-X Rideshare firmware GPS pins match payload circuit', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');

  assert.match(firmware, /#define GPS_RX_PIN\s+7/);
  assert.match(firmware, /#define GPS_TX_PIN\s+6/);
  assert.match(firmware, /NEO-6M TX.+GPIO7/);
  assert.match(firmware, /NEO-6M RX.+GPIO6/);
});

test('Mach-X Rideshare firmware latches SD faults and clears SD_OK after write failure', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');

  assert.match(firmware, /bool\s+sd_fault_latched\s*=\s*false/);
  assert.match(firmware, /void\s+latchSdFault/);
  assert.match(firmware, /bool\s+checkedSdWrite/);
  assert.match(firmware, /logFile\.getWriteError\(\)/);
  assert.match(firmware, /flags\s*&=\s*~FLAG_SD_OK/);
  assert.match(firmware, /latchSdFault\("LOG_OPEN"\)/);
  assert.match(firmware, /latchSdFault\("LOG_LIMIT"\)/);
  assert.match(firmware, /checkedSdWrite\(header,\s*"HEADER_WRITE"\)/);
  assert.match(firmware, /checkedSdWrite\(row,\s*"ROW_WRITE"\)/);
});

test('Mach-X Rideshare firmware freezes baseline and preserves stale barometer telemetry', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');

  assert.match(firmware, /bool\s+baseline_locked\s*=\s*false/);
  assert.match(firmware, /candidateGain\s*>\s*LAUNCH_ALT_DELTA_M/);
  assert.match(firmware, /float\s+last_valid_pressure_hpa\s*=\s*1013\.25f/);
  assert.match(firmware, /has_valid_baro_sample\s*\?\s*last_valid_pressure_hpa\s*:\s*baseline_pressure/);
  assert.match(firmware, /flags\s*\|=\s*FLAG_STALE_SENSOR/);
  assert.doesNotMatch(firmware, /baseline_count\s*<=\s*BASELINE_SAMPLES\)\s*baseline_altitude\s*=\s*alt/);
});

test('Mach-X Rideshare firmware debounces apogee and surfaces readiness/RF faults', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');

  assert.match(firmware, /#define APOGEE_CONFIRM_COUNT\s+3/);
  assert.match(firmware, /uint8_t\s+apogee_descent_consecutive\s*=\s*0/);
  assert.match(firmware, /apogee_descent_consecutive\+\+/);
  assert.match(firmware, /apogee_descent_consecutive\s*>=\s*APOGEE_CONFIRM_COUNT/);
  assert.doesNotMatch(firmware, /if\s*\(\s*\(max_altitude - alt\)\s*>\s*APOGEE_DROP_M\s*\)\s*\{\s*apogee_detected\s*=\s*true/s);
  assert.match(firmware, /required_ok\s*=\s*[\s\S]*baro_ok[\s\S]*sdHealthy\(\)[\s\S]*lora_ok/);
  assert.match(firmware, /required_ok\s*\?\s*"READY"\s*:\s*"NO GO"/);
  assert.match(firmware, /lora_tx_fault_latched\s*=\s*true/);
  assert.match(firmware, /LoRa TX FAILED/);
  assert.match(firmware, /RFX/);
});

test('Mach-X Rideshare firmware makes LoRa airtime limiting explicit', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc/src/main.cpp'), 'utf8');
  const guide = fs.readFileSync(path.resolve(__dirname, '../../docs/rideshare_payload_testing_guide.md'), 'utf8');

  assert.match(firmware, /#ifndef LORA_DUTY_LIMIT_PPM/);
  assert.match(firmware, /#define LORA_DUTY_LIMIT_PPM 0/);
  assert.match(firmware, /#ifndef LORA_TELEMETRY_INTERVAL_MS/);
  assert.match(firmware, /#if LORA_DUTY_LIMIT_PPM > 0/);
  assert.match(firmware, /next_lora_tx_ms/);
  assert.match(firmware, /uint64_t\s+minIntervalCalc/);
  assert.match(firmware, /1000000ULL/);
  assert.match(firmware, /0xffffffffULL/);
  assert.match(firmware, /LoRa duty limiter holding RF TX/);
  assert.match(firmware, /verify legal airtime before flight/);
  assert.doesNotMatch(firmware, /UK Ofcom IR2030 compliant/);
  assert.match(guide, /LORA_DUTY_LIMIT_PPM/);
});

test('Mach-X Rideshare ground receiver matches flight LoRa settings and forwards MXR telemetry', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/rideshare-ground-station/src/main.cpp'), 'utf8');
  const platformio = fs.readFileSync(path.resolve(__dirname, '../../firmware/rideshare-ground-station/platformio.ini'), 'utf8');

  assert.match(firmware, /#define LORA_FREQ\s+868\.0/);
  assert.match(firmware, /#define LORA_BW\s+125\.0/);
  assert.match(firmware, /#define LORA_SF\s+9/);
  assert.match(firmware, /#define LORA_CR\s+5/);
  assert.match(firmware, /#define LORA_SW\s+0x12/);
  assert.match(firmware, /#define LORA_PREAMBLE\s+8/);
  assert.match(firmware, /strncmp\(packet,\s*"MXR3:"/);
  assert.match(firmware, /strncmp\(packet,\s*"MXR2:"/);
  assert.match(firmware, /Serial\.println\(outLine\)/);
  assert.match(firmware, /if\s*\(count\s*>=\s*maxFields\s*\|\|\s*\*cursor\s*==\s*'\\0'\)\s*return\s+-1/);
  assert.match(firmware, /if\s*\(fieldCount\s*<=\s*0\)\s*return\s+false/);
  assert.match(firmware, /bool\s+isStrictNumericField/);
  assert.match(firmware, /bool\s+fieldsAreStrictNumeric/);
  assert.match(firmware, /if\s*\(!fieldsAreStrictNumeric\(fields,\s*fieldCount\)\)\s*return\s+false/);
  assert.doesNotMatch(firmware, /Number\.parseFloat|parseFloat|atof\(/);
  assert.doesNotMatch(firmware, /strchr\(fields\[fieldCount\s*-\s*1\],\s*','\)/);
  assert.match(firmware, /void\s+restartReceiveMode\(\)/);
  assert.match(firmware, /rxRestartFailures\+\+/);
  assert.match(firmware, /receive restart failed/);
  assert.doesNotMatch(firmware, /\/\/ Restart continuous receive mode\s*\n\s*radio\.startReceive\(\);/);
  assert.match(platformio, /-DARDUINO_USB_CDC_ON_BOOT=0/);
});

test('Mach-X Rideshare ground receiver avoids Arduino String packet parsing', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/rideshare-ground-station/src/main.cpp'), 'utf8');

  assert.doesNotMatch(firmware, /\bString\b/);
  assert.match(firmware, /uint8_t\s+rawPacket\[MAX_PACKET_LEN \+ 1\]/);
  assert.match(firmware, /radio\.readData\(rawPacket,\s*MAX_PACKET_LEN\)/);
  assert.match(firmware, /char\*\s+fields\[10\]/);
});

test('Mach-X Rideshare sensor health uses payload circuit pin mappings', () => {
  const health = deriveSensorHealth({
    source: 'RIDESHARE',
    pressure_hpa: 1013.25,
    altitude_m: 12.5,
    temp_c: 24.5,
    lat: 25.2048,
    lon: 55.2708,
    rssi_dbm: -80,
    flags: 0x04 | 0x08 | 0x20
  });

  assert.deepEqual(health.bmp280.pins, { sda: 'GPIO1', scl: 'GPIO2' });
  assert.deepEqual(health.lm75.pins, { sda: 'GPIO1', scl: 'GPIO2' });
  assert.equal(health.lm75.ok, false);
  assert.equal(deriveSensorHealth({
    source: 'RIDESHARE',
    pressure_hpa: 1013.25,
    altitude_m: 12.5,
    temp_c: 24.5,
    temp_c_1: 24.25,
    lat: 25.2048,
    lon: 55.2708,
    rssi_dbm: -80,
    flags: 0x04 | 0x08 | 0x20
  }).lm75.ok, true);
  assert.deepEqual(health.neo6m.pins, { rx: 'GPIO7', tx: 'GPIO6' });
  assert.deepEqual(health.sd_card.pins, { cs: 'GPIO38', sck: 'GPIO39', mosi: 'GPIO41', miso: 'GPIO42' });
  assert.deepEqual(health.lora.pins, {
    cs: 'GPIO8',
    dio1: 'GPIO14',
    rst: 'GPIO12',
    busy: 'GPIO13',
    sck: 'GPIO9',
    miso: 'GPIO11',
    mosi: 'GPIO10'
  });
});

test('Mach-X dashboard only plots fresh GPS fixes', () => {
  const dashboard = fs.readFileSync(path.resolve(__dirname, '../../dashboard/mach-x.html'), 'utf8');

  assert.match(dashboard, /function\s+hasFreshGps\(pkt\)/);
  assert.match(dashboard, /pkt\.flags\s*&\s*0x04/);
  assert.match(dashboard, /if\s*\(!hasFreshGps\(pkt\)\)\s+return/);
  assert.match(dashboard, /\.filter\(hasFreshGps\)\.map/);
  assert.match(dashboard, /slice\.map\(\(p,\s*i\)\s*=>\s*Number\.isFinite\(p\.temp_c_1\)\s*\?\s*p\.temp_c_1\s*:\s*tempRaw\[i\]\)/);
  assert.doesNotMatch(dashboard, /tempRaw\[tempRaw\.length-1\]/);
  assert.doesNotMatch(dashboard, /if\s*\(!pkt\.lat\s*\|\|\s*!pkt\.lon\)\s+return/);
});

test('ESP32-CAM recording firmware latches local SD recording faults', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/nrc-camera/src/main.cpp'), 'utf8');

  assert.match(firmware, /bool\s+recordingFaultLatched\s*=\s*false/);
  assert.match(firmware, /void\s+latchRecordingFault/);
  assert.match(firmware, /void\s+serviceFaultLed/);
  assert.match(firmware, /recNum\s*<=\s*999/);
  assert.match(firmware, /SD_MMC\.mkdir\(candidateDir\)/);
  assert.match(firmware, /latchRecordingFault\("DIR_CREATE"\)/);
  assert.match(firmware, /snprintf\(framePath/);
  assert.match(firmware, /SD_MMC\.remove\(framePath\)/);
  assert.match(firmware, /latchRecordingFault\("SHORT_WRITE"\)/);
  assert.doesNotMatch(firmware, /WRITE_PERI_REG\(RTC_CNTL_BROWN_OUT_REG,\s*0\)/);
  assert.match(firmware, /Brownout detector remains enabled/);
});

test('telemetry packet id limits stay source specific', () => {
  assert.deepEqual(packetIdLimitForSource('CANSAT'), { min: 0, max: 0xffff });
  assert.deepEqual(packetIdLimitForSource('RIDESHARE'), { min: 0, max: 0xffffffff });
  assert.deepEqual(packetIdLimitForSource('MACHX'), { min: 0, max: 0xffffffff });
});
