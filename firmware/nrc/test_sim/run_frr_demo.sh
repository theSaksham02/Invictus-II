#!/bin/bash
# ==============================================================================
#  NRC FRR DEMO — One-Command Run Script
# ==============================================================================
#  This script starts the entire NRC ground station telemetry pipeline
#  in simulation mode. No physical hardware required.
#
#  WHAT IT DOES:
#    1. Creates a temporary .env file configured for simulation
#    2. Starts the Node.js backend server (which auto-launches the emulator)
#    3. Opens the NRC dashboard in your default browser
#    4. Restores your original .env when you press Ctrl+C
#
#  USAGE:
#    cd firmware/nrc/test_sim
#    chmod +x run_frr_demo.sh
#    ./run_frr_demo.sh
#
#  TO STOP:
#    Press Ctrl+C in this terminal. Everything cleans up automatically.
# ==============================================================================

set -e

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
DASHBOARD_FILE="$PROJECT_ROOT/dashboard/nrc.html"
ENV_FILE="$BACKEND_DIR/.env"
ENV_BACKUP="$BACKEND_DIR/.env.backup.frr"

echo ""
echo "============================================================"
echo "   🚀 NRC FRR DEMO LAUNCHER"
echo "============================================================"
echo ""
echo "   Project Root : $PROJECT_ROOT"
echo "   Backend Dir  : $BACKEND_DIR"
echo "   Dashboard    : $DASHBOARD_FILE"
echo ""

# ── Step 1: Backup existing .env (if it exists) ─────────────────────────────
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_BACKUP"
    echo "   ✅ Backed up existing .env → .env.backup.frr"
else
    echo "   ℹ️  No existing .env found (will create one)"
fi

# ── Step 2: Write simulation .env ───────────────────────────────────────────
cat > "$ENV_FILE" << 'EOF'
PORT=3000
SERIAL_PORT_CANSAT=/dev/ttyUSB0
SERIAL_PORT_CANSAT_CMD=
SERIAL_PORT_NRC=/dev/ttyUSB1
SERIAL_BAUD_CANSAT=115200
SERIAL_BAUD_CANSAT_CMD=115200
SERIAL_BAUD_NRC=115200
DB_FILE=./flight_frr_demo.db
SIM_MODE=true
ENABLE_SIM_FALLBACK=false
LOG_PACKETS=false
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,null
SIGNAL_TIMEOUT_MS=5000
SERIAL_RECONNECT_MS=3000
SD_UPLOAD_MAX_FILE_BYTES=5242880
SD_UPLOAD_MAX_ROWS=50000
LOG_LEVEL=info
ROVER_IP=192.168.4.1
ROVER_PORT=5000
ROVER_TIMEOUT_MS=800
ROVER_CONTROL_TOKEN=
EOF

echo "   ✅ Created simulation .env (SIM_MODE=true)"

# ── Step 3: Cleanup handler ─────────────────────────────────────────────────
cleanup() {
    echo ""
    echo ""
    echo "   🛑 Shutting down..."

    # Kill the backend server
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill "$BACKEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" 2>/dev/null || true
        echo "   ✅ Backend server stopped"
    fi

    # Restore original .env
    if [ -f "$ENV_BACKUP" ]; then
        mv "$ENV_BACKUP" "$ENV_FILE"
        echo "   ✅ Original .env restored from backup"
    else
        rm -f "$ENV_FILE"
        echo "   ✅ Temporary .env removed"
    fi

    # Remove demo database
    rm -f "$BACKEND_DIR/flight_frr_demo.db"
    echo "   ✅ Demo database cleaned up"

    echo ""
    echo "   Done. Your workspace is clean."
    echo ""
    exit 0
}

trap cleanup INT TERM

# ── Step 4: Start the backend ────────────────────────────────────────────────
echo ""
echo "------------------------------------------------------------"
echo "   Starting backend server..."
echo "------------------------------------------------------------"
echo ""

cd "$BACKEND_DIR"
node server.js &
BACKEND_PID=$!

# Give the server a moment to boot
sleep 3

# ── Step 5: Open the dashboard ───────────────────────────────────────────────
echo ""
echo "------------------------------------------------------------"
echo "   Opening NRC Dashboard in browser..."
echo "------------------------------------------------------------"
echo ""

if command -v open &> /dev/null; then
    open "$DASHBOARD_FILE"
elif command -v xdg-open &> /dev/null; then
    xdg-open "$DASHBOARD_FILE"
else
    echo "   ⚠️  Could not auto-open browser."
    echo "   Open this file manually: $DASHBOARD_FILE"
fi

# ── Step 6: Display status ───────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "   ✅ FRR DEMO IS LIVE"
echo "============================================================"
echo ""
echo "   Backend   : http://localhost:3000"
echo "   Dashboard : $DASHBOARD_FILE"
echo "   Emulator  : Auto-started (SIM_MODE=true)"
echo "   Database  : $BACKEND_DIR/flight_frr_demo.db"
echo ""
echo "   The emulator is now running a full 3-minute flight:"
echo "     • 0-30s    PRE_FLIGHT  (pad idle, sensors calibrating)"
echo "     • 30-90s   POWERED     (climbing to ~660m / 2165ft)"
echo "     • 90-95s   APOGEE      (peak altitude, parachute deploy)"
echo "     • 95-180s  DESCENDING  (slow parachute descent)"
echo "     • 180s+    LANDED      (ground level, OLED locked)"
echo ""
echo "   📸 Take screenshots NOW for your FRR slides!"
echo "   🎥 Start screen recording for video evidence!"
echo ""
echo "   Press Ctrl+C to stop and clean up."
echo "------------------------------------------------------------"
echo ""

# Wait for the backend process
wait "$BACKEND_PID"
