# CANScope dashboard

Vite + React 19 + TypeScript. It talks to the real CANScope boards over USB serial with the browser's **Web Serial** API.

```sh
npm install
npm run dev          # open http://localhost:5173 in Chrome or Edge (desktop)
npm run typecheck
npm run lint
npm test             # Vitest + Testing Library
npm run build        # outputs to dist/
npm run check        # all of the above
```

## Physical mode (default)

1. Close any other serial monitor using the boards.
2. On the **Connections** tab, press **Add serial port…** and pick the port of one board. Repeat for Node 1, Node 2 and Node 3. Ports are identified by each board's `hello` / `status` lines, never by order. The browser remembers granted ports, so later **Connect known ports** reopens them. A port that is unplugged while connected is reopened when it comes back.
3. Speed: 460800 baud (`protocol/canscope_protocol.json`, `serial.baud`).

The page has five tabs:

- **Overview**: the system status strip (boards on USB, CAN traffic at Node 3, faults detected, worst controller state), the **CAN link check** (plain-language findings and next steps derived from the boards' own counters: an open USB port is never presented as working CAN), ECU telemetry and Node 3's faults.
- **Live CAN data**: frame table, filters, frame detail and traffic counters.
- **Fault testing**: requested faults vs. Node 3 detection, controls and the command log.
- **Connections**: one card per USB port, Forget for unidentified ports (it reports whether browser permission was really revoked).
- **Diagnostics**: per-board CAN controller table (TEC/REC, RX/TX, TX failed, bus errors, transceiver echo check) and the Node 3 self-test.

The selected tab is kept in the URL hash (`#faults`, ...). Tabs follow the WAI-ARIA pattern (arrow keys, Home, End).

What you see:

- **Observed on CAN by Node 3**: values, heartbeat/telemetry state and faults that the monitor derived from frames it actually received. Without Node 3 connected, these are shown as *unavailable* and fault status as *unknown*. They are never filled in from anything else.
- **Reported by the ECU over its own USB (commanded)**: setpoints, demo fault and TX counters from `ecu_state`.
- **Commanded demo faults**: each expected detection is ticked only when Node 3 reports it.
- **Controls**: set values, generation profile, demo faults, bus-off recovery (ECUs), plus silence alarm, raw frames on/off and recovery (monitor).
  - Values are checked in the page with the firmware's own rules; a rejected value is shown as *Not sent*.
  - Every command is tracked in the **Command log** as *waiting for ack*, then *acknowledged*, *rejected*, *unsupported*, *timeout* (1.5 s), *connection lost* or *not sent*.
  - Controls for a node that is not connected are disabled with the reason shown.
- **Live CAN traffic**: raw frames captured by Node 3 with the registry decode and Node 3's own verdict.

Browsers without Web Serial (Firefox, Safari), or a page not served from `localhost`/https, show an error. **Physical mode never falls back to mock data.**

## Mock preview

`?source=mock`, or *Data source → Mock preview*, uses the old browser-generated legacy test frames for UI work without hardware. It is labelled **MOCK DATA** with a striped banner, and it has no command controls. Scenarios: `normal`, `empty`, `stale`, `disconnected`, `error`, `bus_off` (`?scenario=`).

## Structure

- `src/lib/protocol-spec.generated.ts`: **generated** from `../protocol/canscope_protocol.json` (do not edit). `src/lib/protocol.ts`: decoder, checksum, value validation
- `src/lib/serial/`: `serial-link.ts` (one Web Serial port), `line-splitter.ts`, `command-tracker.ts`, `physical-source.ts` (all ports, identification, routing, dedupe, reconnect)
- `src/lib/serial-line-parser.ts`: strict parser for every device line type
- `src/lib/dashboard-state.ts`: reducer; observed vs self-reported state, fault ordering and snapshots
- `src/lib/data-source.ts`: receive-only `CanDataSource` plus a separate `CommandChannel`
- `src/lib/bus-diagnosis.ts`: pure CAN link diagnosis (findings + next steps) from status lines
- `src/components/`: `TabNav`, `SystemStatus`, `BusDiagnosis`, `StatusIcon`, `ConnectionPanel`, `TelemetryPanel`, `FaultPanel` (`DetectedFaults`, `CommandedFaults`), `ControlPanel` (+ command log), `NodeHealthCards` (controller table), `SelftestCard`, plus the bus/frame views
- `tests/`: unit and rendering tests. `fake-serial.ts` is an in-memory stand-in for the browser's serial API only; there is no virtual CAN bus or ECU

## Safety scope

There is no way to transmit an arbitrary CAN frame from the dashboard. Commands are allow-listed text lines sent to one board over its USB port; the board validates them again and acknowledges them.
