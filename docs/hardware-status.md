# Hardware and protocol status

Status labels (from the project brief):

- **Confirmed / Verified**: directly observed on the hardware, or in a supplied datasheet, schematic or capture, with the evidence named.
- **Working assumption**: a provisional value used to make progress. It must be replaced or accepted after verification.
- **Unverified**: not known from any available evidence.
- **Blocked**: work cannot continue safely until the named information exists.

A successful compile **never** verifies hardware.

## Current status (2026-10-13, Node 3 / dashboard rows updated 2026-10-17)

| Item | Value in repo | Status | Evidence / note |
|---|---|---|---|
| ESP32 board variant (all nodes) | PlatformIO `esp32dev` | Working assumption | Build target only. Module unknown. WROVER modules use GPIO16/17 for PSRAM |
| CAN transceiver part | none | Unverified | Brief suggests an SN65HVD230/TJA1051-class 3.3 V part. Not confirmed |
| Transceiver supply / logic level | none | Unverified | Must be 3.3 V-compatible with ESP32 GPIO |
| Transceiver STB/RS/EN wiring | none | Unverified | Silent or standby mode would block the bus |
| Node 1 CAN TX/RX | GPIO17 / GPIO16 | Working assumption | `sketch_node1_test.ino` source only |
| Node 2 CAN TX/RX | GPIO17 / GPIO16 | Working assumption | `sketch_node2_test.ino` source only |
| Monitor CAN TX/RX | GPIO17 / GPIO16 | Working assumption | Copied from the legacy sketches. Monitor board unknown |
| Node 3 CAN TX/RX | GPIO17 / GPIO16 (`firmware/monitor`) | Working assumption | Wiring ledger N3-06/N3-07 (PROVISIONAL). `firmware/node3` scaffold still refuses CAN and is not flashed on Node 3 |
| Nominal bit rate | 500 kbit/s (nodes 1, 2, monitor) | Working assumption | Legacy sketches. Node 3: unverified |
| Classical CAN vs CAN FD | classical | Working assumption | ESP32 TWAI cannot do CAN FD. Bus requirement unknown |
| Identifier format | standard 11-bit in legacy sketch | Unverified | Firmware handles both formats |
| Production CAN IDs and payloads | none | Unverified | Only test-sketch IDs 0x201/0x202/0x203/0x210 are known, from source |
| Termination (2 × 120 Ω at bus ends) | n/a | Unverified | Measure about 60 Ω CANH–CANL with power off |
| Node 3 role, sensors, I/O | CANScope Monitor: SSD1306 (21/22), LEDs 26/27 (green: no verified pin, N3-14 BLOCKED). No buttons, no buzzer | Working assumption | Wiring ledger (PROVISIONAL). GPIO25/32/33 unused |
| Dashboard transport and deployment | Web Serial from `http://localhost` (Chrome/Edge) | Implemented, not hardware-tested | Unit/integration tests use an in-memory serial double only |

## How a value becomes verified

1. **Collect evidence**: a schematic or module datasheet; a continuity test with power removed; a measured voltage; a known-good capture; or a controlled bench test. Save files (photos, captures, logs) in `captures/` or `docs/`.
2. **Record it beside the value**: update the table above and the relevant document (`docs/wiring/node-3-pin-map.md` or `docs/protocol/can-id-registry.md`). Name the evidence, the date and who checked it.
3. **Update the code**: set the value in the node's `*_hw_config.h` (or the registry in both `firmware/common/protocol_decoder` and `dashboard/src/lib/protocol-registry.ts`), and change its status field to `Verified` / `'verified'`, citing the evidence in a comment.
4. **Re-run checks**: host tests, firmware build, dashboard tests.
5. **Log it in TASK.md** under "Hardware or protocol values newly verified".

A value goes back to Unverified if the hardware changes (a different board, transceiver or wiring).
