import os
import pty
import sys
import time
import tty
import termios
import select

# ==============================================================================
# CRC16-CCITT CHECKSUM UTILITY
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
        self.temperature = 22.5
        self.pressure = 1013.25
        self.latitude = 52.4797   # University of Birmingham coordinates
        self.longitude = -1.9268
        self.flags = 0x2C         # Default: FLAG_BARO_OK | FLAG_SD_OK | FLAG_GPS_FIX
        self.rssi = -55
        self.state = "PRE_FLIGHT" # PRE_FLIGHT, POWERED, APOGEE, LANDED
        self.launch_tick = 0
        self.landed_tick = 0

    def update(self, key_press):
        self.packet_id += 1
        current_time = int(time.time() * 1000) - self.start_time

        # State transition handling based on keyboard inputs
        if key_press == '1':
            self.state = "PRE_FLIGHT"
            self.altitude = 0.0
            self.pressure = 1013.25
            self.flags = 0x2C
            print("\n[SIM] State: PRE_FLIGHT Staging Mode")

        elif key_press == '2':
            self.state = "POWERED"
            self.flags |= 0x01  # Set FLAG_LAUNCHED
            print("\n[SIM] State: POWERED FLIGHT initiated")

        elif key_press == '3':
            self.state = "APOGEE"
            self.flags |= 0x03  # Set FLAG_LAUNCHED | FLAG_APOGEE
            self.altitude = 670.56 # ~2200 feet target apogee
            self.max_altitude = 670.56
            self.pressure = 938.50
            print("\n[SIM] State: APOGEE reached (2200 ft target locked)")

        elif key_press == '4':
            self.state = "LANDED"
            self.altitude = 0.2
            self.pressure = 1013.20
            print("\n[SIM] State: LANDED Recovery Mode active")

        elif key_press == '6':
            # Toggle sensor failure
            if self.flags & 0x40:
                self.flags &= ~0x40 # Remove FLAG_STALE_SENSOR
                self.temperature = 22.5
                print("\n[SIM] Sensor status: BMP280 recovered")
            else:
                self.flags |= 0x40 # Set FLAG_STALE_SENSOR
                self.temperature = 23.8 # Switch to secondary LM75 reading
                print("\n[SIM] Sensor status: BMP280 failed. Hot-swapping to LM75 fallback")

        # Dynamic physics simulation
        if self.state == "POWERED":
            self.altitude += 75.0  # Rapid climb
            self.pressure -= 8.5
            if self.altitude > self.max_altitude:
                self.max_altitude = self.altitude
        elif self.state == "APOGEE":
            self.altitude -= 10.5  # Slow parachute descent
            self.pressure += 1.2
            if self.altitude < 10.0:
                self.state = "LANDED"
                self.altitude = 0.0
                self.pressure = 1013.25
        elif self.state == "PRE_FLIGHT":
            self.altitude = 0.0
            self.pressure = 1013.25

        # Format raw telemetry payload
        body = f"{self.packet_id},{current_time},{self.altitude:.2f},{self.temperature:.2f},{self.pressure:.2f},{self.latitude:.6f},{self.longitude:.6f},{self.rssi},{self.flags}"
        crc = crc16_ccitt(body)
        packet = f"NRC2:{body},{crc:04X}\n"
        return packet

# ==============================================================================
# KEYBOARD INPUT HANDLER
# ==============================================================================
def get_key_non_blocking():
    if select.select([sys.stdin], [], [], 0) == ([sys.stdin], [], []):
        return sys.stdin.read(1)
    return None

# ==============================================================================
# MAIN EMULATION ENGINE
# ==============================================================================
def main():
    print("==========================================================")
    print("      NRC FLIGHT SENSORS INTERACTIVE HIL INJECTOR         ")
    print("==========================================================")

    # Open virtual serial terminal pair
    master, slave = pty.openpty()
    slave_name = os.ttyname(slave)
    
    # Create absolute symlink matching the backend config
    symlink_path = "/dev/tty.virtual-nrc"
    if os.path.exists(symlink_path):
        os.remove(symlink_path)
    
    try:
        os.symlink(slave_name, symlink_path)
        print(f"[SIMULATOR] Virtual port established successfully.")
        print(f"[SIMULATOR] Symlink target: {symlink_path}")
        print(f"[SIMULATOR] Ensure backend .env has: SERIAL_PORT_NRC={symlink_path}\n")
    except Exception as e:
        print(f"[WARNING] Could not create symlink: {e}")
        print(f"[SIMULATOR] Configure your backend .env to read directly from: {slave_name}\n")

    print("----------------------------------------------------------")
    print(" KEYBOARD MANUAL CONTROLLER:")
    print("   [1] Reset to PRE-FLIGHT (Staging / 0m)")
    print("   [2] Trigger LAUNCH THRUST (Rapid Ascent)")
    print("   [3] Force APOGEE (Peak at ~2200 ft, deploy parachute)")
    print("   [4] Force LANDED (Resting at Ground Level)")
    print("   [5] Test Watchdog Hang (Freezes transmit for 5 seconds)")
    print("   [6] Trigger BMP280 Sensor Fail (Hot-swaps to LM75 fallback)")
    print("   [Q] Quit simulator")
    print("----------------------------------------------------------")

    # Set terminal to non-blocking mode to catch keypresses instantly
    old_settings = termios.tcgetattr(sys.stdin)
    try:
        tty.setcbreak(sys.stdin.fileno())
        sim = FlightSimulator()
        
        while True:
            key = get_key_non_blocking()
            if key == 'q' or key == 'Q':
                print("\n[SIMULATOR] Shutting down...")
                break
            
            if key == '5':
                print("\n[SIMULATOR] ⚠️ Injecting Watchdog Test: Freezing transmissions for 5s...")
                time.sleep(5)
                print("[SIMULATOR] Watchdog recovery cycle complete. Resuming...")
                key = None

            # Generate packet based on key inputs
            packet = sim.update(key)
            
            # Write packet to virtual serial port
            os.write(master, packet.encode('utf-8'))
            
            # Print feedback to emulator console
            sys.stdout.write(f"\r[TX] {packet.strip()}   ")
            sys.stdout.flush()
            
            time.sleep(1.0)
            
    finally:
        termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)
        if os.path.exists(symlink_path):
            os.remove(symlink_path)
        print("[SIMULATOR] Cleaned up virtual port links.")

if __name__ == '__main__':
    main()
