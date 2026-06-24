const LEGACY_PACKET_LENGTH_BYTES = 37;
const PACKET_V2_LENGTH_BYTES = 43;
const PACKET_V3_LENGTH_BYTES = 60;
const PACKET_LENGTH_BYTES = PACKET_V2_LENGTH_BYTES;
const PACKET_SYNC = 0xa55a;
const PACKET_VERSION = 2;
const PACKET_V3_VERSION = 3;
const CANSAT_SOURCE_ID = 1;
const PACKET_PAYLOAD_LENGTH_BYTES = 36;
const PACKET_V3_PAYLOAD_LENGTH_BYTES = 53;

const CANSAT_MISSION_MODES = Object.freeze({
  PRE_DEPLOY: 0,
  DEPLOYED_SCIENCE: 1,
  GPS_RECOVERY: 2
});

const CANSAT_MISSION_MODE_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(CANSAT_MISSION_MODES).map(([name, value]) => [value, name])
));

const FLAG_BITS = Object.freeze({
  launched: 0x01,
  apogee: 0x02,
  gps_fix: 0x04,
  bmp_ok: 0x08,
  mpu_ok: 0x10,
  sd_ok: 0x20,
  stale_sensor: 0x40,
  gps_recovery: 0x80
});

const CIRCUIT = Object.freeze({
  name: 'INVICTUS II CANSAT',
  controller: 'STM32 Bluepill',
  telemetry_packet_bytes: PACKET_V3_LENGTH_BYTES,
  telemetry_packet_v2_bytes: PACKET_V2_LENGTH_BYTES,
  telemetry_packet_v3_bytes: PACKET_V3_LENGTH_BYTES,
  legacy_packet_bytes: LEGACY_PACKET_LENGTH_BYTES,
  packet_sync: `0x${PACKET_SYNC.toString(16).toUpperCase()}`,
  packet_version: PACKET_V3_VERSION,
  packet_versions_accepted: [2, 3],
  mission_modes: CANSAT_MISSION_MODES,
  recovery_altitude_agl_m: 20,
  docs_source: 'backend/CANSAT_CIRCUIT.md',
  firmware: 'firmware/cansat/src/main.cpp',

  components: [
    { name: 'LM75', quantity: 4, role: 'distributed temperature sensors', addresses: ['0x48', '0x49', '0x4A', '0x4C'] },
    { name: 'BMP388', quantity: 1, role: 'barometric altitude, pressure, and temperature' },
    { name: 'RFM69HCW', quantity: 1, role: '433 MHz flight telemetry radio' },
    { name: 'NEO-6M', quantity: 1, role: 'GPS position source' },
    { name: 'SDCardModule', quantity: 1, role: 'onboard telemetry recovery log' },
    { name: 'STM32 Bluepill', quantity: 1, role: 'flight computer' },
    { name: 'MPU6500', quantity: 1, role: 'acceleration and gyro telemetry' },
    { name: 'XL6009', quantity: 1, role: 'SYS_POWER to 5V_BUS boost converter' },
    { name: 'AMS1117', quantity: 1, role: '5V_BUS to 3V3_BUS regulator' },
    { name: 'TP4056', quantity: 1, role: 'USB-C/solar LiPo charger and battery interface' },
    { name: 'solar panel module', quantity: 4, role: 'charge input to TP4056 VIN+/VIN-' },
    { name: 'ESP32-CAM', quantity: 1, role: 'independent camera, UART wired for future trigger/status' },
    { name: 'Buzzer', quantity: 1, role: 'audible boot/status indicator' },
    { name: 'red LED', quantity: 1, role: 'visual boot/status indicator' }
  ],

  // Ground Station Receiver — ESP32 WROOM-32 + RFM69HCW 433 MHz
  // The ESP32 bridges the RFM69 radio to the laptop via USB Serial (115200 baud).
  // It is NOT a bare USB dongle — it is a dedicated microcontroller that:
  //   1. Receives 43-byte v2 or 60-byte v3 binary packets over SPI from the RFM69HCW
  //   2. Validates the 0xA55A sync word before forwarding
  //   3. Stamps ground-side RSSI into the frame
  //   4. Forwards the raw frame over USB CDC to the laptop (serial.js reads it)
  ground_station_receiver: {
    mcu: 'ESP32 WROOM-32',
    radio: 'RFM69HCW 433 MHz',
    frequency_mhz: 433.0,
    interface: 'USB Serial (CP2102/CH340) @ 115200 baud',
    accepted_frame_bytes: [PACKET_V2_LENGTH_BYTES, PACKET_V3_LENGTH_BYTES],
    firmware: 'firmware/ground-station/src/main.cpp',
    pins: {
      rfm69_mosi: 'GPIO23',
      rfm69_miso: 'GPIO19',
      rfm69_sck:  'GPIO18',
      rfm69_cs:   'GPIO5',
      rfm69_irq:  'GPIO4',
      rfm69_rst:  'GPIO14'
    },
    competitive_advantage: [
      'Hardware SPI at 10 MHz — zero missed packets at 1 Hz rate',
      'Frame-level RSSI stamping before USB forward',
      'Can buffer frames across USB stalls',
      'Future WiFi fallback if USB cable disconnects mid-flight'
    ]
  },

  buses: {
    sd_spi: {
      pins: { cs: 'PA4', clk: 'PA5', miso: 'PA6', mosi: 'PA7' },
      devices: ['SDCardSlot1'],
      connections: {
        cs: 'STM32 A4 -> SDCardSlot CS',
        clk: 'STM32 A5 -> SDCardSlot CLK',
        miso: 'STM32 A6 <- SDCardSlot MISO',
        mosi: 'STM32 A7 -> SDCardSlot MOSI',
        power: 'SDCardSlot 3V3 -> 3V3_BUS, GND -> GROUND'
      }
    },
    avionics_spi: {
      pins: { sck: 'PB13', miso: 'PB14', mosi: 'PB15' },
      devices: [
        {
          name: 'RFM69HCW1',
          cs: 'PA15',
          irq: 'PB5',
          reset: 'unconnected',
          frequency_mhz: 433.0,
          antenna: 'ANT -> SMA female connector'
        },
        {
          name: 'MPU-6500',
          cs: 'PB12',
          irq: 'PA8',
          decoupling: '4.7uF and 0.1uF capacitors in parallel from VCC to GND'
        }
      ]
    },
    i2c: {
      pins: { scl: 'PB6', sda: 'PB7' },
      devices: [
        { name: 'BMP388', address: '0x76', mode: 'I2C', cs: '3V3_BUS', sdo: 'GROUND', int: 'unconnected' },
        { name: 'LM75-U1', address: '0x48', os: 'unconnected' },
        { name: 'LM75-U2', address: '0x49', os: 'unconnected' },
        { name: 'LM75-U3', address: '0x4A', os: 'unconnected' },
        { name: 'LM75-U4', address: '0x4C', os: 'unconnected' }
      ],
      note: 'All LM75 modules share STM32 B6/B7 and must be address-strapped to unique addresses.'
    },
    gps_uart: {
      pins: { stm32_rx: 'PB11', stm32_tx: 'PB10' },
      device: 'NEO-6M',
      connections: {
        stm32_rx: 'STM32 B11 receives NEO-6M TX',
        stm32_tx: 'STM32 B10 transmits to NEO-6M RX',
        power: 'NEO-6M VCC -> 5V_BUS, GND -> GROUND'
      }
    },
    camera_uart: {
      pins: { stm32_rx: 'PA10', stm32_tx: 'PA9' },
      device: 'ESP32-CAM1',
      integration: 'power_plus_uart_reserved',
      connections: {
        stm32_rx: 'STM32 A10 receives ESP32-CAM U0T',
        stm32_tx: 'STM32 A9 transmits to ESP32-CAM U0R',
        power: 'ESP32-CAM 5V -> 5V_BUS, all GND pins -> GROUND'
      }
    }
  },
  indicators: {
    led: {
      color: 'red',
      stm32_pin: 'PA0',
      wiring: 'PA0 -> LED anode, LED cathode -> 150 ohm resistor -> GROUND'
    },
    buzzer: {
      stm32_pin: 'PA1',
      wiring: 'PA1 -> buzzer positive, buzzer negative -> GROUND'
    }
  },
  power: {
    charge_input: {
      usb_c: 'TP4056 VIN+ / VIN-',
      solar: '4 solar panel modules wired to TP4056 VIN+ / VIN- respectively'
    },
    battery: 'LiPo JST -> TP4056 BAT+ / BAT-',
    system: 'TP4056 OUT+ -> switch -> SYS_POWER, TP4056 OUT- -> GROUND',
    five_volt: 'SYS_POWER -> XL6009 IN+, XL6009 OUT+ -> 5V_BUS, XL6009 IN-/OUT- -> GROUND',
    three_v_three: '5V_BUS -> AMS1117 VIN, AMS1117 VOUT -> 3V3_BUS, AMS1117 GND -> GROUND',
    protection: '1N4007 diode between 3V3_BUS and 5V_BUS, cathode toward 5V_BUS',
    decoupling: [
      '100nF and 1000uF capacitors in parallel from 5V_BUS to GROUND near XL6009 output',
      '4.7uF and 0.1uF capacitors in parallel from MPU-6500 VCC to GROUND'
    ],
    rails: {
      SYS_POWER: ['XL6009 IN+'],
      '5V_BUS': ['AMS1117 VIN', 'NEO-6M VCC', 'ESP32-CAM 5V'],
      '3V3_BUS': ['STM32 VB/3.3V pins', 'BMP388 VIN/CS', 'LM75 Vcc', 'MPU-6500 VCC', 'RFM69HCW 3.3V', 'SDCardSlot 3V3']
    }
  },
  unconnected_controller_pins: ['PC13', 'PC14', 'PC15', 'PA2', 'PA3', 'PB1', 'RESET', '5V', 'PB9', 'PB8', 'PB4', 'PB3', 'PA12', 'PA11'],
  packet_fields_v3: [
    { offset: 0, bytes: 2, type: 'uint16le', name: 'sync' },
    { offset: 2, bytes: 1, type: 'uint8', name: 'version' },
    { offset: 3, bytes: 1, type: 'uint8', name: 'source_id' },
    { offset: 4, bytes: 1, type: 'uint8', name: 'payload_len' },
    { offset: 5, bytes: 2, type: 'uint16le', name: 'pkt_id' },
    { offset: 7, bytes: 4, type: 'uint32le', name: 'timestamp_ms' },
    { offset: 11, bytes: 1, type: 'uint8', name: 'mode' },
    { offset: 12, bytes: 4, type: 'floatle', name: 'altitude_m' },
    { offset: 16, bytes: 4, type: 'floatle', name: 'temp_c' },
    { offset: 20, bytes: 4, type: 'floatle', name: 'pressure_hpa' },
    { offset: 24, bytes: 4, type: 'floatle', name: 'temp_c_1' },
    { offset: 28, bytes: 4, type: 'floatle', name: 'temp_c_2' },
    { offset: 32, bytes: 4, type: 'floatle', name: 'temp_c_3' },
    { offset: 36, bytes: 4, type: 'floatle', name: 'temp_c_4' },
    { offset: 40, bytes: 4, type: 'floatle', name: 'accel_z' },
    { offset: 44, bytes: 4, type: 'floatle', name: 'gyro_x' },
    { offset: 48, bytes: 4, type: 'floatle', name: 'lat' },
    { offset: 52, bytes: 4, type: 'floatle', name: 'lon' },
    { offset: 56, bytes: 1, type: 'int8', name: 'rssi_dbm' },
    { offset: 57, bytes: 1, type: 'uint8', name: 'flags' },
    { offset: 58, bytes: 2, type: 'uint16le', name: 'crc16_ccitt' }
  ],
  packet_fields_v2: [
    { offset: 0, bytes: 2, type: 'uint16le', name: 'sync' },
    { offset: 2, bytes: 1, type: 'uint8', name: 'version' },
    { offset: 3, bytes: 1, type: 'uint8', name: 'source_id' },
    { offset: 4, bytes: 1, type: 'uint8', name: 'payload_len' },
    { offset: 5, bytes: 2, type: 'uint16le', name: 'pkt_id' },
    { offset: 7, bytes: 4, type: 'uint32le', name: 'timestamp_ms' },
    { offset: 11, bytes: 4, type: 'floatle', name: 'altitude_m' },
    { offset: 15, bytes: 4, type: 'floatle', name: 'temp_c' },
    { offset: 19, bytes: 4, type: 'floatle', name: 'pressure_hpa' },
    { offset: 23, bytes: 4, type: 'floatle', name: 'accel_z' },
    { offset: 27, bytes: 4, type: 'floatle', name: 'gyro_x' },
    { offset: 31, bytes: 4, type: 'floatle', name: 'lat' },
    { offset: 35, bytes: 4, type: 'floatle', name: 'lon' },
    { offset: 39, bytes: 1, type: 'int8', name: 'rssi_dbm' },
    { offset: 40, bytes: 1, type: 'uint8', name: 'flags' },
    { offset: 41, bytes: 2, type: 'uint16le', name: 'crc16_ccitt' }
  ]
});

const NRC_PAYLOAD_CIRCUIT = Object.freeze({
  name: 'INVICTUS II MACH-X RIDESHARE PAYLOAD',
  controller: 'Heltec WiFi LoRa 32 V3',
  docs_source: 'backend/PAYLOAD_CIRCUIT.md',
  firmware: 'firmware/nrc/src/main.cpp',
  telemetry: {
    protocol_prefixes: ['MXR3:', 'MXR2:', 'NRC2:', 'NRC:'],
    interface: 'SX1262 LoRa and USB Serial @ 115200 baud',
    live_enabled_default: true,
    note: 'MXR3 is preferred for live rideshare telemetry because it includes LM75 temperature. MXR2 and NRC/NRC2 remain accepted for compatibility.'
  },
  power: {
    input: 'Battery JST -> Li-ion 2S 3A BMS -> switch terminal block -> LM2596',
    five_volt: 'LM2596 OUT+ -> 5V_BUS',
    ground: 'LM2596 OUT- -> GROUND',
    controller: {
      vin: 'LoRa pin 2 5V -> 5V_BUS',
      ground: ['LoRa pin 1 GND -> GROUND', 'LoRa pin 36 GND -> GROUND'],
      three_v_three: 'LoRa pin 35 3V3 -> 3V3_BUS',
      unused_three_v_three: 'LoRa pin 34 3V3 -> EMPTY'
    },
    note: 'PAYLOAD_CIRCUIT.md labels SD card VCC as 5V_BUS3; backend treats it as the same 5V_BUS rail.'
  },
  buses: {
    i2c: {
      pins: { sda: 'GPIO1', scl: 'GPIO2' },
      devices: [
        { name: 'BMP280', address: '0x76 preferred, 0x77 fallback', connections: { sda: 'pin 4 BMP280 SDA', scl: 'pin 3 BMP280 SCL' } },
        { name: 'LM75', address: '0x48', connections: { sda: 'pin 3 LM75 SDA', scl: 'pin 4 LM75 SCL' }, telemetry: 'reported in MXR3 temp_c_1; fallback source for temp_c if BMP280 temperature fails' }
      ],
      power: {
        bmp280: { vcc: '3V3_BUS', gnd: 'GROUND', csb: '3V3_BUS', sdo: 'GROUND' },
        lm75: { vcc: '3V3_BUS', gnd: 'GROUND', os: 'EMPTY' }
      }
    },
    gps_uart: {
      bus: 'UART1',
      pins: { rx: 'GPIO7', tx: 'GPIO6' },
      device: 'NEO-6M',
      connections: {
        rx: 'GPIO7 receives NEO-6M TX',
        tx: 'GPIO6 transmits to NEO-6M RX',
        power: 'NEO-6M VCC -> 5V_BUS, GND -> GROUND'
      }
    },
    sd_spi: {
      pins: { cs: 'GPIO38', sck: 'GPIO39', mosi: 'GPIO41', miso: 'GPIO42' },
      device: 'SDCardModule1',
      connections: {
        cs: 'LoRa GPIO38 -> SDCardModule1 pin 6',
        sck: 'LoRa GPIO39 -> SDCardModule1 pin 5',
        mosi: 'LoRa GPIO41 -> SDCardModule1 pin 4',
        miso: 'LoRa GPIO42 -> SDCardModule1 pin 3',
        power: 'SDCardModule1 VCC -> 5V_BUS, GND -> GROUND'
      }
    },
    lora_internal_spi: {
      device: 'SX1262 internal to Heltec V3',
      pins: { cs: 'GPIO8', dio1: 'GPIO14', rst: 'GPIO12', busy: 'GPIO13', sck: 'GPIO9', miso: 'GPIO11', mosi: 'GPIO10' },
      radio: { frequency_mhz: 868.0, bandwidth_khz: 125.0, spreading_factor: 9, coding_rate: '4/7' }
    }
  },
  camera: {
    device: 'ESP32-CAM1',
    integration: 'local_sd_recording_only',
    backend_streaming: false,
    reason: 'PAYLOAD_CIRCUIT.md powers ESP32-CAM1 but leaves IO4, IO2, IO14, IO15, IO13, IO12, IO16, IO0, U0R, and U0T unconnected, so camera video is recovered from the camera SD card only.',
    power: { five_volt: 'ESP32-CAM1 pin 8 5V -> 5V_BUS', grounds: ['pin 7 GND', 'pin 12 GND', 'pin 16 GND'] }
  },
  unconnected_controller_pins: [
    'RX', 'TX', 'RST', 'GPIO0', 'GPIO36', 'GPIO35', 'GPIO34', 'GPIO33',
    'GPIO47', 'GPIO48', 'GPIO26', 'GPIO21', 'GPIO20', 'GPIO19',
    'GPIO5', 'GPIO4', 'GPIO3', 'GPIO40', 'GPIO45', 'GPIO46', 'GPIO37'
  ]
});

const TELEMETRY_LIMITS = Object.freeze({
  pkt_id: { min: 0, max: 65535 },
  timestamp_ms: { min: 0, max: 0xffffffff },
  altitude_m: { min: -500, max: 50000 },
  temp_c: { min: -1000, max: 125 },
  temp_c_1: { min: -1000, max: 125 },
  temp_c_2: { min: -1000, max: 125 },
  temp_c_3: { min: -1000, max: 125 },
  temp_c_4: { min: -1000, max: 125 },
  pressure_hpa: { min: 100, max: 1200 },
  accel_z: { min: -50, max: 50 },
  gyro_x: { min: -5000, max: 5000 },
  lat: { min: -90, max: 90 },
  lon: { min: -180, max: 180 },
  rssi_dbm: { min: -127, max: 20 },
  flags: { min: 0, max: 255 }
});

function xorChecksum(buffer, length = PACKET_LENGTH_BYTES - 1) {
  let checksum = 0;
  for (let i = 0; i < length; i++) checksum ^= buffer[i];
  return checksum;
}

function crc16Ccitt(buffer, length = buffer.length, seed = 0xffff) {
  let crc = seed;
  for (let i = 0; i < length; i++) {
    crc ^= buffer[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc;
}

function decodeFlags(flags) {
  const normalized = Number.isInteger(flags) ? flags : 0;
  return Object.freeze(Object.fromEntries(
    Object.entries(FLAG_BITS).map(([name, bit]) => [name, (normalized & bit) !== 0])
  ));
}

function deriveSensorHealth(packet) {
  const flags = decodeFlags(packet?.flags);
  const missionMode = packet?.mission_mode || 'PRE_DEPLOY';
  const gpsRecovery = missionMode === 'GPS_RECOVERY' || flags.gps_recovery;
  if (packet?.source === 'RIDESHARE' || packet?.source === 'NRC') {
    return {
      bmp280: {
        ok: flags.bmp_ok && Number.isFinite(packet.pressure_hpa) && Number.isFinite(packet.altitude_m),
        bus: 'i2c',
        pins: NRC_PAYLOAD_CIRCUIT.buses.i2c.pins
      },
      lm75: {
        ok: Number.isFinite(packet.temp_c_1),
        bus: 'i2c',
        pins: NRC_PAYLOAD_CIRCUIT.buses.i2c.pins,
        note: 'MXR3 reports LM75 temperature in temp_c_1. MXR2 legacy packets do not include a dedicated LM75 value.'
      },
      neo6m: {
        ok: flags.gps_fix && Number.isFinite(packet.lat) && Number.isFinite(packet.lon),
        bus: 'gps_uart',
        pins: NRC_PAYLOAD_CIRCUIT.buses.gps_uart.pins
      },
      sd_card: {
        ok: flags.sd_ok,
        bus: 'sd_spi',
        pins: NRC_PAYLOAD_CIRCUIT.buses.sd_spi.pins
      },
      lora: {
        ok: Number.isInteger(packet.rssi_dbm) && packet.rssi_dbm >= TELEMETRY_LIMITS.rssi_dbm.min,
        bus: 'lora_internal_spi',
        pins: NRC_PAYLOAD_CIRCUIT.buses.lora_internal_spi.pins
      }
    };
  }

  if (packet?.source === 'MACHX' || packet?.source === 'SUGAR') {
    return {
      bmp388: {
        ok: flags.bmp_ok && Number.isFinite(packet.pressure_hpa) && Number.isFinite(packet.altitude_m),
        bus: 'i2c',
        pins: CIRCUIT.buses.i2c.pins
      },
      lm75: {
        ok: Number.isFinite(packet.temp_c_1) && packet.temp_c_1 > -900 &&
            Number.isFinite(packet.temp_c_2) && packet.temp_c_2 > -900 &&
            Number.isFinite(packet.temp_c_3) && packet.temp_c_3 > -900 &&
            Number.isFinite(packet.temp_c_4) && packet.temp_c_4 > -900,
        bus: 'i2c',
        pins: CIRCUIT.buses.i2c.pins
      },
      mpu6500: {
        ok: flags.mpu_ok && Number.isFinite(packet.accel_z) && Number.isFinite(packet.gyro_x),
        bus: 'avionics_spi',
        pins: CIRCUIT.buses.avionics_spi.pins
      },
      gps: {
        ok: flags.gps_fix && Number.isFinite(packet.lat) && Number.isFinite(packet.lon),
        bus: 'gps_uart',
        pins: CIRCUIT.buses.gps_uart.pins
      },
      sd_card: {
        ok: flags.sd_ok,
        bus: 'sd_spi',
        pins: CIRCUIT.buses.sd_spi.pins
      },
      radio: {
        ok: Number.isInteger(packet.rssi_dbm) && packet.rssi_dbm >= TELEMETRY_LIMITS.rssi_dbm.min,
        bus: 'avionics_spi',
        pins: CIRCUIT.buses.avionics_spi.pins
      }
    };
  }

  return {
    bmp388: {
      ok: gpsRecovery || (flags.bmp_ok && Number.isFinite(packet.pressure_hpa) && Number.isFinite(packet.altitude_m)),
      quiet: gpsRecovery,
      note: gpsRecovery ? 'Intentionally quiet in GPS recovery mode.' : undefined,
      bus: 'i2c',
      pins: CIRCUIT.buses.i2c.pins
    },
    lm75: {
      ok: gpsRecovery || (
        Number.isFinite(packet.temp_c_1) && packet.temp_c_1 > -900 &&
        Number.isFinite(packet.temp_c_2) && packet.temp_c_2 > -900 &&
        Number.isFinite(packet.temp_c_3) && packet.temp_c_3 > -900 &&
        Number.isFinite(packet.temp_c_4) && packet.temp_c_4 > -900
      ),
      quiet: gpsRecovery,
      note: gpsRecovery ? 'LM75 sampling stops in GPS recovery mode.' : undefined,
      bus: 'i2c',
      pins: CIRCUIT.buses.i2c.pins
    },
    mpu6500: {
      ok: gpsRecovery || (flags.mpu_ok && Number.isFinite(packet.accel_z) && Number.isFinite(packet.gyro_x)),
      quiet: gpsRecovery,
      note: gpsRecovery ? 'IMU sampling stops in GPS recovery mode.' : undefined,
      bus: 'avionics_spi',
      pins: CIRCUIT.buses.avionics_spi.pins
    },
    neo6m: {
      ok: gpsRecovery
        ? flags.gps_fix && Number.isFinite(packet.lat) && Number.isFinite(packet.lon)
        : true,
      suppressed: !gpsRecovery,
      note: gpsRecovery ? undefined : 'GPS live data is suppressed until recovery mode.',
      bus: 'gps_uart',
      pins: CIRCUIT.buses.gps_uart.pins
    },
    sd_card: {
      ok: gpsRecovery || flags.sd_ok,
      quiet: gpsRecovery,
      note: gpsRecovery ? 'SD writes stop in GPS recovery mode.' : undefined,
      bus: 'sd_spi',
      pins: CIRCUIT.buses.sd_spi.pins
    },
    rfm69hcw: {
      ok: Number.isInteger(packet.rssi_dbm) && packet.rssi_dbm >= TELEMETRY_LIMITS.rssi_dbm.min,
      bus: 'avionics_spi',
      pins: CIRCUIT.buses.avionics_spi.pins
    }
  };
}

function packetWarnings(packet) {
  const warnings = [];
  const flags = decodeFlags(packet?.flags);
  const missionMode = packet?.mission_mode || 'PRE_DEPLOY';
  const gpsRecovery = missionMode === 'GPS_RECOVERY' || flags.gps_recovery;

  if (packet?.source === 'RIDESHARE' || packet?.source === 'NRC') {
    if (!flags.bmp_ok) warnings.push('BMP280 flag is not set; altitude, pressure, and temperature may be fallback values.');
    if (packet?.protocol_version >= 3 && !Number.isFinite(packet.temp_c_1)) {
      warnings.push('LM75 temperature is unavailable in MXR3 telemetry; BMP280 temperature is the only live temperature source.');
    }
    if (!flags.gps_fix) warnings.push('NEO-6M GPS fix flag is not set; latitude and longitude may be stale or zero.');
    if (!flags.sd_ok) warnings.push('SD card flag is not set; onboard recovery log may be unavailable.');
    if (Number.isFinite(packet?.pressure_hpa) && packet.pressure_hpa < 300) {
      warnings.push('Pressure is unusually low for the expected Mach-X Rideshare flight envelope.');
    }
    if (Number.isInteger(packet?.rssi_dbm) && packet.rssi_dbm < -110) {
      warnings.push('LoRa RSSI is very weak; expect packet loss.');
    }
    return warnings;
  }

  if (packet?.source === 'MACHX' || packet?.source === 'SUGAR') {
    if (!flags.bmp_ok) warnings.push('BMP388 flag is not set; altitude, pressure, and temperature may be fallback values.');
    if (!flags.mpu_ok) warnings.push('MPU-6500 flag is not set; acceleration and gyro data may be fallback values.');
    if (!flags.gps_fix) warnings.push('GPS fix flag is not set; latitude and longitude may be stale or zero.');
    if (!flags.sd_ok) warnings.push('SD card flag is not set; onboard recovery log may be unavailable.');

    if (Number.isFinite(packet?.pressure_hpa) && packet.pressure_hpa < 300) {
      warnings.push('Pressure is unusually low for the expected flight envelope.');
    }
    if (Number.isInteger(packet?.rssi_dbm) && packet.rssi_dbm < -110) {
      warnings.push('Radio RSSI is very weak; expect packet loss.');
    }
    if (!Number.isFinite(packet.temp_c_1) || !Number.isFinite(packet.temp_c_2) || !Number.isFinite(packet.temp_c_3) || !Number.isFinite(packet.temp_c_4)) {
      warnings.push('One or more LM75 temperature sensors failed to report.');
    }
    return warnings;
  }

  if (missionMode === 'PRE_DEPLOY') {
    warnings.push('CanSat is in PRE_DEPLOY; RF may be shielded by the rocket shell until deployment.');
  }

  if (gpsRecovery) {
    warnings.push('CanSat is in GPS_RECOVERY; non-GPS sensors and SD writes are intentionally quiet.');
    if (!flags.gps_fix) warnings.push('GPS recovery mode is active but NEO-6M GPS fix is not set yet.');
  } else {
    if (!flags.bmp_ok) warnings.push('BMP388 flag is not set; altitude, pressure, and temperature may be fallback values.');
    if (!flags.mpu_ok) warnings.push('MPU-6500 flag is not set; acceleration and gyro data may be fallback values.');
    if (!flags.sd_ok) warnings.push('SD card flag is not set; onboard recovery log may be unavailable.');
  }

  if (Number.isFinite(packet?.pressure_hpa) && packet.pressure_hpa < 300) {
    warnings.push('Pressure is unusually low for the expected CanSat flight envelope.');
  }
  if (Number.isFinite(packet?.accel_z) && Math.abs(packet.accel_z) > 25) {
    warnings.push('Acceleration is outside normal mission bounds; check MPU-6500 mounting or packet corruption.');
  }
  if (Number.isInteger(packet?.rssi_dbm) && packet.rssi_dbm < -110) {
    warnings.push('RFM69 RSSI is very weak; expect packet loss.');
  }

  return warnings;
}

module.exports = {
  CIRCUIT,
  NRC_PAYLOAD_CIRCUIT,
  RIDESHARE_PAYLOAD_CIRCUIT: NRC_PAYLOAD_CIRCUIT,
  CANSAT_MISSION_MODES,
  CANSAT_MISSION_MODE_NAMES,
  CANSAT_SOURCE_ID,
  FLAG_BITS,
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_V2_LENGTH_BYTES,
  PACKET_V3_LENGTH_BYTES,
  PACKET_V3_PAYLOAD_LENGTH_BYTES,
  PACKET_V3_VERSION,
  PACKET_VERSION,
  TELEMETRY_LIMITS,
  crc16Ccitt,
  decodeFlags,
  deriveSensorHealth,
  packetWarnings,
  xorChecksum
};
