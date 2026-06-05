# Hardware Parser Fixtures

This directory is reserved for real telemetry captured from the physical PCBs.

Do not commit non-PCB, generated, or hand-built flight data here.

Capture formats:

- `*.nrc`: one real `NRC:` or `NRC2:` line per row from the NRC PCB or LoRa ground receiver.
- `*.cansat.hex`: one real framed CanSat packet per row, encoded as lowercase or uppercase hex.

Run `node tests/capture-hardware-fixtures.js --source NRC --port /dev/cu.usbmodemXXXX --out tests/fixtures/hardware/nrc-YYYYMMDD.nrc` after connecting hardware.
