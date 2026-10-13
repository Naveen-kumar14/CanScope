# CANScope ESP32 CAN bus monitoring project

Project brief and Claude Code handoff

Updated: 2026-10-13  
Source: referenced conversation **Embedded CANScope Project**

## 1. Purpose

CANScope is an ESP32-based CAN bus monitoring project. The intended result is a small, repeatable system that can connect to a CAN bus, receive and decode frames, show or log useful traffic, and provide node-specific firmware—especially for Node 3.

This document is the working handoff for implementation. It separates facts recovered from the referenced conversation from engineering assumptions that still need to be checked on the actual boards.

## 2. What was recovered from the referenced conversation

The available conversation record contains these project threads:

- The project is called **Embedded CANScope Project**.
- The user asked for the components used in **Node 3**.
- The user asked for **all Node 3 connections, pin by pin**.
- The user asked how to make code for **each ESP32**.
- The user asked whether it was time to give work to **Claude**.
- The user then asked for the whole project to be put into one Markdown file and for its work to be maintained in `TASK.md`.

The detailed answers to those earlier questions were stored in the source conversation as content references. They were not included in the retrievable transcript, and there are no uploaded schematics, firmware files, bus captures, or component lists attached to the reference. Therefore, no specific Node 3 sensor, exact GPIO assignment, CAN ID, baud rate, or payload definition should be treated as confirmed from the source conversation.

## 3. Status legend

Use these labels throughout the project:

- **Confirmed** — directly observed in the repository, on the hardware, or in a supplied datasheet/capture.
- **Working assumption** — a provisional value used to make progress; it must be replaced or accepted after verification.
- **Unverified** — not recoverable from the available project record.
- **Blocked** — work cannot safely continue until the named information or hardware is available.

## 4. Project requirements

### Functional requirements

1. Connect one or more ESP32 nodes to a CAN bus through a suitable 3.3 V-compatible CAN transceiver.
2. Receive CAN frames without corrupting or silently dropping traffic.
3. Identify frames by CAN ID, DLC, data bytes, timestamp, and source node where the protocol allows it.
4. Decode known application messages into named signals only after the CAN ID and payload layout are verified.
5. Provide a diagnostic view or log that makes raw frames available even when decoding is incomplete.
6. Keep node firmware separate enough that each ESP32 can be built, flashed, and tested independently.
7. Record wiring, firmware behavior, test results, and unresolved questions in the repository.

### Non-functional requirements

- Protect the ESP32 from incompatible transceiver voltage levels.
- Use proper CAN termination and bus wiring.
- Make the firmware fail visibly when CAN initialization or bus communication fails.
- Keep raw CAN data available for later protocol analysis.
- Do not claim a hardware or protocol value is final until it has evidence.

## 5. Proposed system architecture

The following is the working architecture to validate against the real design:

```text
   Node 1 ESP32 + transceiver ─┐
   Node 2 ESP32 + transceiver ─┼── CANH/CANL bus ── CANScope monitor ESP32
   Node 3 ESP32 + transceiver ─┘                         │
                                                        ├─ serial/USB debug
                                                        ├─ display or web view (if used)
                                                        └─ SD/Wi-Fi logging (if used)
```

The exact number of nodes, the role of Node 3, and whether the monitor has a display, storage, or Wi-Fi output are **unverified**. Keep those as replaceable configuration decisions rather than hard-coding them into the first firmware version.

### Recommended firmware layers

1. **Board configuration** — GPIOs, transceiver type, node name, and bus speed.
2. **CAN driver** — controller initialization, transmit, receive, error state, and recovery.
3. **Frame capture** — timestamp, ID, flags, DLC, payload, and error counters.
4. **Protocol decoder** — application-specific message definitions, kept separate from raw capture.
5. **Application behavior** — Node 3 sensing/actuation or monitor output, once confirmed.
6. **Diagnostics** — startup banner, bus state, counters, and an explicit error message for failed initialization.

## 6. Components

### Confirmed from the accessible record

- ESP32 development boards are part of the project.
- A CAN bus interface is part of the project.
- There is a distinct **Node 3** whose parts and pin connections matter.

### Likely components to verify on the bench

| Item | Purpose | Status / verification needed |
|---|---|---|
| ESP32 development board for each node | Processing and CAN controller | Confirm exact board variant and 3.3 V pinout |
| 3.3 V CAN transceiver, such as SN65HVD230/TJA1051-compatible module | Converts ESP32 logic to CANH/CANL | Confirm exact part and module voltage limits |
| CANH/CANL twisted-pair wiring | Differential bus | Confirm connector and cable arrangement |
| 120 ohm termination resistors | Terminate the two physical ends of the bus | Confirm that exactly two end terminations are fitted |
| Common ground/reference wire | Provides a shared electrical reference where required | Confirm whether the chosen transceiver and installation require it |
| USB power/programming connection | Flashing and serial diagnostics | Confirm power budget and ground reference |
| Node 3 sensors or I/O devices | Node 3 application function | **Unverified**; recover from schematic or hardware inventory |
| Display, storage, or network link for CANScope | Human-readable monitoring/logging | **Unverified**; do not assume one is present |

Do not substitute a 5 V-only CAN transceiver without checking the ESP32 logic-level compatibility and the module schematic.

## 7. Pin maps

### 7.1 Candidate ESP32-to-transceiver map

This is a common ESP32 TWAI arrangement, not a confirmed project wiring. The actual GPIOs must be checked against the board schematic and any pins already used by Node 3 peripherals.

| ESP32 signal | Candidate ESP32 pin | Transceiver signal | Electrical note | Status |
|---|---:|---|---|---|
| CAN controller TX | GPIO22 | TXD / data input | ESP32 output to transceiver | Working assumption |
| CAN controller RX | GPIO21 | RXD / data output | Transceiver output to ESP32 | Working assumption |
| Logic supply | 3V3 | VCC | Confirm the transceiver module is 3.3 V compatible | Working assumption |
| Ground | GND | GND | Common reference | Working assumption |
| CAN bus high | — | CANH | Connect to bus CANH | Working assumption |
| CAN bus low | — | CANL | Connect to bus CANL | Working assumption |
| Silent/standby control, if present | GPIO or fixed level | RS/STB/EN | Follow the exact transceiver datasheet | Unverified |

ESP32 GPIO21/GPIO22 are only a starting point. They are not safe to publish as the final Node 3 pin map until the board, transceiver, and other Node 3 connections are identified.

### 7.2 Node 3 pin-by-pin connection sheet

Fill this table from the actual Node 3 board before powering it. It is deliberately explicit so the final wiring can be reviewed one pin at a time.

| Node 3 pin / signal | Connects to | Wire purpose | Voltage / direction | Evidence | State |
|---|---|---|---|---|---|
| ESP32 3V3 | Transceiver VCC and approved 3.3 V peripherals | Logic power | 3.3 V output | Board + transceiver datasheets | Unverified |
| ESP32 GND | Transceiver GND and required peripheral grounds | Reference / return | 0 V | Wiring inspection | Unverified |
| ESP32 CAN TX GPIO | Transceiver TXD | CAN controller transmit | 3.3 V logic output | Firmware + datasheet | Unverified |
| ESP32 CAN RX GPIO | Transceiver RXD | CAN controller receive | 3.3 V logic input | Firmware + datasheet | Unverified |
| Transceiver CANH | Bus CANH | Differential bus line | CAN physical layer | Continuity test | Unverified |
| Transceiver CANL | Bus CANL | Differential bus line | CAN physical layer | Continuity test | Unverified |
| Transceiver standby/silent/enable | Fixed safe level or ESP32 GPIO | Operating mode control | Datasheet-specific | Datasheet + measurement | Unverified |
| Node 3 sensor power | Sensor VCC | Sensor supply | Device-specific | Sensor datasheet | Unverified |
| Node 3 sensor ground | Sensor GND | Sensor return | 0 V | Wiring inspection | Unverified |
| Node 3 sensor signal(s) | Assigned ESP32 GPIO / bus | Application input | Device-specific | Sensor datasheet | Unverified |
| Node 3 output/actuator signal(s) | Assigned ESP32 GPIO / driver | Application output | Device-specific | Schematic + load test | Unverified |

### 7.3 CAN bus wiring rules to verify

- CANH must remain CANH end-to-end; CANL must remain CANL end-to-end.
- The bus should have one 120 ohm termination at each physical end, not one termination per node.
- Measure the resistance between CANH and CANL with power removed. A correctly terminated two-end bus is commonly about 60 ohms, subject to the installed topology.
- Keep stubs short and use a suitable twisted pair.
- Confirm that every transceiver is in normal mode, not standby or silent mode.
- Never connect CANH/CANL directly to ESP32 GPIOs.

## 8. CAN IDs and protocol requirements

### Current evidence

No actual CAN identifiers, bit rates, frame formats, signal definitions, or byte order were present in the retrievable source record. The values in this section are therefore requirements to discover or verify, not project facts.

### Protocol information that must be recorded

| Field | Required value | Current state |
|---|---|---|
| CAN version | Classical CAN or CAN FD | Unverified |
| Identifier type | 11-bit standard or 29-bit extended | Unverified |
| Nominal bit rate | e.g. 125 kbit/s, 250 kbit/s, 500 kbit/s, or 1 Mbit/s | Unverified |
| Data phase bit rate, if CAN FD | Required only for CAN FD | Unverified |
| Bus sample point / timing | Controller configuration | Unverified |
| Frame direction | Which node transmits each ID | Unverified |
| DLC | Bytes per message | Unverified |
| Byte order | Little-endian, big-endian, or mixed | Unverified |
| Signal scaling | Factor, offset, min/max, unit | Unverified |
| Counter / checksum | Algorithm and placement, if present | Unverified |
| Startup and heartbeat behavior | Period and timeout | Unverified |
| Error handling | Bus-off recovery and timeout behavior | Unverified |

### ID definition template

Do not create decoder logic from guessed IDs. Populate this table from a specification, a known-good capture, or a controlled two-node test.

| CAN ID | Format | Sender | Receiver(s) | Period / trigger | DLC | Payload definition | Checksum / counter | Evidence |
|---:|---|---|---|---|---:|---|---|---|
| `0x___` | standard / extended | Node __ | Node __ | __ ms / event | __ | byte 0: __; byte 1: __ | __ | __ |
| `0x___` | standard / extended | Node __ | Node __ | __ ms / event | __ | byte 0: __; byte 1: __ | __ | __ |
| `0x___` | standard / extended | Node __ | Node __ | __ ms / event | __ | byte 0: __; byte 1: __ | __ | __ |

### Safe bring-up defaults

These are engineering defaults for a first controlled test only:

- Start with Classical CAN and standard 11-bit frames unless the hardware or protocol says otherwise.
- Use the bus bit rate confirmed by the existing network. If there is no existing network, start at the rate selected by the test plan and record it in firmware configuration.
- Begin with raw frame logging before signal decoding.
- Use unique test IDs assigned in the test plan; do not reuse production IDs without agreement.
- Keep transmit disabled during passive monitoring tests.

## 9. Firmware behavior

Each ESP32 firmware image should have a small configuration section containing:

```text
NODE_NAME
NODE_NUMBER
CAN_TX_GPIO
CAN_RX_GPIO
CAN_BITRATE
CAN_MODE          # listen-only, normal, or no-ack test mode
ENABLE_TX
```

At startup, firmware should print:

1. Node name and firmware version.
2. Board and transceiver configuration.
3. CAN TX/RX GPIOs and selected bit rate.
4. Operating mode and transmit permission.
5. CAN initialization result.
6. Receive, transmit, error, and bus-off counters.

The monitor should capture at least:

```text
timestamp, node, can_id, frame_format, rtr, dlc, data[0..7], bus_state, error_count
```

If the system uses CAN FD, extend the payload and frame metadata rather than silently truncating it.

## 10. Build and test stages

### Stage 0 — inventory and evidence

- Photograph or identify every ESP32 board and CAN transceiver.
- Record exact part numbers and module schematics.
- Recover the Node 3 component list and complete the pin-by-pin table.
- Locate any existing firmware, wiring diagram, protocol specification, or CAN capture.
- Decide the canonical task file name: `TASK.md` or `task.md`.

Exit condition: the hardware inventory and unresolved questions are written down.

### Stage 1 — one-board electrical check

- Confirm 3.3 V logic compatibility.
- Check power and ground continuity with power removed.
- Check CANH/CANL continuity and termination resistance.
- Confirm no ESP32 boot-strapping or flash pins were accidentally assigned.

Exit condition: the board powers safely and the final candidate pin map has evidence.

### Stage 2 — CAN controller loopback

- Build the smallest firmware that initializes the ESP32 CAN controller.
- Test internal loopback if supported by the chosen driver.
- Confirm transmit and receive timestamps, DLC, and payload.
- Confirm error reporting when CAN initialization is deliberately misconfigured.

Exit condition: controller-level behavior is repeatable without connecting to the vehicle or external bus.

### Stage 3 — two-node bench bus

- Connect two known-good CAN nodes with correct termination.
- Run a controlled test ID and payload.
- Confirm both directions, frame rate, and error counters.
- Verify listen-only behavior for the monitor.

Exit condition: the bus carries known frames without unexpected errors.

### Stage 4 — Node 3 integration

- Connect Node 3 only after its pin map is reviewed.
- Test each Node 3 sensor or output separately.
- Add the real CAN IDs and payload definitions from evidence.
- Capture raw traffic before enabling automatic decoding or actuation.

Exit condition: Node 3 behavior is demonstrated and its wiring and protocol entries are no longer unverified.

### Stage 5 — monitoring and fault tests

- Check bus-off, missing-node, wrong-bitrate, disconnected-CANH, and disconnected-CANL behavior.
- Confirm that logs identify errors instead of presenting stale values as live data.
- Test restart and recovery behavior.
- Measure useful logging duration and storage/network failure behavior if those features exist.

Exit condition: failures are visible, recoverable where intended, and documented.

## 11. Repository and Git workflow

Recommended layout:

```text
CANScope/
├── README.md
├── TASK.md                 # or task.md; choose one canonical name
├── docs/
│   ├── CANScope_Project_Brief.md
│   ├── wiring/
│   └── protocol/
├── firmware/
│   ├── common/
│   ├── node1/
│   ├── node2/
│   ├── node3/
│   └── monitor/
├── captures/
├── test/
└── tools/
```

Use small, descriptive commits. A practical sequence is:

```text
docs: add CANScope hardware inventory
firmware: add ESP32 CAN initialization
test: verify two-node CAN frame exchange
firmware: add Node 3 application message
docs: record verified Node 3 pin map
```

Before committing:

- Review the diff, including `TASK.md`/`task.md`.
- Keep secrets, Wi-Fi credentials, tokens, and private captures out of Git.
- Record the exact build and test commands.
- State what passed, what failed, and what remains unverified.
- Do not overwrite another contributor's work without inspecting it first.

## 12. Ready-to-paste Claude Code instruction

Paste the following as the project-level instruction or at the start of a Claude Code session:

```text
You are working on the Embedded CANScope ESP32 CAN bus monitoring project.

Project rules:

1. Before doing meaningful work, inspect the repository and read the canonical task file. Use TASK.md if it exists; otherwise use task.md. If neither exists, create TASK.md. Do not create both files. If both already exist, stop and resolve them into one canonical file before continuing, preserving useful information and noting the decision.

2. Treat the CANScope project brief, schematics, datasheets, firmware, test captures, and measured results as the source of truth. Never present an assumed ESP32 GPIO, transceiver type, CAN bit rate, CAN ID, payload layout, termination arrangement, or Node 3 connection as verified without evidence.

3. Before changing hardware-facing code, state which values are confirmed, which are working assumptions, and which are unverified. Prefer configuration constants and clearly named TODOs over hidden guesses.

4. After every work session and after every meaningful task—whether the task succeeds, partially succeeds, or is blocked—update TASK.md/task.md. The update must include:
   - date and short session summary;
   - work completed;
   - files changed;
   - commands, builds, and tests run;
   - results and evidence;
   - hardware or protocol values newly confirmed;
   - assumptions and unresolved questions;
   - blockers and their exact cause;
   - the next concrete action.

5. Keep the task file current before replying that work is complete. A task is not complete merely because code was edited. Include the verification result, or explicitly say that verification could not be performed.

6. Preserve history in the task file. Add dated updates; do not silently delete prior decisions, test results, or blockers. Correct an old entry only when necessary, and note the correction.

7. For Node 3, maintain a pin-by-pin wiring table and do not mark a connection verified until it has a schematic, datasheet, continuity test, measured voltage, or other named evidence. Record the evidence beside the connection.

8. For CAN protocol work, maintain a table of CAN ID, standard/extended format, sender, receiver, period, DLC, payload fields, byte order, scaling, counter/checksum, and evidence. If an ID or payload is guessed, label it as a working assumption and keep raw-frame logging enabled.

9. Prefer safe bring-up: power and continuity checks first, then controller loopback, then a two-node bench bus, then Node 3 integration. Keep transmit disabled during passive monitoring tests unless the test explicitly requires transmission.

10. Run the narrowest useful build or test after each change. Report failures plainly. Do not claim a test passed when it was not run, and do not claim hardware validation from compilation alone.

11. Keep commits focused and use descriptive messages. Do not commit credentials, private keys, or unexplained generated files.

At the end of every response, include the current task-file status and the next action. Before ending the session, update the task file one final time.
```

## 13. First TASK.md entry to create

Use this as the initial entry once the repository is available:

```markdown
# CANScope task log

## Current status

- Phase: inventory and evidence collection
- Overall state: blocked on exact Node 3 hardware, pin map, and CAN protocol details
- Canonical task file: TASK.md

## 2026-10-13 — project brief created

### Completed

- Consolidated the accessible Embedded CANScope conversation context.
- Documented the ESP32/CAN architecture as a working design.
- Added a Node 3 pin-by-pin verification table.
- Added CAN ID and protocol-definition templates.
- Added build, bench-test, and Git workflow stages.
- Added Claude Code instructions requiring a task-file update after every work session and meaningful task.

### Not yet verified

- Exact ESP32 board variants.
- Node 3 components and application role.
- ESP32 CAN TX/RX GPIO assignments.
- CAN transceiver part and voltage compatibility.
- CAN bit rate, CAN version, identifier format, IDs, and payload definitions.
- Monitor display, storage, or network features.

### Next actions

1. Collect the Node 3 board photos, schematic, or component inventory.
2. Confirm the transceiver part number and module schematic.
3. Complete and review the pin-by-pin table.
4. Locate a protocol specification or capture a controlled two-node test.
```

## 14. Open questions that must be answered before final hardware claims

1. Which exact ESP32 board is used for Node 3?
2. What is the exact CAN transceiver part or module?
3. What sensors, inputs, outputs, or peripherals belong to Node 3?
4. Are GPIO21 and GPIO22 available, or are different CAN pins required?
5. Is the bus Classical CAN or CAN FD?
6. What nominal bit rate and identifier format does the bus use?
7. Which CAN IDs are produced and consumed by each node?
8. Is CANScope passive-only, or may it transmit diagnostics or commands?
9. Does the monitor use USB serial, a display, SD storage, Wi-Fi, or another output?
10. Where are the two physical bus ends, and where are the 120 ohm terminators installed?

Until these questions are answered with evidence, the project is ready for inventory and controlled bring-up—not for declaring the Node 3 wiring or CAN protocol final.
