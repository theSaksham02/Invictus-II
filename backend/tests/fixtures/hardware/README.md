# Hardware Parser Fixtures

This directory is reserved for real telemetry captured from the physical PCBs.

Do not commit non-PCB, generated, or hand-built flight data here.

Capture formats:

- `*.nrc`: one real `NRC:` or `NRC2:` line per row from the NRC PCB or LoRa ground receiver.
- `*.cansat.hex`: one real framed CanSat packet per row, encoded as lowercase or uppercase hex.

Run `node tests/capture-hardware-fixtures.js --source NRC --port /dev/cu.usbmodemXXXX --out tests/fixtures/hardware/nrc-YYYYMMDD.nrc` after connecting hardware.

Acceptance criteria before committing a fixture:

- Capture directly from the PCB or the flight ground receiver, not from generated data.
- Capture at least 20 consecutive rows/frames per source.
- Include one cold boot capture and one steady-state capture after sensors have settled.
- Run `npm test -- tests/parser.test.js`; the hardware fixture tests must pass without editing parser limits.
- If a fixture fails because hardware is producing out-of-envelope values, fix or document the hardware/firmware fault before treating the data as valid.
