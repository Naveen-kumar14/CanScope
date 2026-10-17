# CANScope

CANScope is a three-board ESP32 CAN demonstrator:

- **Node 1** (Motor ECU) and **Node 2** (Battery ECU) transmit protocol v1 telemetry and heartbeats through SN65HVD230 transceivers.
- **Node 3** (the CANScope Monitor) receives every frame, validates it, and detects faults on its own. It shows status on an SSD1306 OLED, three LEDs and a buzzer, and reports to the dashboard over USB serial.
- The React dashboard connects to the real boards with **Web Serial**. It shows what Node 3 observed, kept separate from what each ECU reports about itself, and sends validated, acknowledged commands to the ECUs.

> **Status (2026-10-17):** all firmware targets compile, and the host and dashboard tests pass. **Nothing has been flashed or run on hardware yet.** Pins are `WORKING_ASSUMPTION`, from the PROVISIONAL wiring ledger, and the buzzer is disabled until gate G10 passes. Start with [docs/physical-integration.md](docs/physical-integration.md). The protocol is in [docs/protocol/canscope-protocol-v1.md](docs/protocol/canscope-protocol-v1.md). History: [TASK.md](TASK.md).

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
│   │   ├── canscope_protocol/ protocol v1 codec + GENERATED protocol_spec.h (portable)
│   │   ├── serial_link/       USB command parser, line limits, ack/hello JSON (portable)
│   │   ├── ecu_core/          Node 1/2 sensor model, schedule, demo faults, commands (portable)
│   │   ├── ecu_runtime/       Node 1/2 ESP32 glue (TWAI + USB serial)
│   │   ├── monitor_core/      Node 3 validation, fault detection, JSON lines (portable)
│   │   ├── monitor_ui/        Node 3 debounce, LED policy, buzzer pattern, OLED pages (portable)
│   │   ├── can_config/        config model + validation (portable)
│   │   ├── can_transport/     transport interface, TX gate (portable) + ESP32 TWAI driver
│   │   ├── frame_capture/     raw frame model + JSON line encoder (portable)
│   │   ├── protocol_decoder/  registry + decoder (portable)   <- addition to the planned layout
│   │   ├── diagnostics/       start-up banner (portable)
│   │   └── node_runtime/      shared ESP32 setup/loop          <- addition to the planned layout
│   ├── node1/ node2/ monitor/   Node 1, Node 2, Node 3 firmware   (node3/: old scaffold, do not flash)
├── protocol/        canscope_protocol.json: the single protocol source (generates C++ and TS)
├── dashboard/       Vite + React + TypeScript dashboard (Web Serial physical mode; labelled mock preview)
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

Targets: `firmware/node1` (`node1`, `legacy_sketch`), `firmware/node2` (`node2`, `legacy_sketch`), `firmware/monitor` (`monitor`, plus `monitor_buzzer` for after gate G10), `firmware/node3` (`node3`).

**The Node 3 hardware runs `firmware/monitor`.** `firmware/node3` is the earlier scaffold that refuses to start CAN; it is kept only as a build regression. All CANScope nodes use 460800 baud on USB.

Flashing, port identification and bring-up: [docs/physical-integration.md](docs/physical-integration.md).

### Protocol

Edit `protocol/canscope_protocol.json`, then run `python tools/protocol/gen_protocol.py`. Its `--check` mode is part of the host tests.

### Host unit tests (PC, no hardware)

```sh
sh tools/run-host-tests.sh
# or: cmake -S test -B build/host-tests -G Ninja && cmake --build build/host-tests && ctest --test-dir build/host-tests --output-on-failure
```

### Dashboard

```sh
cd dashboard
npm install
npm run dev        # http://localhost:5173 in Chrome/Edge: physical mode (Web Serial); ?source=mock for the labelled preview
npm run check      # typecheck + lint + tests + production build
```

## Documentation

- [docs/physical-integration.md](docs/physical-integration.md): build, flash, ports, dashboard, bring-up, fault tests, diagnosis
- [docs/protocol/canscope-protocol-v1.md](docs/protocol/canscope-protocol-v1.md): CAN IDs, payloads, timing, faults, USB serial lines and commands
- [docs/architecture.md](docs/architecture.md): layers, serial JSON-line protocol, dashboard data boundary, out-of-scope features
- [docs/hardware-status.md](docs/hardware-status.md): confirmed vs unverified values, and how a value becomes verified
- [docs/wiring/node-3-pin-map.md](docs/wiring/node-3-pin-map.md): Node 3 pin-by-pin table
- [docs/protocol/can-id-registry.md](docs/protocol/can-id-registry.md): CAN ID and payload registry
- [docs/testing.md](docs/testing.md): software tests, hardware bring-up order, CAN termination and electrical checks
- [dashboard/README.md](dashboard/README.md): dashboard development

## Safety scope

- The dashboard never puts a frame on the CAN bus. It only sends allow-listed text commands (`set`, `profile`, `fault`, `recover`, ...) to one board over that board's USB port, and the board validates each one again and acknowledges it.
- Only Node 1 and Node 2 transmit (`ENABLE_TX=true`), and only their protocol frames. The monitor and node3 targets keep `ENABLE_TX=false`.
- Bus-off recovery is never automatic.
- The 5 V buzzer is switched by a low-side NPN and is never driven directly from a GPIO. Its output stays disabled until the transistor pinout (gate G10) is confirmed.
- The command feature was requested on 2026-10-17 (see TASK.md).
