# CANScope architecture

## System view (working design, not verified)

```text
 Node 1 ESP32 + transceiver ─┐
 Node 2 ESP32 + transceiver ─┼── CANH/CANL bus ── monitor ESP32 (listen-only)
 Node 3 ESP32 + transceiver ─┘                         │ USB serial, JSON lines
                                                        ▼
                                   (future) host bridge: serial → WebSocket/HTTP
                                                        ▼
                                           dashboard (read-only, browser)
```

The number of nodes, Node 3's role, and the monitor's output path are unverified. Today the only implemented output is USB serial, and the dashboard uses a mock source.

## Firmware layers (`firmware/common`)

| Layer | Library | Portable? | Responsibility |
|---|---|---|---|
| Board configuration | `<node>/include/<node>_hw_config.h` | yes | Node name and number, GPIOs, bit rate, mode, `ENABLE_TX`, evidence status of each value |
| Config validation | `can_config` | yes | Rejects UNVERIFIED pins/bit rate, invalid ESP32 pins, CAN FD, TX in listen-only. Warns about strapping and PSRAM pins |
| CAN driver | `can_transport` | interface + TX gate yes; `TwaiTransport` ESP32 only | Install/start, receive, gated transmit, alerts, error counters, bus-off reporting, explicit recovery request |
| Frame capture | `frame_capture` | yes | `RawFrame` model and JSON-line encoder. Keeps every frame, known or not |
| Protocol decoder | `protocol_decoder` | yes | Registry and decoder: `unknown` / `unverified` / `decoded` / `mismatch`. Physical values only for verified entries |
| Diagnostics | `diagnostics` | yes | Start-up banner and init result, as `# ` lines |
| Runtime | `node_runtime` | ESP32 only | Shared `setup()`/`loop()`: banner → validate → start → drain frames → alerts → status every 1 s |

The portable libraries carry no Arduino dependency and are unit-tested on the PC (`test/`).

### Transmit policy

`check_transmit_allowed()` refuses TX unless **all** of these hold: `ENABLE_TX=true`, mode is not listen-only, the driver is running, the bus is not off or recovering, and the frame is valid classical CAN. Every target ships with `ENABLE_TX=false`. Bus-off recovery is **never automatic**: `request_bus_off_recovery()` exists but nothing calls it yet (policy TODO).

## Serial line protocol (device → host)

USB serial at 115200 baud. One line per message:

- Lines starting with `# ` are human diagnostics (banner, init result, alerts).
- Lines starting with `{` are JSON events.
- The host must reject anything else and never guess at it.

Frame event (field names match the dashboard model):

```json
{"type":"frame","sourceNode":"monitor","deviceTimeUs":1234567890123,"canId":"0x7A0",
 "identifierFormat":"standard","remote":false,"dlc":3,"data":[0,127,255],
 "busState":"error_active","txErrorCount":0,"rxErrorCount":5}
```

Status event (every 1 s per node):

```json
{"type":"status","sourceNode":"node3","deviceTimeUs":1000,"busState":"stopped","driverRunning":false,
 "mode":"listen_only","txEnabled":false,"bitrate":0,"configStatus":"UNVERIFIED","txErrorCount":0,
 "rxErrorCount":0,"rxFrames":0,"txFrames":0,"txFailed":0,"rxMissed":0,"busErrors":0,
 "arbitrationLost":0,"busOffEvents":0}
```

These examples are schema examples (`0x7A0` is an EXAMPLE ID). The contract is enforced from both sides: `test/firmware_host/test_raw_frame.cpp` asserts the encoder's exact output, and `dashboard/tests/serial-line-parser.test.ts` parses that same line.

Notes:
- `sourceNode` is the node that **captured** the frame. CAN frames carry no sender address, so the sender can only be inferred from the registry.
- `deviceTimeUs` is ESP32 monotonic time (`esp_timer_get_time`). The ESP32 has no wall clock, so the host adds the ISO `timestamp` on receipt.
- Standard IDs are printed as 3 hex digits and extended IDs as 8. The two formats never alias.

## Dashboard data boundary (`dashboard/src/lib/data-source.ts`)

```ts
interface CanDataSource {
  readonly kind: 'mock' | 'live';
  readonly label: string;
  connect(handlers: { onEvent(e: CanScopeEvent): void; onConnectionChange(state, detail?): void }): void;
  disconnect(): void;
}
```

`CanScopeEvent` is `CanFrameEvent | NodeStatusEvent` (`dashboard/src/types/events.ts`). The host adds `timestamp`, `origin` and `verified` (true only when the frame decodes against a VERIFIED registry entry, so false for everything today). The spec's example event shape maps directly onto `CanFrameEvent`:

```json
{ "timestamp": "2026-10-13T00:00:00.000Z", "sourceNode": "node3", "canId": "0x000",
  "identifierFormat": "standard", "dlc": 8, "data": [0,0,0,0,0,0,0,0],
  "busState": "unknown", "verified": false }
```

(Schema example only. `0x000` and that payload are not CAN definitions.)

To add live data, implement `CanDataSource`, for example as a WebSocket client fed by a serial bridge that uses `parseSerialLine()`, and select it in `dashboard/src/App.tsx`. The UI needs no other changes.

## Protocol v1 and physical mode (2026-10-17)

This section supersedes the read-only design above and below where they conflict.

- **Protocol**: `protocol/canscope_protocol.json` generates the C++ and TS constants. The description is in `docs/protocol/canscope-protocol-v1.md`.
- **Firmware layers**:
  - Portable, host-tested: `canscope_protocol` (codec), `serial_link` (commands), `ecu_core` (Node 1/2), `monitor_core` (Node 3 detection), `monitor_ui` (Node 3 peripherals).
  - ESP32 glue: `ecu_runtime` (Node 1/2) and `firmware/monitor/src/main.cpp` (Node 3: TWAI, Adafruit SSD1306, GPIO).
- **Transport**: there is no separate bridge process.
  - Chrome and Edge let a page served from `http://localhost` open USB serial ports directly (Web Serial).
  - `dashboard/src/lib/serial/` holds four modules: `serial-link.ts` (one port), `line-splitter.ts`, `command-tracker.ts` and `physical-source.ts` (all ports: identification, routing, dedupe, reconnect).
  - This avoids native Node modules and an extra service. The cost is that Firefox and Safari are unsupported; the page reports this instead of falling back to mock data.
- **Commands**: `CommandChannel.sendCommand(node, text)` (`data-source.ts`) is a separate interface from the receive-only `CanDataSource`. Commands are allow-listed verbs, validated in the page and again on the device. Each one is tracked to `ok`, `rejected`, `unsupported`, `timeout`, `connection_lost` or `not_sent`.
- **Observed vs commanded**: the dashboard state keeps Node 3's reports (`telemetry`, `node_health`, `fault`, `faults`) apart from ECU self-reports (`ecu_state`). A self-report is never shown as an observation.

## Out of scope

Deliberately **not** implemented:

- Transmitting CAN frames from the dashboard, arbitrary or otherwise.
- Commands, hidden background requests, or control of vehicles, actuators, relays or any physical output.
- Showing physical units for UNVERIFIED registry entries.
- Automatic bus-off recovery.
- CAN FD (the ESP32 TWAI controller is classical CAN only).

**Extension point:** a future command feature would be a **separate** interface (for example `CanCommandChannel`), not a method on `CanDataSource`. It would need its own written specification, an explicit authorization model, an allow-list of IDs and payloads, an audit log, and a recorded approval in `TASK.md`.
