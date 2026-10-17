# tools

| Script | Purpose |
|---|---|
| `protocol/gen_protocol.py` | Generate protocol constants (C++ and TS) and golden vectors from `protocol/canscope_protocol.json`; `--check` fails on stale files. |
| `run-host-tests.sh` | Check the generated protocol files, then build and run the PC unit tests for the portable firmware code (`test/`). |
| `build-firmware.sh` | Compile every ESP32 target, including the unmodified legacy sketches, with PlatformIO. |
| `hwdocs/ledger.py` | Load and validate the canonical wiring ledger `docs/wiring/pin_ledger.json`; checks firmware CAN GPIOs against it. |
| `hwdocs/validate.py` | Cross-check ledger, diagrams, video storyboard and firmware; writes `validation/wire_coverage_checklist.md`. |
| `hwdocs/build_manual.py` | Render the wiring diagrams and `docs/CANScope_Physical_Build_Manual_Rev2.pdf`. |
| (see `video/source/`) | Render the build video from the same ledger. Requirements: `hwdocs/requirements.txt`. |

The dashboard talks to the boards directly with Web Serial (`dashboard/src/lib/serial/`), so no bridge process is needed. See `docs/architecture.md`.
