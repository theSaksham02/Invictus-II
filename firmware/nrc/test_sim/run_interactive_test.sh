#!/bin/bash
# ==============================================================================
#  NRC INTERACTIVE BENCH TEST — Manual Flight Control via Keyboard
# ==============================================================================
#  This script runs the Python flight injector for manual interactive testing.
#  YOU control the flight phases via keyboard (press 1-6 to change states).
#  
#  This is the "realistic demo" version — use it when you want to manually
#  walk through the flight phases during a live screen recording.
#
#  USAGE:
#    cd firmware/nrc/test_sim
#    chmod +x run_interactive_test.sh
#    ./run_interactive_test.sh
#
#  STEP 1: This script starts the Python flight injector
#  STEP 2: In a SEPARATE terminal, start the backend:
#            cd backend && SERIAL_PORT_NRC=/dev/tty.virtual-nrc npm start
#  STEP 3: Open the dashboard in your browser
#
#  TO STOP:
#    Press Q in the injector terminal.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "============================================================"
echo "   🎮 NRC INTERACTIVE BENCH TEST"
echo "============================================================"
echo ""
echo "   IMPORTANT: You need THREE terminals!"
echo ""
echo "   Terminal 1 (this one):"
echo "     Running the Python flight injector"
echo ""
echo "   Terminal 2:"
echo "     cd $(cd "$SCRIPT_DIR/../../.." && pwd)/backend"
echo "     SERIAL_PORT_NRC=/dev/tty.virtual-nrc node server.js"
echo ""
echo "   Terminal 3:"
echo "     open $(cd "$SCRIPT_DIR/../../.." && pwd)/dashboard/nrc.html"
echo ""
echo "------------------------------------------------------------"
echo "   Starting injector in 3 seconds..."
echo "------------------------------------------------------------"
echo ""

sleep 3

cd "$SCRIPT_DIR"
python3 flight_injector.py
