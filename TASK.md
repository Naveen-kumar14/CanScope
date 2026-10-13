# CANScope task log

Canonical task file: `TASK.md` (no `task.md` existed; only this file is used).

## Current status

- Phase: phase 1 (repository foundation) **software-complete** as of 2026-10-13. Next phase: Stage 0/1 hardware inventory and evidence.
- Overall state: all firmware targets build, and the host and dashboard tests pass. **No hardware or protocol value is verified.** Node 3 is blocked on its pin map and role.
- Git: folder is not yet a Git repository, so there are no commits (user decision pending).

---

## 2026-10-13 — Session 1, discovery note (written before implementation)

### Repository state found

- Path: `E:\2nd year\Embedded systems Package` (used as repository root, no nested `CANScope/` folder created).
- Git: **not a Git repository** (`git status` → `fatal: not a git repository`). No commits will be made this session; `git init` is left as a user decision.
- Existing files (all preserved unchanged):
  - `CANScope_ESP32_Project_Brief.md` — project brief, status legend, candidate pin maps, test stages.
  - `CANScope_Claude_Repository_Implementation_Task.md` — repository implementation task.
  - `sketch_node1_test/sketch_node1_test.ino`
  - `sketch_node2_test/sketch_node2_test.ino`
  - `sketch_oct07a/sketch_oct07a.ino`

### What the existing sketches do (observed from source only, never run by Claude)

| Sketch | Observed behaviour | CAN settings in the source |
|---|---|---|
| `sketch_node1_test` | Installs and starts the ESP32 TWAI driver, prints success/failure. `loop()` is empty: it does not read frames, but in NORMAL mode the controller will ACK frames on the bus. | TX `GPIO17`, RX `GPIO16`, 500 kbit/s, `TWAI_MODE_NORMAL`, accept-all filter |
| `sketch_node2_test` | "Battery ECU Node 2" test transmitter. Every 1000 ms sends `0x201` (uint16 BE raw 480), `0x202` (int16 BE raw 120), `0x203` (uint8 raw 85); every 500 ms sends heartbeat `0x210` (uint8 1). Values are hard-coded constants, not sensor readings. Units/scaling are not stated anywhere. | TX `GPIO17`, RX `GPIO16`, 500 kbit/s, `TWAI_MODE_NORMAL`, standard 11-bit IDs (flags left zero) |
| `sketch_oct07a` | Serial "hello world": prints `CANScope ESP32 Ready!` every second. No CAN. | none |

Note: the sketches use GPIO17/GPIO16, while the brief's candidate map uses GPIO22/GPIO21. Neither is verified on hardware. GPIO16/17 are used for PSRAM on ESP32-WROVER modules, so the board variant matters.

### Toolchains detected

- Node.js v24.16.0, npm 11.13.0 → dashboard (Vite + React + TypeScript + Vitest planned).
- Python 3.14.2, g++ 15.2.0 (MinGW-w64), CMake 4.2.0, Ninja, mingw32-make → host-side firmware unit tests.
- **No ESP32 toolchain installed** (no arduino-cli, PlatformIO, ESP-IDF). Plan: install PlatformIO into an isolated venv in the session scratchpad (not global) and attempt ESP32 builds.

### Unverified hardware/protocol values (nothing new verified this session so far)

ESP32 board variants; transceiver part and 3.3 V compatibility; standby/silent pin wiring; Node 3 role, sensors, I/O; final CAN TX/RX GPIOs for every node; Classical CAN vs CAN FD; nominal bit rate (500 kbit/s appears in legacy sketches only); standard vs extended IDs; production CAN IDs and payloads; termination locations; dashboard transport and deployment.

### Planned scope for this session

1. Repository skeleton, `.gitignore`, README, docs (architecture, hardware status, testing, Node 3 pin map, CAN ID registry).
2. Shared firmware library (config + validation, raw frame model + serial JSON-line encoder, protocol registry/decoder, TWAI transport with TX gate, diagnostics banner) as PlatformIO libraries under `firmware/common/`.
3. PlatformIO targets: `node1`, `node2`, `node3`, `monitor`, plus `legacy` environments in node1/node2 that compile the existing sketches **unchanged** (included by path) as a regression check.
4. Host unit tests (CMake + g++) for config validation, frame model, decoder.
5. Read-only dashboard with mock data source, transport-neutral adapter, tests.
6. Run all available checks and record exact results here.

---

## 2026-10-13 — Session 1, implementation results

### Summary

Built the phase-1 foundation around the existing work: shared firmware libraries, four PlatformIO targets plus regression builds of the two legacy sketches, host unit tests, a read-only mock-data dashboard, and documentation. Every software check passes. Nothing hardware-related was tested.

### Work completed

- Repository skeleton, `.gitignore` (build outputs, secrets, `captures/private/`), `README.md`.
- `firmware/common` libraries:
  - `can_config`: config model and validation.
  - `frame_capture`: `RawFrame` and a bounded JSON-line encoder.
  - `can_transport`: interface, TX gate, status JSON, and `TwaiTransport` for ESP32 (listen-only/normal/no-ack, alerts, error counters, bus-off counting, explicit-only recovery).
  - `protocol_decoder`: empty production registry, plus the UNVERIFIED legacy test-sketch registry.
  - `diagnostics`: start-up banner.
  - `node_runtime`: shared ESP32 setup/loop.
- Targets:
  - `firmware/node1` (`node1`, `legacy_sketch`) and `firmware/node2` (`node2`, `legacy_sketch`): normal mode, TX disabled.
  - `firmware/node3` (`node3`): all CAN values UNVERIFIED, so it refuses to start CAN. Has placeholder sections for sensors, inputs, outputs and application messages.
  - `firmware/monitor` (`monitor`): listen-only, TX disabled.
- Host tests (`test/`, CMake + g++ with `-Werror`): config validation, raw frame/JSON, TX gate/status, banner, decoder (EXAMPLE data).
- Dashboard (`dashboard/`, Vite 8 + React 19 + TS 6 + Vitest 5 + ESLint 10):
  - transport-neutral `CanDataSource` (no send method)
  - mock source with 6 scenarios
  - serial-line parser for the firmware JSON lines
  - decoder (decoded/unverified/unknown/mismatch)
  - status bar with READ-ONLY and MOCK badges
  - bus summary (state, frame rate, RX/TX/error/bus-off/missed counters)
  - node health cards (Node 3 included)
  - filters (ID, node, time range)
  - frame table and frame detail
  - loading/empty/stale/disconnected/error states
- Docs: `docs/architecture.md`, `docs/hardware-status.md`, `docs/testing.md`, `docs/wiring/node-3-pin-map.md`, `docs/protocol/can-id-registry.md`, `dashboard/README.md`, `tools/README.md`, `test/integration/README.md`.
- Tools: `tools/run-host-tests.sh`, `tools/build-firmware.sh`.

### Files changed

All new (nothing existing was modified): `.gitignore`, `README.md`, `TASK.md`, `captures/.gitkeep`, `docs/**`, `firmware/**`, `dashboard/**` (excluding `node_modules`/`dist`), `test/**`, `tools/**`.

### Existing files preserved (unchanged; SHA-256 recorded 2026-10-13 after the session's work)

```
47a1f6f909a73373c137a00b1bbfa89a24ec637cac8b219b4166601a146bd248  sketch_node1_test/sketch_node1_test.ino
cb46f039dfccee47f8f14869fbaa3764d24421f23439c87085f605a9f451ec76  sketch_node2_test/sketch_node2_test.ino
9d1d708889231af702a1911dbd04e29093a731fc3bfaa9fa46c486f1d1901289  sketch_oct07a/sketch_oct07a.ino
56087058ca20f9494d81bf489a96d00ede10a9634ad793d4a30d34e5812a5fe8  CANScope_Claude_Repository_Implementation_Task.md
5dd6150b1daaee2500ad7d59633bb8cc32688d90ea1ffb959424b24a40516052  CANScope_ESP32_Project_Brief.md
```

Hashes were not taken before the session. No tool in this session wrote to these files; they were only read, or `#include`d by the legacy build wrappers.

### Environment changes outside the repository

- PlatformIO Core 6.2.0 installed in a venv in the Claude session scratchpad (temporary; not on the user's PATH).
- PlatformIO packages (espressif32 6.12.0, Arduino-ESP32, xtensa toolchain) downloaded to **`C:\canscope-pio`** (`PLATFORMIO_CORE_DIR`). The first attempt, with the core dir inside the long scratchpad path, failed with `PackageException: Could not install package 'espressif32 @ 6.12.0'` because unpacked paths exceeded the Windows 260-character limit. `C:\canscope-pio` is safe to delete; PlatformIO will download again.
- `dashboard/node_modules` installed by `npm install` (ignored by git).

### Commands and exact results

| Command | Result |
|---|---|
| `sh tools/run-host-tests.sh` (clean `build/host-tests`) | **5/5 test suites passed** (test_can_config, test_raw_frame, test_can_transport, test_diagnostics, test_protocol_decoder). Compiled with `-Wall -Wextra -Werror` |
| `pio run -d firmware/node3 -e node3` (first build) | SUCCESS. One `-Wcomment` warning in `node3_hw_config.h` (trailing backslash in a comment), fixed afterwards |
| `sh tools/build-firmware.sh` (`PLATFORMIO_CORE_DIR=C:/canscope-pio`) | **6/6 SUCCESS, 0 warnings in project sources**: node1/node1, node1/legacy_sketch, node2/node2, node2/legacy_sketch, node3/node3, monitor/monitor. Shared-runtime targets: RAM 6.6% (21,648 B), flash 21.5% (~281 KB). Legacy: RAM 6.6%, flash 20.8–20.9% |
| First `sh tools/build-firmware.sh` attempt | exit 127 `pio: command not found`. My PATH used `C:/...` form, which POSIX PATH can't parse. Not a script defect |
| `npm run check` (dashboard) | typecheck OK, eslint OK, **Vitest 34/34 passed (5 files)**, `vite build` OK (JS 241 kB / 75 kB gzip) |
| First Vitest run | 1 failure in the read-only test: its regex matched the footer disclaimer text. Test rewritten to assert the exact set of interactive controls (no buttons/links/forms; one ID textbox, two selects); passes |
| `npx vite --port 5173` + `curl` | `/`, `/src/main.tsx`, `/src/pages/DashboardPage.tsx`, `/src/mock-data/mock-source.ts` returned HTTP 200 and `<title>CANScope Monitor</title>`. Server stopped afterwards |
| Visual browser check | **Not done**: Claude-in-Chrome extension not connected. Rendering is covered only by jsdom tests |

### Hardware or protocol values newly verified

None.

### Assumptions that remain (see docs/hardware-status.md)

- `esp32dev` (classic ESP32) is the board for every node: WORKING_ASSUMPTION.
- node1/node2/monitor use TX GPIO17 / RX GPIO16 at 500 kbit/s: WORKING_ASSUMPTION, copied from the legacy sketches. GPIO16/17 conflict with PSRAM on WROVER modules, and the firmware warns about this.
- Node 3 GPIOs and bit rate: UNVERIFIED. The firmware refuses to start CAN.
- Classical CAN only (ESP32 TWAI limitation); actual bus requirement unknown.
- Legacy IDs 0x201/0x202/0x203/0x210 are test traffic with unknown units: UNVERIFIED.
- `sourceNode` means the capturing node. The sender is not knowable from a CAN frame.

### Blockers

- **Node 3 hardware**: no schematic, component list or photos, so the pin map, sensors and outputs can't be filled in. Exact cause: the information isn't in the repository or the brief.
- **Transceiver identity**: the part number is unknown, so 3.3 V compatibility and STB/RS wiring can't be confirmed.
- **Production protocol**: no specification or capture exists.
- **Git**: the folder is not a repository. Commits were not made; this is a user decision.

### Future tasks (recorded, not started)

1. Loopback self-test env (`NoAck` + TWAI self-reception, `ENABLE_TX=true`) for bring-up stage 3.
2. Host serial-to-WebSocket bridge plus a live `CanDataSource` adapter, using `parseSerialLine()`.
3. Bus-off recovery policy (currently report-only; `request_bus_off_recovery()` exists but is never called).
4. Port node2's test traffic into the new `node2` target behind an explicit, documented test env, if still wanted.
5. Any dashboard command feature needs a separate approved specification (see `docs/architecture.md#out-of-scope`).

### Next concrete action

The user should identify (photo or part number) each ESP32 module and the CAN transceiver module, and share the Node 3 component list or schematic. With that, fill `docs/hardware-status.md` and `docs/wiring/node-3-pin-map.md`, then run bring-up stages 1–2 (power/continuity, about 60 Ω CANH–CANL check) and record the measurements here.
Optional, in the repo: `git init` and a first set of focused commits, if the user approves.
