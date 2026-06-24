const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { deriveSensorHealth } = require('../cansat-hardware');

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
    assert.deepEqual(body.circuit.buses.lora_internal_spi.pins, {
      cs: 'GPIO8',
      dio1: 'GPIO14',
      rst: 'GPIO12',
      busy: 'GPIO13',
      sck: 'GPIO9',
      miso: 'GPIO11',
      mosi: 'GPIO10'
    });
    assert.equal(body.circuit.camera.backend_streaming, false);
    assert.equal(body.circuit.camera.integration, 'local_sd_recording_only');
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
  assert.doesNotMatch(firmware, /"NRC2:%s,%04X"/);
  assert.match(platformio, /-DENABLE_RIDESHARE_LIVE=1/);
  assert.match(platformio, /-DARDUINO_USB_CDC_ON_BOOT=1/);
});

test('Mach-X Rideshare ground receiver matches flight LoRa settings and forwards MXR telemetry', () => {
  const firmware = fs.readFileSync(path.resolve(__dirname, '../../firmware/rideshare-ground-station/src/main.cpp'), 'utf8');
  const platformio = fs.readFileSync(path.resolve(__dirname, '../../firmware/rideshare-ground-station/platformio.ini'), 'utf8');

  assert.match(firmware, /#define LORA_FREQ\s+868\.0/);
  assert.match(firmware, /#define LORA_BW\s+125\.0/);
  assert.match(firmware, /#define LORA_SF\s+9/);
  assert.match(firmware, /#define LORA_CR\s+7/);
  assert.match(firmware, /#define LORA_SW\s+0x12/);
  assert.match(firmware, /#define LORA_PREAMBLE\s+8/);
  assert.match(firmware, /packet\.startsWith\("MXR3:"\)/);
  assert.match(firmware, /packet\.startsWith\("MXR2:"\)/);
  assert.match(firmware, /Serial\.println\(outLine\)/);
  assert.match(platformio, /-DARDUINO_USB_CDC_ON_BOOT=1/);
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
