# MACH-26 Ground Station Backend

Real-time rocket telemetry ground station for Team Invictus II.

## Setup
1. \`npm install\`
2. Copy \`.env.example\` to \`.env\` and configure serial ports according to your OS (/dev/ttyUSB* on Linux, COM* on Windows).
3. Run \`npm run dev\` to start with live hardware (auto-restarts on save).
4. Run \`npm run sim\` to start in simulation mode (generates mock flight data).

## Features
- Real-time CANSAT binary struct parsing and validation (433MHz).
- Real-time NRC ASCII CSV parsing and validation (868MHz).
- SQLite durable storage for telemetry and flight phase events.
- WebSocket broadcasting to dashboard clients.
- Proxy endpoints for ORT Rover motor controls.
- SD Card post-flight bulk upload API.