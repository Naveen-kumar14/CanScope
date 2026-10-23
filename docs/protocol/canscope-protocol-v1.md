# CANScope protocol v1

**Single source of truth:** [`protocol/canscope_protocol.json`](../../protocol/canscope_protocol.json). This page describes it. If the two disagree, the JSON wins.

`python tools/protocol/gen_protocol.py` generates the code from it:

| Generated file | Used by |
|---|---|
| `firmware/common/canscope_protocol/protocol_spec.h` | all firmware (IDs, ranges, thresholds, timeouts, fault table, commands) |
| `dashboard/src/lib/protocol-spec.generated.ts` | dashboard (decoder, command forms, fault labels) |
| `test/protocol/protocol_vectors.generated.h` | C++ codec tests |
| `dashboard/tests/protocol-vectors.generated.ts` | TypeScript codec tests |

The generator encodes its golden vectors independently, and both the C++ codec and the TypeScript decoder are tested against the same bytes. `tools/run-host-tests.sh` runs `gen_protocol.py --check`, so a stale generated file fails the tests.

Status: **defined by the project**, and checked only by unit tests and compilation. **No v1 frame has been captured on the physical bus yet.**

## 1. Bus

| Item | Value |
|---|---|
| CAN | classical CAN 2.0A (ESP32 TWAI cannot do CAN FD) |
| Identifiers | standard 11-bit only. An extended frame is never a v1 frame, even with the same number |
| Bit rate | 500 kbit/s (ESP-IDF `TWAI_TIMING_CONFIG_500KBITS`) |
| Byte order | big-endian (most significant byte first) for multi-byte fields |
| DLC | always 8. Any other DLC, or a remote frame, is rejected |
| Byte 6 | rolling counter, +1 per frame of that ID, wraps 255 → 0 |
| Byte 7 | checksum = `~(id_hi + id_lo + byte0 + … + byte6) & 0xFF` |
| Transceivers | SN65HVD230 (3.3 V) per node. CANH/CANL never touch a GPIO |

### Frame ownership

| ID | Name | Sender | Period |
|---|---|---|---|
| `0x120` | MOTOR_TELEMETRY | Node 1 | 100 ms |
| `0x220` | BATTERY_TELEMETRY | Node 2 | 100 ms |
| `0x701` | NODE1_HEARTBEAT | Node 1 | 500 ms |
| `0x702` | NODE2_HEARTBEAT | Node 2 | 500 ms |

Node 3 (the monitor) **never transmits**. It runs in TWAI normal mode with `ENABLE_TX=false`, so it ACKs frames (needed when only one ECU is on the bus) but sends no data frame. `-DMONITOR_LISTEN_ONLY=1` makes it fully passive. The legacy test IDs `0x201/0x202/0x203/0x210` (from `sketch_node2_test`) are not part of v1. The generator refuses any v1 ID that collides with them.

### Payloads (raw integer × factor = physical value)

**0x120 MOTOR_TELEMETRY**

| Bytes | Field | Type | Factor | Unit | Valid raw range | Default |
|---|---|---|---|---|---|---|
| 0–1 | `rpm` | uint16 | 1 | rpm | 0 … 8000 | 1500 |
| 2–3 | `motorTempC` | int16 | 0.1 | °C | −400 … 1500 (−40.0 … 150.0) | 650 (65.0) |
| 4–5 | reserved | | | | sent as 0 | |
| 6 | counter | | | | | |
| 7 | checksum | | | | | |

**0x220 BATTERY_TELEMETRY**

| Bytes | Field | Type | Factor | Unit | Valid raw range | Default |
|---|---|---|---|---|---|---|
| 0–1 | `packVoltageV` | uint16 | 0.01 | V | 0 … 6000 (0 … 60.00) | 4800 (48.00) |
| 2–3 | `packCurrentA` | int16 | 0.1 | A, + = discharge | −1500 … 1500 (±150.0) | 120 (12.0) |
| 4 | `socPct` | uint8 | 1 | % | 0 … 100 | 85 |
| 5 | reserved | | | | sent as 0 | |
| 6 / 7 | counter / checksum | | | | | |

**0x701 / 0x702 HEARTBEAT**

| Byte | Field | Notes |
|---|---|---|
| 0 | `protocolVersion` | 1. Anything else = incompatible |
| 1 | `nodeId` | must equal the ID's node (1 for 0x701, 2 for 0x702) |
| 2–4 | `fwMajor.fwMinor.fwPatch` | firmware version of the ECU |
| 5 | `canState` | the ECU's **own** controller: 0 error active, 1 error warning, 2 error passive (also used while bus-off/recovering) |
| 6 / 7 | counter / checksum | |

### Validation order (Node 3 and dashboard decoder)

`extended → unsupported ID → remote → DLC → checksum → (heartbeat: node id → version → range) / (telemetry: range)`. A frame that fails any check is **rejected whole**: none of its values are used.

## 2. Timing and fault detection (Node 3)

All values come from `timing` in the JSON. Node 3 uses only what it receives and its own controller state. Commands sent to an ECU are never an input.

| Parameter | Value |
|---|---|
| Telemetry timeout | 500 ms without a valid telemetry frame |
| Heartbeat timeout | 1500 ms without a heartbeat |
| Start-up grace | 2000 ms after monitoring starts (boot, or after the monitor's own bus-off) before "never seen" is a fault |
| Silent bus | 1500 ms with no frame of any kind |
| Thresholds | raise after 3 consecutive frames over the limit, clear after 3 consecutive frames past the hysteresis level |
| Counter frozen | 3 consecutive frames with the same counter. Clears after 3 good increments |
| Integrity faults (DLC / checksum / value) | raised on the first bad frame; cleared on a valid frame of that node ≥ 2000 ms after the last bad one |
| RX overrun | cleared 5000 ms after the last lost frame |

| Code | Severity | Scope | Raised when | Recovers when |
|---|---|---|---|---|
| HEARTBEAT_LOST | critical | ECU | no heartbeat > 1500 ms (or none after grace) | any heartbeat |
| TELEMETRY_STALE | warning | ECU | no **valid** telemetry > 500 ms | next valid telemetry |
| INVALID_DLC | warning | ECU | DLC ≠ 8 or RTR on a v1 ID | integrity clear rule |
| CHECKSUM_ERROR | warning | ECU | byte 7 wrong | integrity clear rule |
| COUNTER_FROZEN | warning | ECU | counter repeated 3× | 3 increments |
| VALUE_INVALID | warning | ECU | field out of range, or wrong heartbeat node id | integrity clear rule |
| PROTOCOL_VERSION_MISMATCH | critical | ECU | heartbeat version ≠ 1 (node counts as alive; its telemetry is rejected) | v1 heartbeat |
| ECU_CAN_ERROR_PASSIVE | warning | ECU | heartbeat byte 5 = 2 | heartbeat byte 5 < 2 |
| MOTOR_TEMP_HIGH | warning | Node 1 | temp ≥ 95.0 °C | < 90.0 °C |
| MOTOR_OVERTEMP | critical | Node 1 | temp ≥ 110.0 °C | < 105.0 °C |
| MOTOR_OVERSPEED | critical | Node 1 | rpm ≥ 6500 | < 6300 |
| BATTERY_UNDERVOLTAGE | critical | Node 2 | V ≤ 42.00 | > 43.00 |
| BATTERY_OVERVOLTAGE | critical | Node 2 | V ≥ 55.00 | < 54.50 |
| BATTERY_OVERCURRENT | critical | Node 2 | \|I\| ≥ 100.0 A | < 90.0 A |
| BATTERY_SOC_LOW | warning | Node 2 | SoC ≤ 15 % | > 20 % |
| MONITOR_CAN_NOT_RUNNING | critical | monitor | own controller not started / stopped | controller running |
| MONITOR_BUS_OFF | critical | monitor | own controller bus-off or recovering | left bus-off |
| MONITOR_ERROR_PASSIVE | warning | monitor | own TEC/REC ≥ 128 | below 128 |
| MONITOR_RX_OVERRUN | warning | monitor | RX queue overflowed | 5 s without overruns |
| BUS_SILENT | critical | monitor | controller running, no frame at all | any frame |

**Missing heartbeat vs real bus-off.**
- While the monitor's **own** controller is not running or is bus-off, it raises `MONITOR_CAN_NOT_RUNNING` / `MONITOR_BUS_OFF`, suspends every node timeout, and reports the node links as `unknown`. It never claims an ECU is lost when it cannot listen.
- When monitoring resumes, a fresh grace period starts.
- If an ECU's last heartbeat reported error passive and then the heartbeat stops, the `HEARTBEAT_LOST` detail says "ECU was error passive (bus-off?)".
- The ECU's own USB `status` / `ecu_state` lines report its actual bus-off.
- Bus-off recovery is never automatic. It takes serial `recover` or Node 3 button B long press.

### Demonstration faults (ECU side)

Each one only changes what the ECU transmits. The ECU never announces it on CAN.

| `fault <name>` | On the wire | Node 3 must detect (tested contract) |
|---|---|---|
| `heartbeat_stop` | no heartbeat | HEARTBEAT_LOST |
| `telemetry_stop` | no telemetry | TELEMETRY_STALE |
| `silent` | nothing | HEARTBEAT_LOST, TELEMETRY_STALE |
| `invalid_value` | rpm raw 65535 (Node 1) / SoC raw 255 (Node 2), valid checksum | VALUE_INVALID, TELEMETRY_STALE |
| `bad_dlc` | telemetry with DLC 4 | INVALID_DLC, TELEMETRY_STALE |
| `bad_checksum` | byte 7 XOR 0x5A | CHECKSUM_ERROR, TELEMETRY_STALE |
| `counter_freeze` | counter stops incrementing | COUNTER_FROZEN |
| `bad_version` | heartbeat version 99 | PROTOCOL_VERSION_MISMATCH, TELEMETRY_STALE |

`test/firmware_host/test_monitor_core.cpp` (`test_demo_fault_contract`) drives the real ECU core into the real monitor core for every row, on both ECUs. It checks for exactly these detections, nothing else, and full recovery after `fault clear`. Threshold faults are demonstrated with `set`, for example `set temp 112`.

## 3. USB serial

| Item | Value |
|---|---|
| Speed | 460800 baud, 8N1, all three CANScope nodes (legacy sketches: 115200) |
| Device → host | one line per message: `# text` = human diagnostic, `{…}` = JSON event. Max 2048 characters |
| Host → device | `[@<id> ]<verb> [args…]\n`. Max 120 characters, ASCII. Longer lines are discarded and rejected |
| Command id | `@` + 1–16 of `A-Z a-z 0-9 _ -`. Echoed in the ack |
| Ack timeout (dashboard) | 1500 ms |

ESP32 ROM boot messages are printed at 115200 baud, so they appear as a few invalid lines at 460800. The dashboard counts and ignores them.

### Device lines (JSON `type`)

| type | Sent by | When | Meaning |
|---|---|---|---|
| `hello` | all | boot, every 5 s, on `hello` | identity: node, role, firmware, `bootId` (random per boot), protocol versions, supported verbs |
| `status` | all | every 1 s | own CAN controller: state, counters, mode, TX permission, and `transceiverCheck` (start-up echo check: `ok`, `no_echo`, `rx_not_driven`, `rx_stuck_dominant`, `inconsistent`, `not_run`) |
| `ack` | all | once per command line | `status`: `ok` / `rejected` / `unsupported` + `detail`, `id`, `command` |
| `ecu_state` | node1, node2 | every 1 s and after every accepted command | **self-reported**: profile, demo fault, setpoints, values sent, TX ok/failed |
| `frame` | monitor | every received frame (`frames off` stops it) | raw frame + `kind`, `check`, `accepted` |
| `telemetry` | monitor | ≤ 5 Hz per ECU while frames arrive, ≥ 1 Hz otherwise | **observed** last accepted values, `ageMs`, `state` |
| `node_health` | monitor | every 1 s per ECU | heartbeat/telemetry link state, ages, ECU firmware/version/CAN state, reject counters |
| `fault` | monitor | on every raise / clear | `eventId` (monotonic per `bootId`), code, node, severity, `state` `active`/`cleared`, detail |
| `faults` | monitor | every 1 s | authoritative list of active faults (≤ 10 listed; `count` and `truncated` tell the truth) |
| `selftest` | monitor | boot, on `hello` | CAN init result, OLED probe, buttons at boot, buzzer build state |

The exact shapes are asserted in `test/firmware_host/test_serial_link.cpp`, `test_ecu_core.cpp` and `test_monitor_ui.cpp`. The same lines are parsed in `dashboard/tests/serial-line-parser-v1.test.ts`.

### Commands

| Verb | Node 1 | Node 2 | Monitor |
|---|---|---|---|
| `hello`, `status`, `help` | ✓ | ✓ | ✓ |
| `recover` | ✓ (only while bus-off) | ✓ | ✓ |
| `set rpm <0..8000>` / `set temp <-40.0..150.0>` | ✓ | | |
| `set voltage <0..60.00>` / `set current <-150.0..150.0>` / `set soc <0..100>` | | ✓ | |
| `profile static\|drive` | ✓ | ✓ | |
| `fault <demo fault>\|clear` | ✓ | ✓ | |
| `faults`, `frames on\|off`, `silence` | | | ✓ |

Numbers are parsed exactly, without floating point. The rules: an optional sign, digits, and at most as many decimals as the field allows (rpm 0, temp/current 1, voltage 2, SoC 0). Exponents, hex, trailing characters, out-of-range values and unknown parameters are rejected, and the setpoint stays unchanged. A verb the node does not handle returns `unsupported`. `drive` varies values deterministically around the setpoint (rpm ±8 %/10 s, temp ±1.0 °C/30 s, voltage ±0.30 V/20 s, current ±15 %/8 s) and stays inside the valid ranges.

An `ok` ack means the ECU accepted the setting. It does **not** mean the monitor saw it; only Node 3's `telemetry` / `fault` lines say that.

## 4. Versions

- `protocolVersion` (CAN, heartbeat byte 0) and `serialProtocolVersion` (USB, `hello`) are both 1.
- A node with another CAN version is flagged and its telemetry rejected.
- The dashboard shows each node's versions from `hello`.
- Firmware versions: Node 1/2/monitor `1.0.0`.
- Changing any layout requires a new version number in the JSON.
