#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# INVICTUS II — Fake Heltec LoRa V3 Demo Script
# ─────────────────────────────────────────────────────────────────────────
# Simulates PlatformIO build → USB-C upload → Serial Monitor output
# Looks exactly like real hardware connected via USB-C
# Run:  bash scripts/fake_heltec_demo.sh
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ── ANSI Colors ──────────────────────────────────────────────────────────
BOLD="\033[1m"
GREEN="\033[32m"
CYAN="\033[36m"
YELLOW="\033[33m"
MAGENTA="\033[35m"
RED="\033[31m"
DIM="\033[2m"
RESET="\033[0m"

# ── CRC16-CCITT matching firmware crc16Ccitt() ──────────────────────────
crc16() {
    local data="$1"
    local crc=65535  # 0xFFFF
    for (( i=0; i<${#data}; i++ )); do
        local byte=$(printf '%d' "'${data:$i:1}")
        crc=$(( (crc ^ (byte << 8)) & 0xFFFF ))
        for (( b=0; b<8; b++ )); do
            if (( crc & 0x8000 )); then
                crc=$(( ((crc << 1) ^ 0x1021) & 0xFFFF ))
            else
                crc=$(( (crc << 1) & 0xFFFF ))
            fi
        done
    done
    printf '%04X' "$crc"
}

slow_print() {
    local text="$1"
    local delay="${2:-0.02}"
    for (( i=0; i<${#text}; i++ )); do
        printf '%s' "${text:$i:1}"
        sleep "$delay"
    done
    echo
}

type_line() {
    local text="$1"
    local delay="${2:-0.008}"
    for (( i=0; i<${#text}; i++ )); do
        printf '%s' "${text:$i:1}"
        sleep "$delay"
    done
    echo
}

# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 1: PlatformIO Build
# ═══════════════════════════════════════════════════════════════════════════
printf '\033[2J\033[H'
echo ""
echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║       INVICTUS II — NRC Payload Firmware Build & Test        ║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
sleep 0.5

echo -e "${DIM}\$ cd firmware/nrc${RESET}"
sleep 0.3
echo -e "${DIM}\$ pio run --target upload${RESET}"
echo ""
sleep 0.5

echo -e "${GREEN}Processing heltec_wifi_lora_32_V3 (platform: espressif32; board: heltec_wifi_lora_32_V3; framework: arduino)${RESET}"
echo "──────────────────────────────────────────────────────────────────"
sleep 0.3

echo -e "${CYAN}Verbose mode can be enabled via \`-v, --verbose\` option${RESET}"
echo -e "CONFIGURATION: https://docs.platformio.org/page/boards/espressif32/heltec_wifi_lora_32_V3.html"
sleep 0.2
echo -e "PLATFORM: Espressif 32 (6.9.0) > Heltec WiFi LoRa 32 (V3)"
echo -e "HARDWARE: ESP32S3 240MHz, 320KB RAM, 8MB Flash"
sleep 0.2
echo -e "DEBUG: Current (esp-builtin) On-board (esp-builtin) External (cmsis-dap, esp-bridge, esp-prog, iot-bus-jtag, jlink, minimodule, olimex-arm-usb-ocd, olimex-arm-usb-ocd-h, olimex-arm-usb-tiny-h, olimex-jtag-tiny, tumpa)"
sleep 0.1

echo -e "PACKAGES:"
echo -e " - framework-arduinoespressif32 @ 3.1.0+sha.8a083f9"
echo -e " - tool-esptoolpy @ 4.8.1"
echo -e " - toolchain-riscv32-esp @ 13.2.0+20240530"
echo -e " - toolchain-xtensa-esp-elf @ 13.2.0+20240530"
sleep 0.2

echo ""
echo -e "${YELLOW}LDF: Library Dependency Finder -> https://bit.ly/configure-pio-ldf${RESET}"
echo -e "LDF Modes: Finder ~ chain, Compatibility ~ soft"
sleep 0.3

echo -e "Found 38 compatible libraries"
echo -e "Scanning dependencies..."
libs=("RadioLib@6.6.0" "Adafruit BMP280 Library@2.6.8" "Adafruit Unified Sensor@1.1.14" "TinyGPSPlus@1.0.3" "U8g2@2.35.19" "SPI@2.0.0" "Wire@2.0.0" "SD@2.0.0")
for lib in "${libs[@]}"; do
    echo -e "Dependency Graph: |-- ${GREEN}${lib}${RESET}"
    sleep 0.06
done

echo ""
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/src/main.cpp.o"
sleep 0.4
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/lib349/RadioLib/SX126x.cpp.o"
sleep 0.15
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/lib349/RadioLib/Module.cpp.o"
sleep 0.1
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/lib4a2/Adafruit_BMP280/Adafruit_BMP280.cpp.o"
sleep 0.08
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/lib511/TinyGPSPlus/TinyGPS++.cpp.o"
sleep 0.08
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/libfc3/U8g2/u8g2_d_setup.c.o"
sleep 0.06
echo "Compiling .pio/build/heltec_wifi_lora_32_V3/libfc3/U8g2/u8x8_d_ssd1306_128x64.c.o"
sleep 0.06
echo "Archiving .pio/build/heltec_wifi_lora_32_V3/libRadioLib.a"
sleep 0.05
echo "Archiving .pio/build/heltec_wifi_lora_32_V3/libAdafruit_BMP280.a"
sleep 0.03
echo "Archiving .pio/build/heltec_wifi_lora_32_V3/libTinyGPSPlus.a"
sleep 0.03
echo "Archiving .pio/build/heltec_wifi_lora_32_V3/libU8g2.a"
sleep 0.03
echo "Linking .pio/build/heltec_wifi_lora_32_V3/firmware.elf"
sleep 0.3

echo -e "Building .pio/build/heltec_wifi_lora_32_V3/firmware.bin"
sleep 0.2
echo -e "Retrieving maximum program size .pio/build/heltec_wifi_lora_32_V3/firmware.elf"
sleep 0.1
echo -e "Checking size .pio/build/heltec_wifi_lora_32_V3/firmware.elf"
echo -e "${GREEN}Advanced Memory Usage is available via \"PlatformIO Home > Inspect\"${RESET}"

# Realistic memory usage
echo -e "RAM:   [==        ]  ${BOLD}17.2%${RESET} (used 56432 bytes from 327680 bytes)"
echo -e "Flash: [====      ]  ${BOLD}43.8%${RESET} (used 571280 bytes from 1310720 bytes)"
sleep 0.5

# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 2: USB Upload
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo -e "${BOLD}${YELLOW}Configuring upload protocol...${RESET}"
echo "CURRENT: upload_protocol = esptool"
echo "CURRENT: upload_port = /dev/cu.usbmodem14201"
echo "CURRENT: upload_speed = 921600"
sleep 0.3

echo ""
echo -e "${BOLD}Looking for upload port...${RESET}"
sleep 0.4
echo "Auto-detected: /dev/cu.usbmodem14201"
sleep 0.2

echo ""
echo -e "${CYAN}Uploading .pio/build/heltec_wifi_lora_32_V3/firmware.bin${RESET}"
echo "esptool.py v4.8.1"
echo "Serial port /dev/cu.usbmodem14201"
echo "Connecting.........done."
sleep 0.3
echo "Chip is ESP32-S3 (QFN56) (revision v0.2)"
echo "Features: WiFi, BLE, IEEE 802.15.4"
echo "Crystal is 40MHz"
echo "MAC: 34:85:18:ab:72:fc"
sleep 0.2
echo "Uploading stub..."
echo "Running stub..."
echo "Stub running..."
sleep 0.3
echo -e "Changing baud rate to ${BOLD}921600${RESET}"
echo "Changed."

# Upload progress bar
echo ""
echo -n "Writing at 0x00010000... "
for pct in 10 22 35 48 57 66 75 84 91 100; do
    echo -ne "(${pct} %)\r"
    echo -n "Writing at 0x00010000... "
    sleep 0.12
done
echo "(100 %)"

echo -n "Writing at 0x00008000... "
echo "(100 %)"
sleep 0.1
echo -n "Writing at 0x0000e000... "
echo "(100 %)"
sleep 0.1

echo ""
echo -e "Hash of data verified."
echo ""
echo -e "${GREEN}Leaving...${RESET}"
echo "Hard resetting via RTS pin..."
sleep 0.5

echo ""
echo -e "${GREEN}${BOLD}============ [SUCCESS] Took 12.54 seconds ============${RESET}"
sleep 1.0

# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 3: Serial Monitor (115200 baud)
# ═══════════════════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════════════"
echo -e "${DIM}\$ pio device monitor --baud 115200${RESET}"
echo ""
sleep 0.5

echo -e "${CYAN}--- Terminal on /dev/cu.usbmodem14201 | 115200 8-N-1${RESET}"
echo -e "${CYAN}--- Available filters and text transformations: colorize, debug, default, direct, hexlify, log2file, nocontrol, printable, send_on_enter, time${RESET}"
echo -e "${CYAN}--- More details at https://bit.ly/pio-monitor-filters${RESET}"
echo -e "${CYAN}--- Quit: Ctrl+C | Menu: Ctrl+T | Help: Ctrl+T followed by Ctrl+H${RESET}"
sleep 0.8

# ESP32-S3 boot ROM output
echo ""
echo -e "${DIM}ESP-ROM:esp32s3-20210327${RESET}"
echo -e "${DIM}Build:Mar 27 2021${RESET}"
echo -e "${DIM}rst:0x1 (POWERON),boot:0x8 (SPI_FAST_FLASH_BOOT)${RESET}"
echo -e "${DIM}SPIWP:0xee${RESET}"
echo -e "${DIM}mode:DIO, clock div:1${RESET}"
echo -e "${DIM}load:0x3fce2810,len:0x178c${RESET}"
echo -e "${DIM}load:0x403c8700,len:0x4${RESET}"
echo -e "${DIM}load:0x403ca710,len:0x2e68${RESET}"
echo -e "${DIM}entry 0x403c88ac${RESET}"
sleep 0.5

# Boot messages — exactly matching setup() in main.cpp
echo ""
echo -e "${GREEN}[NRC] LoRa SX1262 OK @ 868 MHz${RESET}"
sleep 0.3
echo -e "${GREEN}[NRC] GPS UART1 started${RESET}"
sleep 0.2
echo -e "${GREEN}[NRC] BMP280 OK @ 0x76${RESET}"
sleep 0.2
echo -e "${GREEN}[NRC] LM75 OK (27.4°C)${RESET}"
sleep 0.2
echo -e "${GREEN}[NRC] SD card OK${RESET}"
sleep 0.3
echo -e "${GREEN}[NRC] Setup complete — transmitting at 1 Hz${RESET}"
echo ""
sleep 0.8

# ═══════════════════════════════════════════════════════════════════════════
#  PHASE 4: Live NRC2 Telemetry Stream
# ═══════════════════════════════════════════════════════════════════════════

# Baseline values (pre-launch, on ground in UK)
BASE_PRESS=1014.23
BASE_TEMP=18.7
BASE_LAT="52.486243"
BASE_LON="-1.890401"

pkt=0
ts=1247       # ms since boot (after setup)
alt=0.00
max_alt=0.00
temp=$BASE_TEMP
press=$BASE_PRESS
rssi=-42      # Strong USB-nearby signal
flags=40      # FLAG_BARO_OK(0x08) + FLAG_SD_OK(0x20) = 0x28 = 40

echo -e "${DIM}── Live telemetry stream (NRC2 packets @ 1 Hz) ──${RESET}"
echo ""

# Pre-launch: ~15 packets on ground with slight sensor noise
for i in $(seq 1 15); do
    pkt=$((pkt + 1))
    ts=$((ts + 1000 + RANDOM % 6))

    # Small altitude noise ±0.05m
    noise=$(echo "scale=2; ($RANDOM % 10 - 5) / 100" | bc)
    alt=$(echo "scale=2; 0 + $noise" | bc)
    
    # Tiny temperature drift
    temp_noise=$(echo "scale=1; ($RANDOM % 4 - 2) / 10" | bc)
    temp=$(echo "scale=1; $BASE_TEMP + $temp_noise" | bc)
    
    # Pressure drift
    press_noise=$(echo "scale=2; ($RANDOM % 6 - 3) / 100" | bc)
    press=$(echo "scale=2; $BASE_PRESS + $press_noise" | bc)

    # GPS fix arrives at packet 4
    if [ $pkt -ge 4 ]; then
        lat_noise=$(echo "scale=6; ($RANDOM % 10) / 1000000" | bc)
        lon_noise=$(echo "scale=6; ($RANDOM % 10) / 1000000" | bc)
        lat=$(echo "scale=6; $BASE_LAT + $lat_noise" | bc)
        lon=$(echo "scale=6; $BASE_LON + $lon_noise" | bc)
        flags=44   # GPS(0x04) + BARO(0x08) + SD(0x20) = 44
    else
        lat="0.000000"
        lon="0.000000"
        flags=40
    fi

    body="${pkt},${ts},${alt},${temp},${press},${lat},${lon},${rssi},${flags}"
    crc=$(crc16 "$body")
    echo -e "NRC2:${body},${crc}"
    sleep 1
done

# Simulate launch detection — altitude climbing rapidly
echo ""
echo -e "${YELLOW}── Launch detected! Altitude climbing ──${RESET}"
echo ""

launch_alts=(12.34 28.71 47.89 65.32 83.18 101.47 118.92 134.56 148.23 159.81 168.45 174.12 177.89 179.34 179.91 179.52 177.84 174.21)
for climb_alt in "${launch_alts[@]}"; do
    pkt=$((pkt + 1))
    ts=$((ts + 1000 + RANDOM % 8))
    alt=$climb_alt
    
    # Track max altitude
    if (( $(echo "$alt > $max_alt" | bc -l) )); then
        max_alt=$alt
    fi
    
    # Temperature drops with altitude (~6.5°C per 1000m)
    temp=$(echo "scale=1; $BASE_TEMP - ($alt * 6.5 / 1000)" | bc)
    
    # Pressure drops with altitude
    press=$(echo "scale=2; $BASE_PRESS - ($alt * 0.12)" | bc)
    
    lat_noise=$(echo "scale=6; ($RANDOM % 30) / 1000000" | bc)
    lon_noise=$(echo "scale=6; ($RANDOM % 30) / 1000000" | bc)
    lat=$(echo "scale=6; $BASE_LAT + $lat_noise" | bc)
    lon=$(echo "scale=6; $BASE_LON + $lon_noise" | bc)
    
    # FLAG_LAUNCHED(0x01) + GPS(0x04) + BARO(0x08) + SD(0x20) = 45
    # After apogee add FLAG_APOGEE(0x02) = 47
    if (( $(echo "$alt < $max_alt - 5" | bc -l) )); then
        flags=47   # Apogee detected
    else
        flags=45   # Launched, ascending
    fi
    
    rssi=$(( -38 - (RANDOM % 25) ))
    
    body="${pkt},${ts},${alt},${temp},${press},${lat},${lon},${rssi},${flags}"
    crc=$(crc16 "$body")
    echo -e "${GREEN}NRC2:${body},${crc}${RESET}"
    sleep 1
done

# Descent packets
echo ""
echo -e "${MAGENTA}── Apogee reached! Deploying recovery ──${RESET}"
echo ""

descent_alts=(172.45 165.12 155.78 144.23 131.87 118.45 104.12 89.67 74.23 58.91 43.56 28.12 15.78 6.34 1.23 0.12)
for desc_alt in "${descent_alts[@]}"; do
    pkt=$((pkt + 1))
    ts=$((ts + 1000 + RANDOM % 8))
    alt=$desc_alt
    
    temp=$(echo "scale=1; $BASE_TEMP - ($alt * 6.5 / 1000)" | bc)
    press=$(echo "scale=2; $BASE_PRESS - ($alt * 0.12)" | bc)
    
    lat_noise=$(echo "scale=6; ($RANDOM % 50) / 1000000" | bc)
    lon_noise=$(echo "scale=6; ($RANDOM % 50) / 1000000" | bc)
    lat=$(echo "scale=6; $BASE_LAT + $lat_noise" | bc)
    lon=$(echo "scale=6; $BASE_LON - $lon_noise" | bc)
    
    flags=47   # LAUNCHED + APOGEE + GPS + BARO + SD
    rssi=$(( -40 - (RANDOM % 20) ))
    
    body="${pkt},${ts},${alt},${temp},${press},${lat},${lon},${rssi},${flags}"
    crc=$(crc16 "$body")
    echo -e "${CYAN}NRC2:${body},${crc}${RESET}"
    sleep 1
done

# Final landed packets
echo ""
echo -e "${GREEN}${BOLD}── Landed! Final telemetry ──${RESET}"
echo ""

for i in $(seq 1 5); do
    pkt=$((pkt + 1))
    ts=$((ts + 1000 + RANDOM % 6))
    
    noise=$(echo "scale=2; ($RANDOM % 6 - 3) / 100" | bc)
    alt=$(echo "scale=2; 0.1 + $noise" | bc)
    temp=$BASE_TEMP
    press=$BASE_PRESS
    
    lat_noise=$(echo "scale=6; ($RANDOM % 5) / 1000000" | bc)
    lon_noise=$(echo "scale=6; ($RANDOM % 5) / 1000000" | bc)
    lat=$(echo "scale=6; $BASE_LAT + $lat_noise" | bc)
    lon=$(echo "scale=6; $BASE_LON - $lon_noise" | bc)
    
    flags=47
    rssi=-41
    
    body="${pkt},${ts},${alt},${temp},${press},${lat},${lon},${rssi},${flags}"
    crc=$(crc16 "$body")
    echo "NRC2:${body},${crc}"
    sleep 1
done

echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Flight complete — Max altitude: ${max_alt}m | ${pkt} packets transmitted${RESET}"
echo -e "${GREEN}${BOLD}  SD log saved: /flight.csv (${pkt} rows)${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "${DIM}--- exit --- (Ctrl+C to close monitor)${RESET}"
