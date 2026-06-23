# INVICTUS II CanSat Circuit

This file is the source-of-truth wiring map for the STM32 Bluepill CanSat payload.

## Components

| Qty | Component | Purpose |
|---:|---|---|
| 4 | LM75 | Distributed temperature sensing |
| 1 | BMP388 | Barometric altitude, pressure, and temperature |
| 1 | RFM69HCW | 433 MHz telemetry radio |
| 1 | NEO-6M | GPS position |
| 1 | SDCardModule | Onboard recovery log |
| 1 | STM32 Bluepill | Flight computer |
| 1 | MPU6500 | IMU acceleration and gyro |
| 1 | XL6009 | Boost converter to 5V_BUS |
| 1 | AMS1117 | 3.3V regulator |
| 1 | TP4056 | USB-C/solar LiPo charge and battery interface |
| 4 | Solar panel modules | Charge input |
| 1 | 100nF capacitor | 5V rail decoupling |
| 1 | 1000uF capacitor | 5V rail bulk capacitance |
| 1 | 150 ohm resistor | Red LED current limiting |
| 1 | 1N4007 diode | Rail protection between 3V3_BUS and 5V_BUS |
| 1 | ESP32-CAM | Independent camera, UART wired for future trigger/status |
| 1 | Buzzer | Audible status |
| 1 | Red LED | Visual status |

## Power

### TP4056

- `VIN+` / `VIN-`: USB-C charging input and solar panel `+` / `-` input.
- `BAT+` / `BAT-`: LiPo battery through JST connector.
- `OUT-`: `GROUND`.
- `OUT+`: switch input; switch output is `SYS_POWER`.

### XL6009

- `IN+`: `SYS_POWER`.
- `IN-`: `GROUND`.
- `OUT-`: `GROUND`.
- `OUT+`: `5V_BUS`.
- A `100nF` capacitor and a `1000uF` capacitor are connected in parallel from `5V_BUS` to `GROUND`.

### AMS1117

- `VIN`: `5V_BUS`.
- `VOUT`: `3V3_BUS`.
- `GND`: `GROUND`.
- `1N4007`: between `3V3_BUS` and `5V_BUS`, with the cathode pointed toward `5V_BUS`.

## STM32 Bluepill Pin Ownership

| STM32 pin | Connection |
|---|---|
| `VB` | `3V3_BUS` |
| `3.3V`, `3.3` | `3V3_BUS` |
| all `GND` pins | `GROUND` |
| `A0` | Red LED anode; LED cathode -> `150 ohm` resistor -> `GROUND` |
| `A1` | Buzzer positive; buzzer negative -> `GROUND` |
| `A4` | SDCardModule `CS` |
| `A5` | SDCardModule `CLK` |
| `A6` | SDCardModule `MISO` |
| `A7` | SDCardModule `MOSI` |
| `B5` | RFM69HCW `DIO0` |
| `B6` | I2C `SCL`: BMP388 `SCK`, all LM75 `SCL` |
| `B7` | I2C `SDA`: BMP388 `SDI`, all LM75 `SDA` |
| `B10` | NEO-6M `RX` |
| `B11` | NEO-6M `TX` |
| `A15` | RFM69HCW `NSS` |
| `A10` | ESP32-CAM `U0T` |
| `A9` | ESP32-CAM `U0R` |
| `A8` | MPU-6500 `INT` |
| `B15` | SPI2 `MOSI`: MPU-6500 `SDA`, RFM69HCW `MOSI` |
| `B14` | SPI2 `MISO`: MPU-6500 `ADO`, RFM69HCW `MISO` |
| `B13` | SPI2 `SCK`: MPU-6500 `SCL`, RFM69HCW `SCK` |
| `B12` | MPU-6500 `NCS` |
| `C13`, `C14`, `C15`, `A2`, `A3`, `B1`, `R`, `5V`, `B9`, `B8`, `B4`, `B3`, `A12`, `A11` | Unconnected |

## Sensors And Peripherals

### LM75 x4

- All `Vcc`: `3V3_BUS`.
- All `GND`: `GROUND`.
- All `SCL`: STM32 `B6`.
- All `SDA`: STM32 `B7`.
- All `OS`: unconnected.
- Required I2C addresses: `0x48`, `0x49`, `0x4A`, `0x4C`.

### MPU-6500

- `VCC`: `3V3_BUS`.
- `GND`: `GROUND`.
- `SCL`: STM32 `B13`.
- `SDA`: STM32 `B15`.
- `ADO`: STM32 `B14`.
- `INT`: STM32 `A8`.
- `NCS`: STM32 `B12`.
- `EDA`, `ECL`, `FSYNC`: unconnected.
- Add `4.7uF` and `0.1uF` capacitors in parallel from `VCC` to `GROUND`.

### SDCardModule

- `GND`: `GROUND`.
- `MISO`: STM32 `A6`.
- `CLK`: STM32 `A5`.
- `MOSI`: STM32 `A7`.
- `CS`: STM32 `A4`.
- `3V3`: `3V3_BUS`.

### BMP388

- `VIN`: `3V3_BUS`.
- `3Vo`: unconnected.
- `GND`: `GROUND`.
- `SCK`: STM32 `B6`.
- `SDO`: `GROUND` for I2C address `0x76`.
- `SDI`: STM32 `B7`.
- `CS`: `3V3_BUS`.
- `INT`: unconnected.

### NEO-6M

- `VCC`: `5V_BUS`.
- `RX`: STM32 `B10`.
- `TX`: STM32 `B11`.
- `GND`: `GROUND`.

### RFM69HCW1

- `3.3V`: `3V3_BUS`.
- All `GND`: `GROUND`.
- `MISO`: STM32 `B14`.
- `MOSI`: STM32 `B15`.
- `SCK`: STM32 `B13`.
- `NSS`: STM32 `A15`.
- `DIO0`: STM32 `B5`.
- `RESET`, `DIO1`, `DIO2`, `DIO3`, `DIO4`, `DIO5`: unconnected.
- `ANT`: SMA female connector.
- Frequency: `433.0 MHz`.

### ESP32-CAM

- All three `GND` pins: `GROUND`.
- `U0T`: STM32 `A10`.
- `U0R`: STM32 `A9`.
- `5V`: `5V_BUS`.
- `VCC`, `IO0`, `IO16`, `3V3`, `IO4`, `IO2`, `IO14`, `IO15`, `IO13`, `IO12`: unconnected.
