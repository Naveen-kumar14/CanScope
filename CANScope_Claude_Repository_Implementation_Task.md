# CANScope implementation task for Claude Code

## Project scope

Create the initial repository for the **Embedded CANScope** project.

The repository must contain:

1. A clear project structure for ESP32 hardware firmware.
2. Shared CAN and diagnostic code that can be reused by multiple ESP32 nodes.
3. A dedicated Node 3 firmware area, with hardware-dependent values isolated in configuration.
4. A web application for the CANScope dashboard and related monitoring/support views.
5. Documentation, test scaffolding, and a task log that make the project easy to continue.

The web application is a **dashboard and monitoring interface only**. It must not silently become a vehicle-control, actuator-control, command-and-control, or safety-critical interface. Do not add CAN command transmission from the web app unless a later task explicitly authorizes and specifies it.

## Important hardware-status rule

The exact Node 3 board, transceiver, GPIO map, CAN bit rate, CAN IDs, payload formats, sensors, and peripherals are not yet verified from the available project record.

Do not invent final hardware values. Put provisional values in clearly named configuration files and label them as `UNVERIFIED`, `TODO`, or `WORKING_ASSUMPTION`. Keep raw CAN capture support available even when decoding is incomplete.

## First repository structure

Use a structure similar to this, adapting it to the selected toolchains:

```text
CANScope/
├── README.md
├── TASK.md
├── .gitignore
├── docs/
│   ├── architecture.md
│   ├── hardware-status.md
│   ├── wiring/
│   │   └── node-3-pin-map.md
│   ├── protocol/
│   │   └── can-id-registry.md
│   └── testing.md
├── firmware/
│   ├── common/
│   │   ├── can_config/
│   │   ├── can_transport/
│   │   ├── frame_capture/
│   │   └── diagnostics/
│   ├── node1/
│   ├── node2/
│   ├── node3/
│   └── monitor/
├── dashboard/
│   ├── README.md
│   ├── package.json
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── lib/
│   │   ├── types/
│   │   └── mock-data/
│   └── tests/
├── captures/
│   └── .gitkeep
├── test/
│   ├── protocol/
│   └── integration/
└── tools/
```

If the chosen embedded framework requires a different layout, preserve the same separation of concerns and explain the decision in `README.md`.

## Firmware requirements

Implement a minimal, buildable firmware foundation for each ESP32 target.

### Shared CAN layer

Include interfaces for:

- CAN controller initialization.
- Configurable TX and RX GPIOs.
- Configurable Classical CAN or CAN FD mode if supported by the selected hardware.
- Configurable nominal bit rate.
- Standard and extended CAN identifiers.
- Frame receive with timestamp, ID, flags, DLC, and payload.
- Transmit support at the firmware layer, but keep it disabled by default in monitor builds.
- Listen-only mode for passive monitoring.
- Error counters and bus-state reporting.
- Explicit initialization failure and bus-off reporting.

Use a configuration model like this, with values marked as provisional until hardware evidence exists:

```text
NODE_NAME=UNVERIFIED
NODE_NUMBER=UNVERIFIED
CAN_TX_GPIO=UNVERIFIED
CAN_RX_GPIO=UNVERIFIED
CAN_BITRATE=UNVERIFIED
CAN_MODE=listen_only
ENABLE_TX=false
```

If using GPIO21/GPIO22 as an initial ESP32 TWAI candidate, label them as a working assumption in documentation. Do not call them the final Node 3 pin map.

### Raw frame capture

Create a stable raw-frame model containing at least:

```text
timestamp
source_node
can_id
identifier_format
is_remote_frame
dlc
data[0..7] for Classical CAN
bus_state
error_count
```

Keep the capture model separate from application-specific signal decoding.

### Protocol decoder

Create an empty or example decoder interface, but do not add guessed production IDs. The protocol registry must record:

- CAN ID.
- Standard or extended format.
- Sender and receiver.
- Period or trigger.
- DLC.
- Payload fields.
- Byte order.
- Scaling and units.
- Counter/checksum details.
- Evidence source.

### Node 3

Create a dedicated Node 3 target with:

- Its own build/flash instructions.
- A clearly isolated hardware configuration file.
- A startup diagnostic banner.
- CAN initialization and raw receive support.
- Placeholder sections for sensors, inputs, outputs, and application messages.
- No guessed sensor logic or actuator behavior.

Document the Node 3 pin map in `docs/wiring/node-3-pin-map.md` as a table with columns for signal, connected device, voltage, direction, evidence, and verification state.

## Dashboard web app requirements

Build a dashboard shell that can work with mock data before a live ESP32 backend exists.

The dashboard should include:

- Connection status.
- Current bus state.
- CAN frame rate.
- Receive/error/bus-off counters.
- Latest raw CAN frames.
- Filtering by CAN ID, node, and time range.
- A frame detail view showing ID, format, DLC, payload, and timestamp.
- A protocol/decoder status view that distinguishes decoded, unknown, and unverified data.
- Node health cards, including Node 3 when data is available.
- A clear “simulation/mock data” indicator when the dashboard is not connected to hardware.
- Empty, loading, stale-data, disconnected, and error states.

The dashboard must not include:

- Buttons that transmit arbitrary CAN frames.
- Vehicle or actuator control.
- Hidden background transmission.
- Claims that a signal is safe or valid when it is unverified.

If a future command feature is needed, leave an explicitly documented extension point and require a separate approval/specification before implementing it.

### Dashboard data boundary

Define a transport-neutral interface between the dashboard and a future backend. It may use mock JSON or a local adapter initially. Document the expected event shape, for example:

```json
{
  "timestamp": "2026-10-13T00:00:00.000Z",
  "sourceNode": "node3",
  "canId": "0x000",
  "identifierFormat": "standard",
  "dlc": 8,
  "data": [0, 0, 0, 0, 0, 0, 0, 0],
  "busState": "unknown",
  "verified": false
}
```

The example is a schema example only. Do not treat `0x000`, the timestamp, or the payload as a production protocol value.

## Documentation requirements

Create documentation that answers:

1. What is confirmed and what remains unverified?
2. How do I build each firmware target?
3. How do I flash and monitor an ESP32?
4. How do I run the dashboard locally?
5. How do I run the dashboard with mock data?
6. Where is the Node 3 pin map maintained?
7. Where are CAN IDs and payload definitions maintained?
8. How is a hardware value promoted from unverified to verified?
9. What tests have run, and what evidence do they have?
10. What is intentionally out of scope for the dashboard?

## Tests and validation

At minimum, add and run:

- Firmware compile checks for each available target.
- A configuration validation test that rejects missing or obviously invalid CAN settings.
- Raw-frame model/unit tests.
- Protocol registry/decoder tests using clearly marked example data.
- Dashboard type-check/build/lint/test commands appropriate to the chosen framework.
- Dashboard rendering tests for mock frames, no data, disconnected state, and error state.

Do not claim hardware validation from a successful software build. Hardware validation must be recorded separately with the board, transceiver, wiring, measurement, capture, or test result that supports it.

## Git workflow

Use focused commits such as:

```text
chore: create CANScope repository structure
firmware: add shared CAN transport foundation
firmware: scaffold Node 3 target
dashboard: add read-only CAN monitoring shell
test: add raw frame and dashboard mock tests
docs: record hardware assumptions and verification gates
```

Do not commit credentials, private keys, Wi-Fi secrets, or unexplained generated files.

## Mandatory TASK.md workflow

Use `TASK.md` as the canonical task log. If `task.md` already exists and `TASK.md` does not, keep `task.md` as the canonical file unless there is a clear reason to rename it. Do not create both files.

Before meaningful work:

- Read the repository instructions and the current task log.
- Inspect the existing tree and Git status.
- Record the intended scope and the values that are still unverified.

After every work session and every meaningful task:

- Update `TASK.md` before reporting completion.
- Record the date, summary, files changed, commands run, test results, newly verified facts, assumptions, blockers, and next action.
- Record failed or skipped tests; never imply they passed.
- Preserve earlier decisions and results rather than silently deleting them.

## Acceptance criteria

The task is complete when:

- The repository has the documented project structure.
- The firmware targets have a buildable baseline or a clearly documented toolchain blocker.
- Node 3 has a dedicated scaffold and an explicit unverified hardware configuration.
- The dashboard runs with mock data and is visibly read-only/monitoring-only.
- Raw frames and unknown/unverified protocol values can be represented without data loss.
- Build/test instructions work or document the exact blocker.
- `README.md`, hardware-status documentation, and protocol templates exist.
- `TASK.md` contains the completed work, evidence, failures, and next steps.

## First response expected from Claude

Before editing, report:

1. The repository path and current Git status.
2. The detected language/toolchain options.
3. Whether an existing `TASK.md` or `task.md` exists.
4. The proposed structure and any deviations from this task.
5. The hardware and protocol facts that remain unverified.

Then implement the smallest buildable slice, update the task log, run the available checks, and continue in small, reviewable steps.
