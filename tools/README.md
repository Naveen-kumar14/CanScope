# tools

| Script | Purpose |
|---|---|
| `run-host-tests.sh` | Build and run the PC unit tests for the portable firmware code (`test/`). |
| `build-firmware.sh` | Compile every ESP32 target, including the unmodified legacy sketches, with PlatformIO. |

Future (not implemented): a serial-to-WebSocket bridge that reads firmware JSON lines and feeds the dashboard's live adapter. See `docs/architecture.md`.
