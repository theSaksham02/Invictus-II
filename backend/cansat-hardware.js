const LEGACY_PACKET_LENGTH_BYTES = 37;
const PACKET_LENGTH_BYTES = 43;
const PACKET_SYNC = 0xa55a;
const PACKET_VERSION = 2;
const CANSAT_SOURCE_ID = 1;
const PACKET_PAYLOAD_LENGTH_BYTES = 36;

const FLAG_BITS = Object.freeze({
  launched: 0x01,
  apogee: 0x02,
  gps_fix: 0x04,
  bmp_ok: 0x08,
  mpu_ok: 0x10,
  sd_ok: 0x20,
  stale_sensor: 0x40
});

const CIRCUIT = Object.freeze({
  name: 'INVICTUS II CANSAT',
  controller: 'STM32 Bluepill',
  telemetry_packet_bytes: PACKET_LENGTH_BYTES,
  legacy_packet_bytes: LEGACY_PACKET_LENGTH_BYTES,
  packet_sync: `0x${PACKET_SYNC.toString(16).toUpperCase()}`,
  packet_version: PACKET_VERSION,

  // Ground Station Receiver — ESP32 WROOM-32 + RFM69HCW 433 MHz
  // The ESP32 bridges the RFM69 radio to the laptop via USB Serial (115200 baud).
  // It is NOT a bare USB dongle — it is a dedicated microcontroller that:
  //   1. Receives 43-byte binary packets over SPI from the RFM69HCW
  //   2. Validates the 0xA55A sync word before forwarding
  //   3. Stamps ground-side RSSI into byte 39 of the frame
  //   4. Forwards the raw frame over USB CDC to the laptop (serial.js reads it)
  ground_station_receiver: {
    mcu: 'ESP32 WROOM-32',
    radio: 'RFM69HCW 433 MHz',
    interface: 'USB Serial (CP2102/CH340) @ 115200 baud',
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
      devices: ['SDCardSlot1']
    },
    avionics_spi: {
      pins: { sck: 'PB13', miso: 'PB14', mosi: 'PB15' },
      devices: [
        { name: 'RFM69HCW1', cs: 'PA15', irq: 'PB5' },
        { name: 'MPU-6500', cs: 'PB12', irq: 'PA8' }
      ]
    },
    i2c: {
      pins: { scl: 'PB6', sda: 'PB7' },
      devices: ['BMP388', 'LM75-U1', 'LM75-U2', 'LM75-U3', 'LM75-U4'],
      note: 'BMP388 is wired in I2C mode by tying CS high and SDO low; LM75 address pins are not documented in CANSAT_CIRCUIT.md.'
    },
    gps_uart: {
      pins: { stm32_rx: 'PB11', stm32_tx: 'PB10' },
      device: 'NEO-6M'
    },
    camera_uart: {
      pins: { stm32_rx: 'PA10', stm32_tx: 'PA9' },
      device: 'ESP32-CAM1'
    }
  },
  power: {
    system: 'TP4056 OUT+ -> SYS_POWER',
    five_volt: 'SYS_POWER -> XL6009 -> 5V_BUS',
    three_v_three: '5V_BUS -> AMS1117 -> 3V3_BUS',
    protection: 'D1 between 3V3_BUS and 5V_BUS, pointed toward 5V_BUS'
  },
  packet_fields: [
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

const TELEMETRY_LIMITS = Object.freeze({
  pkt_id: { min: 0, max: 65535 },
  timestamp_ms: { min: 0, max: 0xffffffff },
  altitude_m: { min: -500, max: 50000 },
  temp_c: { min: -80, max: 125 },
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
  if (packet?.source === 'NRC') {
    return {
      bmp280: {
        ok: flags.bmp_ok && Number.isFinite(packet.pressure_hpa) && Number.isFinite(packet.altitude_m),
        bus: 'i2c',
        pins: { sda: 'GPIO1', scl: 'GPIO2' }
      },
      neo6m: {
        ok: flags.gps_fix && Number.isFinite(packet.lat) && Number.isFinite(packet.lon),
        bus: 'uart1',
        pins: { rx: 'GPIO7', tx: 'GPIO6' }
      },
      sd_card: {
        ok: flags.sd_ok,
        bus: 'spi',
        pins: { cs: 'GPIO38', sck: 'GPIO39', mosi: 'GPIO41', miso: 'GPIO42' }
      },
      lora: {
        ok: Number.isInteger(packet.rssi_dbm) && packet.rssi_dbm >= TELEMETRY_LIMITS.rssi_dbm.min,
        bus: 'internal_spi',
        pins: { cs: 'GPIO8', dio1: 'GPIO14', rst: 'GPIO12', busy: 'GPIO13' }
      }
    };
  }

  return {
    bmp388: {
      ok: flags.bmp_ok && Number.isFinite(packet.pressure_hpa) && Number.isFinite(packet.altitude_m),
      bus: 'i2c',
      pins: CIRCUIT.buses.i2c.pins
    },
    mpu6500: {
      ok: flags.mpu_ok && Number.isFinite(packet.accel_z) && Number.isFinite(packet.gyro_x),
      bus: 'avionics_spi',
      pins: CIRCUIT.buses.avionics_spi.pins
    },
    neo6m: {
      ok: flags.gps_fix && Number.isFinite(packet.lat) && Number.isFinite(packet.lon),
      bus: 'gps_uart',
      pins: CIRCUIT.buses.gps_uart.pins
    },
    sd_card: {
      ok: flags.sd_ok,
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

  if (packet?.source === 'NRC') {
    if (!flags.bmp_ok) warnings.push('BMP280 flag is not set; altitude, pressure, and temperature may be fallback values.');
    if (!flags.gps_fix) warnings.push('NEO-6M GPS fix flag is not set; latitude and longitude may be stale or zero.');
    if (!flags.sd_ok) warnings.push('SD card flag is not set; onboard recovery log may be unavailable.');
    if (Number.isFinite(packet?.pressure_hpa) && packet.pressure_hpa < 300) {
      warnings.push('Pressure is unusually low for the expected NRC flight envelope.');
    }
    if (Number.isInteger(packet?.rssi_dbm) && packet.rssi_dbm < -110) {
      warnings.push('LoRa RSSI is very weak; expect packet loss.');
    }
    return warnings;
  }

  if (!flags.bmp_ok) warnings.push('BMP388 flag is not set; altitude, pressure, and temperature may be fallback values.');
  if (!flags.mpu_ok) warnings.push('MPU-6500 flag is not set; acceleration and gyro data may be fallback values.');
  if (!flags.gps_fix) warnings.push('NEO-6M GPS fix flag is not set; latitude and longitude may be stale or zero.');
  if (!flags.sd_ok) warnings.push('SD card flag is not set; onboard recovery log may be unavailable.');

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
  CANSAT_SOURCE_ID,
  FLAG_BITS,
  LEGACY_PACKET_LENGTH_BYTES,
  PACKET_LENGTH_BYTES,
  PACKET_PAYLOAD_LENGTH_BYTES,
  PACKET_SYNC,
  PACKET_VERSION,
  TELEMETRY_LIMITS,
  crc16Ccitt,
  decodeFlags,
  deriveSensorHealth,
  packetWarnings,
  xorChecksum
};
