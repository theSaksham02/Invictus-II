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

test('GET /api/nrc/hardware exposes payload circuit pins from PAYLOAD_CIRCUIT.md', async () => {
  await withMockedServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/nrc/hardware`);
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
    assert.equal(body.circuit.camera.integration, 'power_only');
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
    assert.equal(body.circuit.telemetry_packet_bytes, 43);
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
  assert.match(firmware, /#include <RH_RF69\.h>/);
  assert.match(firmware, /#define RFM69_CS\s+PA15/);
  assert.match(firmware, /#define RFM69_INT\s+PB5/);
  assert.match(firmware, /#define RFM69_FREQ\s+433\.0/);
  assert.match(firmware, /#define LED_PIN\s+PA0/);
  assert.match(firmware, /#define BUZZER_PIN\s+PA1/);
  assert.match(firmware, /TelemetryPacket packet/);
  assert.doesNotMatch(firmware, /RH_RF95|RFM95_FREQ|868\.0/);
});

test('NRC sensor health uses payload circuit pin mappings', () => {
  const health = deriveSensorHealth({
    source: 'NRC',
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
  assert.equal(health.lm75.ok, null);
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
