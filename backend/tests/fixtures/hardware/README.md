# Hardware Parser Fixtures

This directory is reserved for real telemetry captured from the physical PCBs.

Do not commit non-PCB, generated, or hand-built flight data here.

Capture formats:

- `*.mxr`: one real `MXR3:` or `MXR2:` line per row from the Mach-X Rideshare PCB or LoRa ground receiver. Legacy `*.nrc` captures with `NRC:` or `NRC2:` are still accepted for parser regression tests.
- `*.cansat.hex`: one real framed CanSat packet per row, encoded as lowercase or uppercase hex.

Run `node tests/capture-hardware-fixtures.js --source RIDESHARE --port /dev/cu.usbmodemXXXX --out tests/fixtures/hardware/rideshare-YYYYMMDD.mxr` after connecting hardware.

Acceptance criteria before committing a fixture:

- Capture directly from the PCB or the flight ground receiver, not from generated data.
- Capture at least 20 consecutive rows/frames per source.
- Include one cold boot capture and one steady-state capture after sensors have settled.
- Run `npm test -- tests/parser.test.js`; the hardware fixture tests must pass without editing parser limits.
- If a fixture fails because hardware is producing out-of-envelope values, fix or document the hardware/firmware fault before treating the data as valid.
