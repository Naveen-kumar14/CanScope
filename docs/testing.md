# Testing

## Software checks (no hardware)

| Check | Command | What it proves |
|---|---|---|
| Host unit tests | `sh tools/run-host-tests.sh` | Config validation, raw frame model and JSON encoding, TX gate, banner, decoder (EXAMPLE data) |
| Firmware compile, all targets | `sh tools/build-firmware.sh` | The code compiles and links for `esp32dev`. **Nothing about hardware** |
| Legacy sketch regression | `pio run -d firmware/node1 -e legacy_sketch` (and node2) | The unmodified original sketches still compile with the pinned toolchain |
| Dashboard | `cd dashboard && npm run check` | Typecheck, ESLint, Vitest (logic + rendering of mock, empty, loading, stale, disconnected, error states, plus the read-only check) and production build |

Results of each run go in `TASK.md` with the exact command and output summary.

## Hardware bring-up order

Don't skip a step. Record each in `TASK.md` with its evidence.

1. **Inventory and datasheets.** Identify every ESP32 module and transceiver part number. Confirm the transceiver is 3.3 V-compatible and how its STB/RS pin must be tied.
2. **Power and continuity, power removed.** Check 3V3 and GND continuity, check CANH→CANH and CANL→CANL end-to-end, check for no CANH–CANL short, and check that no CAN pin lands on a flash or strapping pin.
3. **Controller loopback.** *Firmware for this step is not written yet (TODO in TASK.md): it needs a dedicated test env using `NoAck` mode plus the TWAI self-reception flag, with `ENABLE_TX=true` on a single board with no bus attached.* Confirm timestamp, ID, DLC and payload round-trip. Then deliberately misconfigure (for example an UNVERIFIED pin) and confirm the banner reports the failure.
4. **Two-node bench bus.** Two known-good nodes, terminated at both ends. Run the legacy node2 sketch (`legacy_sketch` env) as the transmitter and the `node1` env (normal mode, ACKs) as receiver. Add the `monitor` (listen-only) and confirm it captures 0x201/0x202/0x203/0x210 at the expected periods with zero error counters. Note that a listen-only monitor never ACKs: if it is the *only* other node, the transmitter sees ACK errors.
5. **Node 3 integration.** Only after the pin map has evidence. One peripheral at a time. Capture raw traffic before adding any decoding.
6. **Fault tests.** Wrong bit rate, CANH open, CANL open, missing termination, transmitter removed (stale data), bus-off. Confirm the firmware alerts and the dashboard stale/bus-off states.

## CAN termination and electrical checks

- Exactly **two** 120 Ω terminators, one at each physical end of the bus, not one per node.
- With all power off, CANH–CANL resistance should be about **60 Ω**. About 120 Ω means one terminator is missing. About 40 Ω means there is an extra one.
- Recessive bus, powered and idle: CANH ≈ CANL ≈ 2.5 V (transceiver-dependent). Dominant: CANH ≈ 3.5 V, CANL ≈ 1.5 V.
- Keep stubs short, use twisted pair, and share a ground reference where the transceiver requires it.
- Never connect CANH/CANL directly to ESP32 GPIOs. Never use a 5 V-only transceiver on ESP32 logic without checking its RXD output level.
