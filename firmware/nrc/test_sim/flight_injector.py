#!/usr/bin/env python3
"""
NRC Interactive Flight Injector — FRR Bench-Test Simulator
==========================================================
Creates a virtual serial port on macOS and feeds realistic NRC2: telemetry
packets into the backend at 1 Hz. Keyboard hotkeys control the flight profile.

Usage:
    python3 flight_injector.py

Requires:  Python 3.8+, macOS (uses pty for virtual serial)
No external pip packages needed — stdlib only.
"""

import os
import pty
import sys
import time
import tty
import termios
import select
import random

# ==============================================================================
# CRC16-CCITT CHECKSUM  (mirrors backend/cansat-hardware.js crc16Ccitt exactly)
# ==============================================================================
def crc16_ccitt(data: str) -> int:
    crc = 0xFFFF
    for char in data.encode('utf-8'):
        crc ^= (char << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
            crc &= 0xFFFF
    return crc

# ==============================================================================
# FLIGHT DYNAMICS SIMULATOR
# ==============================================================================
class FlightSimulator:
    def __init__(self):
        self.packet_id = 0
        self.start_time = int(time.time() * 1000)
        self.altitude = 0.0
        self.max_altitude = 0.0
        self.temperature = 22.50
        self.pressure = 1013.25
        self.latitude = 25.1297     # Dubai Outsource City coordinates
        self.longitude = 55.4306
        self.flags = 0x2C           # FLAG_GPS_FIX | FLAG_BARO_OK | FLAG_SD_OK
        self.rssi = -55
        self.state = "PRE_FLIGHT"
        self.descent_started = False

    def build_packet(self):
        """Format the telemetry body, compute CRC, return full NRC2: line."""
        self.packet_id += 1
        current_time = int(time.time() * 1000) - self.start_time

        body = (
            f"{self.packet_id},{current_time},"
            f"{self.altitude:.2f},{self.temperature:.2f},{self.pressure:.2f},"
            f"{self.latitude:.6f},{self.longitude:.6f},"
            f"{self.rssi},{self.flags}"
        )
        crc = crc16_ccitt(body)
        return f"NRC2:{body},{crc:04X}\n"

    def tick(self, key_press):
        """Advance the simulation by one second, applying any key command."""

        # ── Key 1: Reset to pad ──────────────────────────────────────────
        if key_press == '1':
            self.state = "PRE_FLIGHT"
            self.altitude = 0.0
            self.max_altitude = 0.0
            self.pressure = 1013.25
            self.temperature = 22.50
            self.flags = 0x2C
            self.descent_started = False
            print("\n  ▶ [STATE] PRE_FLIGHT — On pad, 0.0m, sensors nominal")

        # ── Key 2: Bench lift (10-15 ft / 3-4.5m) ───────────────────────
        elif key_press == '2':
            self.state = "BENCH_LIFT"
            print("\n  ▶ [STATE] BENCH LIFT — Simulating 10-15 ft physical lift")

        # ── Key 3: Apogee lock ───────────────────────────────────────────
        elif key_press == '3':
            self.state = "APOGEE"
            self.flags |= 0x03  # FLAG_LAUNCHED | FLAG_APOGEE
            self.descent_started = True
            print(f"\n  ▶ [STATE] APOGEE — Peak locked at {self.max_altitude:.2f}m, descending")

        # ── Key 4: Landed ────────────────────────────────────────────────
        elif key_press == '4':
            self.state = "LANDED"
            self.altitude = 0.10 + random.uniform(-0.05, 0.05)
            self.pressure = 1013.25 + random.uniform(-0.1, 0.1)
            self.flags |= 0x03
            print(f"\n  ▶ [STATE] LANDED — Ground level, OLED locked at MAX: {self.max_altitude:.2f}m")

        # ── Key 6: Toggle BMP280 sensor failure ──────────────────────────
        elif key_press == '6':
            if self.flags & 0x40:
                self.flags &= ~0x40
                self.temperature = 22.50
                print("\n  ▶ [SENSOR] BMP280 recovered — primary temperature restored")
            else:
                self.flags |= 0x40
                self.temperature = 23.80  # LM75 fallback reading
                print("\n  ▶ [SENSOR] BMP280 FAILED — hot-swapped to LM75 (23.80°C)")

        # ── Physics per state ────────────────────────────────────────────
        if self.state == "PRE_FLIGHT":
            # Small sensor noise on the pad
            self.altitude = random.uniform(-0.15, 0.15)
            self.pressure = 1013.25 + random.uniform(-0.08, 0.08)

        elif self.state == "BENCH_LIFT":
            # Gradually rise to 3-4.5m over ~5 ticks, then hold
            target = random.uniform(3.0, 4.5)
            if self.altitude < target:
                self.altitude += random.uniform(0.5, 1.2)
                self.pressure -= random.uniform(0.03, 0.06)
            else:
                self.altitude += random.uniform(-0.1, 0.1)  # Hold with noise
            if self.altitude > 3.0:
                self.flags |= 0x01  # FLAG_LAUNCHED triggers at >3m sustained

            if self.altitude > self.max_altitude:
                self.max_altitude = self.altitude

        elif self.state == "APOGEE":
            # Slow parachute descent
            self.altitude -= random.uniform(1.5, 3.0)
            self.pressure += random.uniform(0.1, 0.3)
            if self.altitude < 0.5:
                self.state = "LANDED"
                self.altitude = 0.10
                self.pressure = 1013.25

        elif self.state == "LANDED":
            self.altitude = 0.10 + random.uniform(-0.05, 0.05)
            self.pressure = 1013.25 + random.uniform(-0.1, 0.1)

        # Clamp altitude floor
        if self.altitude < -0.5:
            self.altitude = 0.0

        # Track max
        if self.altitude > self.max_altitude:
            self.max_altitude = self.altitude

        # Add subtle RSSI jitter
        self.rssi = -55 + random.randint(-8, 4)

        return self.build_packet()


# ==============================================================================
# NON-BLOCKING KEYBOARD
# ==============================================================================
def get_key():
    if select.select([sys.stdin], [], [], 0) == ([sys.stdin], [], []):
        return sys.stdin.read(1)
    return None


# ==============================================================================
# MAIN
# ==============================================================================
def main():
    print("=" * 62)
    print("   NRC FLIGHT INJECTOR  —  FRR Bench-Test Simulator v1.0")
    print("=" * 62)

    # Create virtual serial port pair
    master, slave = pty.openpty()
    slave_name = os.ttyname(slave)

    symlink_path = "/dev/tty.virtual-nrc"
    if os.path.exists(symlink_path):
        os.remove(symlink_path)

    try:
        os.symlink(slave_name, symlink_path)
        print(f"\n  ✅ Virtual serial port: {symlink_path}")
        print(f"     Backend .env needs:  SERIAL_PORT_NRC={symlink_path}")
    except Exception as e:
        print(f"\n  ⚠️  Symlink failed ({e}), use raw device: {slave_name}")

    print("\n" + "-" * 62)
    print("  KEYBOARD CONTROLS:")
    print("    [1]  PRE-FLIGHT   — Reset to pad (0m, all sensors OK)")
    print("    [2]  BENCH LIFT   — Physical 10-15 ft lift simulation")
    print("    [3]  APOGEE       — Lock peak altitude, begin descent")
    print("    [4]  LANDED       — Return to ground, freeze OLED")
    print("    [5]  WDT HANG     — Freeze TX for 5s (watchdog test)")
    print("    [6]  SENSOR FAIL  — Toggle BMP280 failure / LM75 swap")
    print("    [Q]  QUIT")
    print("-" * 62)
    print("  Transmitting at 1 Hz...\n")

    old_settings = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin.fileno())
        sim = FlightSimulator()

        while True:
            key = get_key()

            if key in ('q', 'Q'):
                print("\n\n  [SIMULATOR] Shutting down gracefully...")
                break

            if key == '5':
                print("\n  ⚠️  [WDT] Freezing transmissions for 5 seconds...")
                time.sleep(5)
                print("  ✅ [WDT] Watchdog triggered reboot — resuming TX")
                key = None

            packet = sim.tick(key)

            # Feed into virtual serial port
            os.write(master, packet.encode('utf-8'))

            # Console feedback
            state_tag = sim.state.ljust(12)
            alt_str = f"{sim.altitude:7.2f}m"
            max_str = f"MAX:{sim.max_altitude:.2f}m"
            flags_hex = f"0x{sim.flags:02X}"
            sys.stdout.write(
                f"\r  [{state_tag}] ALT:{alt_str}  {max_str}  FLAGS:{flags_hex}  PKT:{sim.packet_id}   "
            )
            sys.stdout.flush()

            time.sleep(1.0)

    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        if os.path.exists(symlink_path):
            os.remove(symlink_path)
        print("\n  [SIMULATOR] Virtual port cleaned up. Goodbye.\n")


if __name__ == '__main__':
    main()
