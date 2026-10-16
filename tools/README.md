# tools

| Script | Purpose |
|---|---|
| `run-host-tests.sh` | Build and run the PC unit tests for the portable firmware code (`test/`). |
| `build-firmware.sh` | Compile every ESP32 target, including the unmodified legacy sketches, with PlatformIO. |
| `hwdocs/ledger.py` | Load and validate the canonical wiring ledger `docs/wiring/pin_ledger.json`; checks firmware CAN GPIOs against it. |
| `hwdocs/validate.py` | Cross-check ledger, diagrams, video storyboard and firmware; writes `validation/wire_coverage_checklist.md`. |
| `hwdocs/build_manual.py` | Render the wiring diagrams and `docs/CANScope_Physical_Build_Manual_Rev2.pdf`. |
| (see `video/source/`) | Render the build video from the same ledger. Requirements: `hwdocs/requirements.txt`. |

Future (not implemented): a serial-to-WebSocket bridge that reads firmware JSON lines and feeds the dashboard's live adapter. See `docs/architecture.md`.
