# Final technical review: Rev 2.0-draft manual and build video

Date: 2026-10-16. Reviewer: Claude (Opus 5.5), second pass after generation.
Scope: `docs/CANScope_Physical_Build_Manual_Rev2.pdf`, `docs/wiring/diagrams/*.png`, `video/storyboard.md`, `video/narration.md`, `video/CANScope_Physical_Build_Demo.mp4`, against `docs/wiring/pin_ledger.json` and the firmware.

## Verdict

**NOT FINAL.** No critical discrepancy remains *between* the documents. The ledger, diagrams, PDF, video and firmware pin settings agree, and every check below passed. The build is still not final, because:

- nothing has been physically inspected or measured;
- five connections are **BLOCKED** (Q1 transistor pinout: N3-28 to N3-32);
- N3-35 (buzzer 5 V supply) is deferred behind gates G10, G11 and G12;
- no firmware exists for the OLED, LEDs, buttons or buzzer.

The manual and video label themselves "Rev 2.0-draft / NOT FINAL" accordingly.

## 1. Automated cross-checks (`tools/hwdocs/validate.py`)

Run after the final edits: **17/17 PASS**.

| Phase 6 requirement | Automated check | Result |
|---|---|---|
| Every wire in each diagram appears in the ledger | Diagram geometry ids ⊆ ledger ids (Node 1, Node 2, Node 3, bus) | PASS |
| Every ledger connection appears in its diagram | Node *n* diagram ids = Node *n* ledger rows; bus diagram ⊇ B-01..B-06 + terminators; every row drawn at least once | PASS |
| Every video wiring step agrees with the ledger | Every ledger row is a highlighted step exactly once; steps reference only ledger rows; the right panel is rendered from the ledger row itself | PASS |
| No wire changes GPIO between scenes | Each wire step's narration contains the ledger GPIO; node diagram = ledger node | PASS |
| Both terminators at the physical ends | RT1/RT2 attach to the first/last transceiver in `bus.order`; exactly two terminators | PASS |
| Grounds and power domains represented | No joined 3V3 nets across nodes; no VIN–3V3 net; GND trunk B-03/B-06 present; power-domain sheet in manual §14 | PASS |
| Safety rules | No CANH/CANL on an ESP32 pin; no GPIO directly on BZ1; no flash/strapping/input-only/USB-serial pin used | PASS |
| Unresolved items stay visibly blocked | Every BLOCKED row is narrated "BLOCKED", drawn dashed red, with a STOP banner | PASS |
| Safety warnings before the relevant step | Safety card precedes the first wire; every gate has its own gate panel or "Gate Gn" narration before the first step that needs it (strict check: the legend card mentioning "G1..G14" does not count) | PASS |
| Wiring only with power removed | Every wiring step is shown with "ALL POWER OFF" | PASS |
| Firmware pin agreement | `node1`, `node2`, `monitor`, `sketch_node2_test`: CAN TX 17 / RX 16 = ledger | PASS (8/8 bindings) |

Negative tests, to show the checks can fail: injecting CANH→GPIO, GPIO→buzzer, joined 3V3 (N1–N2), VIN→3V3 rail, a strapping pin (GPIO2) and a third terminator each produced the expected error.

## 2. Manual review (cannot be automated)

| Item | Finding |
|---|---|
| Buzzer circuit matches the transistor pinout | The circuit is drawn with symbolic B/C/E. The physical leg order is **deliberately not drawn as approved**: Q1 rows are BLOCKED until G10. The parts sheet gives example orders (PN2222A/2N3904/S8050 E-B-C, BC547 C-B-E), labelled "examples only". Consistent. |
| Button diagram matches the switch package | The package is unidentified. The diagonal-leg rule holds for any 4-leg SPST tactile switch (two legs per contact), and G8 verifies it with a meter. Consistent. |
| Transceiver pin order | Modules differ. Every diagram labels pins by function, and the legend, the gate G4 and the narration all say "connect by PRINTED NAME". The CTX/CRX naming follows TI pin functions (D = TXD input, R = RXD output). |
| OLED supply | 3.3 V supply, so the I²C pull-ups sit at 3.3 V. **Residual risk:** some SSD1306 modules with an on-board LDO run marginally at 3.3 V (dim or blank). If that happens, do **not** move VCC to 5 V without first confirming that the module's SDA/SCL pull-ups go to its regulated 3.3 V, not to VCC. Recorded for the next revision. |
| Power-domain sheet | Corrected during review: it had said Node 3's 3V3 "feeds LEDs, buttons". It now says the LEDs are fed from GPIOs and the buttons use internal pull-ups. |
| Placement sheet | Corrected during review: it had said "Board A rails carry GND only", but the ledger has no Board A rail wires. It now says Board A rails are not used. The video was re-rendered after this fix. |
| Scene order vs Rev 1 power order | Rev 1 disconnected the trunk for single-node power-up. Rev 2 keeps it wired, based on TI SLOS346O §10.3 ("an unpowered node does not disturb the bus"). This is an IC-level claim; module-level parts are unverified. Single-node tests are still one USB at a time. |
| Expected serial output | Formats were taken from the firmware source (`# CAN init: OK - controller running`, JSON `"type":"frame"`, `canId`). The video shows them as *expected*, never as recorded results. Meter screens are labelled "EXPECTED", "not a recorded measurement". |
| "Sent CAN ID" claim | `sketch_node2_test` prints it when `twai_transmit` returns `ESP_OK`, which means the frame was queued. Manual and video both state that this is not proof of delivery. |
| Photographs | None were available. Every diagram and video frame carries a "SCHEMATIC ILLUSTRATION" label. No generated image is presented as a photo. |
| Video pacing | About 60 minutes, one sentence per subtitle frame, a pause after each step, one wire per step, and MP4 chapters per scene. No montage. |

## 3. Residual risks and open questions

1. Exact ESP32 board clone: the silkscreen order is from the commonly published DOIT layout (G2 must confirm it).
2. Transceiver module variant: Rs wiring (G5) and onboard termination (G6) are unknown.
3. The DevKit VIN behaviour on USB is assumed to be roughly USB 5 V (G12 measures it before use).
4. The `node3` firmware target and the `monitor` target overlap in role. Node 3 hardware uses `monitor` for now; a software decision is needed.
5. The OLED supply margin at 3.3 V (see above).
6. `docs/hardware-status.md` still describes the monitor as a separate, unknown board. Update it after the first bench evidence.
