# CANScope

CANScope is an ESP32-based CAN bus monitoring project. ESP32 nodes capture raw CAN frames and report them, along with bus health, as JSON lines over USB serial. A **read-only** web dashboard displays them. Right now the dashboard runs on mock data.

> **Status (2026-10-13):** the software foundation builds and its tests pass. **No hardware has been verified.** Every GPIO, the bit rate, the transceiver and the Node 3 role are `UNVERIFIED` or `WORKING_ASSUMPTION`. See [docs/hardware-status.md](docs/hardware-status.md) and [TASK.md](TASK.md).

## Repository layout

```text
.
├── README.md, TASK.md (canonical task log), .gitignore
├── CANScope_ESP32_Project_Brief.md                 original brief (preserved, unchanged)
├── CANScope_Claude_Repository_Implementation_Task.md   original task (preserved, unchanged)
├── sketch_node1_test/  sketch_node2_test/  sketch_oct07a/   original Arduino sketches (preserved, unchanged)
├── docs/            architecture, hardware status, testing, wiring/node-3-pin-map, protocol/can-id-registry
├── firmware/
│   ├── common/      shared PlatformIO libraries (one folder per library)
│   │   ├── can_config/        config model + validation (portable)
│   │   ├── can_transport/     transport interface, TX gate (portable) + ESP32 TWAI driver
│   │   ├── frame_capture/     raw frame model + JSON line encoder (portable)
│   │   ├── protocol_decoder/  registry + decoder (portable)   <- addition to the planned layout
│   │   ├── diagnostics/       start-up banner (portable)
│   │   └── node_runtime/      shared ESP32 setup/loop          <- addition to the planned layout
│   ├── node1/ node2/ node3/ monitor/   one PlatformIO project per ESP32 target
├── dashboard/       Vite + React + TypeScript read-only dashboard
├── test/            host (PC) unit tests for the portable firmware code; integration/ for bench tests
├── captures/        approved CAN captures (private ones go in captures/private/, ignored)
└── tools/           helper scripts
```

**Deviations from the planned structure, and why**

- The project root is the opened folder itself, not a nested `CANScope/` directory, so the existing work stays where it is.
- The legacy sketches stay at the root, unmoved and unedited. `firmware/node1` and `firmware/node2` each have an extra `legacy_sketch` PlatformIO environment that compiles the original `.ino` file by `#include` path. That gives a regression build without touching the sketch.
- `firmware/common/protocol_decoder` and `firmware/common/node_runtime` were added. Decoding is kept separate from raw capture, and the four node targets share one runtime instead of four copies.
- The firmware toolchain is **PlatformIO (Arduino framework, espressif32 6.12.0)**. It supports several targets and shared libraries, and uses the same `driver/twai.h` API as the existing sketches.

## Existing sketches

| Sketch | What it does (from source, not hardware-tested) | Relation to new structure |
|---|---|---|
| `sketch_node1_test` | Starts TWAI (TX GPIO17, RX GPIO16, 500 kbit/s, normal mode). Empty loop. | Built unchanged as `firmware/node1` env `legacy_sketch`. Its pins and bit rate seed node1's WORKING_ASSUMPTION config. |
| `sketch_node2_test` | "Battery ECU" **test** transmitter: 0x201/0x202/0x203 every 1 s, 0x210 heartbeat every 500 ms, all constant values. | Built unchanged as `firmware/node2` env `legacy_sketch`. Its IDs are listed as **UNVERIFIED test traffic** in the registry. The new `node2` env does **not** transmit. |
| `sketch_oct07a` | Prints "CANScope ESP32 Ready!" every second. No CAN. | Kept as a hello-world reference. Not wired into the build. |

## Quick start

### Firmware (ESP32)

Prerequisite: [PlatformIO Core](https://docs.platformio.org/en/latest/core/installation/index.html) (`python -m pip install platformio`).
On Windows, if PlatformIO fails while unpacking packages ("No such file or directory" deep in `.cache/tmp`), the path is too long. Set a short core directory: `set PLATFORMIO_CORE_DIR=C:\canscope-pio`.

```sh
pio run -d firmware/node3 -e node3                       # build Node 3
pio run -d firmware/node3 -e node3 -t upload --upload-port COM5   # flash (pick your port)
pio device monitor -b 115200 --port COM5                 # serial monitor
sh tools/build-firmware.sh                               # build all targets incl. legacy sketches
```

Targets: `firmware/node1` (`node1`, `legacy_sketch`), `firmware/node2` (`node2`, `legacy_sketch`), `firmware/node3` (`node3`), `firmware/monitor` (`monitor`).

Node 3 with its default config prints a banner and **refuses to start CAN**, because its pins and bit rate are UNVERIFIED. See [docs/wiring/node-3-pin-map.md](docs/wiring/node-3-pin-map.md) for how to run a recorded bench assumption.

### Host unit tests (PC, no hardware)

```sh
sh tools/run-host-tests.sh
# or: cmake -S test -B build/host-tests -G Ninja && cmake --build build/host-tests && ctest --test-dir build/host-tests --output-on-failure
```

### Dashboard

```sh
cd dashboard
npm install
npm run dev        # http://localhost:5173  (mock data; ?scenario=normal|empty|stale|disconnected|error|bus_off)
npm run check      # typecheck + lint + tests + production build
```

## Documentation

- [docs/architecture.md](docs/architecture.md): layers, serial JSON-line protocol, dashboard data boundary, out-of-scope features
- [docs/hardware-status.md](docs/hardware-status.md): confirmed vs unverified values, and how a value becomes verified
- [docs/wiring/node-3-pin-map.md](docs/wiring/node-3-pin-map.md): Node 3 pin-by-pin table
- [docs/protocol/can-id-registry.md](docs/protocol/can-id-registry.md): CAN ID and payload registry
- [docs/testing.md](docs/testing.md): software tests, hardware bring-up order, CAN termination and electrical checks
- [dashboard/README.md](dashboard/README.md): dashboard development

## Safety scope

The dashboard is monitoring-only. It has no CAN transmit, command, actuator or relay controls, and its data interface has no send method. Firmware transmission is gated by `ENABLE_TX` (false in every target) and refused in listen-only mode. Any command feature needs a separate, approved specification (see [docs/architecture.md](docs/architecture.md#out-of-scope)).
