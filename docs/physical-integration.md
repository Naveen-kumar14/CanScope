# Physical integration: build, flash, connect, test

This is the software procedure for the real three-board CANScope. Wiring is in the build manual and `docs/wiring/pin_ledger.json`. Follow its power-off rule for every wiring change, and its bench gates (G1–G14) before relying on any wire.

> **Status (2026-10-17): nothing in this guide has been run on hardware.** Firmware was compiled and the logic was unit-tested on a PC; no board has been flashed, and no CAN frame or peripheral has been observed. Record every result in `TASK.md`.

| Board | Role | Firmware target | Serial name |
|---|---|---|---|
| ESP32 #1 | Node 1, Motor ECU | `firmware/node1` env `node1` | `node1` |
| ESP32 #2 | Node 2, Battery ECU | `firmware/node2` env `node2` | `node2` |
| ESP32 #3 | Node 3, CANScope Monitor (OLED, LEDs) | `firmware/monitor` env `monitor` | `monitor` |

`firmware/node3` is the earlier scaffold, which refuses to start CAN. **Do not flash it on Node 3.**

## 1. Tools (once)

```sh
python -m pip install platformio          # or use the PlatformIO IDE extension
# Windows: keep the package path short, or the ESP32 toolchain fails to unpack
set PLATFORMIO_CORE_DIR=C:\canscope-pio   # (PowerShell: $env:PLATFORMIO_CORE_DIR="C:\canscope-pio")
```

The dashboard needs Node.js 20+ and **Chrome or Edge** (desktop), because they provide Web Serial. Firefox and Safari do not.

## 2. Build

```sh
pio run -d firmware/node1 -e node1
pio run -d firmware/node2 -e node2
pio run -d firmware/monitor -e monitor
sh tools/build-firmware.sh                # all targets, incl. legacy sketches
```

A successful build proves only that the code compiles.

## 3. Identify each board's serial port

Connect **one board at a time** by USB.

- **Windows**: Device Manager → *Ports (COM & LPT)*. A DevKit V1 shows as *Silicon Labs CP210x USB to UART Bridge (COMn)* or *USB-SERIAL CH340 (COMn)*. No port appearing means a charge-only cable or a missing CP210x/CH340 driver.
- **Any OS**: `pio device list`, then unplug and run it again to see which entry disappears.

Write the COM number on a label on each board. Numbers can change if you use a different USB socket.

## 4. Flash (each bare board, before wiring, as the manual says)

```sh
pio run -d firmware/node1   -e node1   -t upload --upload-port COM5
pio run -d firmware/node2   -e node2   -t upload --upload-port COM6
pio run -d firmware/monitor -e monitor -t upload --upload-port COM7
```

If the upload stops at `Connecting....___` and then reports *Wrong boot mode* or *Failed to connect*: hold the board's **BOOT** button until writing starts. Close every serial monitor first, because one port cannot be opened twice.

## 5. Check each board alone (USB only)

```sh
pio device monitor -d firmware/node1 --port COM5     # 460800 baud comes from platformio.ini
```

You should see:

- a `# ====` banner with the node name, `CAN TX: GPIO17 RX: GPIO16 [WORKING_ASSUMPTION]`, `bit rate: 500000`
- `# CAN init: OK - controller running`
- `# CAN transceiver echo check: ok - ...`. At start-up, before CAN starts, the board pulses its TX pin and checks that the transceiver echoes it on RX. This runs on one bare board with nothing else on the bus. Any other result names the likely wiring cause (see section 9). It does **not** test CANH/CANL or termination.
- a `{"type":"hello",...}` line, then `status` and `ecu_state` (or, on the monitor, `node_health` and `faults`) lines every second

The first lines after reset are unreadable: that is the ESP32 ROM at 115200 baud, and it is normal.

Then type `@t1 help` and press Enter. One `{"type":"ack",...,"id":"t1","status":"ok",...}` line must come back.

Without a transceiver, or with no other node on the bus, an ECU's frames are never ACKed. Its `txFailed` count rises and `status` goes to `error_passive`. That is expected at this stage.

On the monitor, also check:

- the `# OLED:` line (`SSD1306 initialised at 0x3C` or `0x3D`)
- `{"type":"selftest",...}`: `can` and `oled` results
- the LEDs: a green → yellow → red lamp test right after reset

**Close the monitor (Ctrl+C) before using the dashboard.**

## 6. Connect the dashboard

```sh
cd dashboard
npm install
npm run dev            # open http://localhost:5173 in Chrome or Edge
```

1. *Data source* must say **Physical (USB serial)**. Physical mode never shows mock data. If Web Serial is missing, the page shows an error instead.
2. Open the **Connections** tab, press **Add serial port…**, pick one board's port, and repeat for each board. Each card becomes *Node 1 – Motor ECU*, *Node 2 – Battery ECU* or *Node 3 – CANScope Monitor* from what the board itself reports, not from the order you added them.
3. Every dashboard start begins fresh: no port is listed or opened automatically, so pick the three boards again with **Add serial port…**. The browser keeps its permission for previously granted ports (only **Forget port** revokes it). Within a session, **Reconnect closed ports** reopens ports you disconnected, and a port that is unplugged while connected is reopened automatically when it comes back.

| Card shows | Meaning |
|---|---|
| `port busy or unavailable` | another program has the port open (PlatformIO/Arduino serial monitor, PuTTY) |
| `Last line … no data` | wrong port, a board without CANScope firmware, or a held reset |
| `Conflict` | two ports claim the same node (two boards flashed with the same target). Commands are blocked |
| invalid lines rising steadily | wrong baud rate (must be 460800) or a bad cable. A few at reset are normal |

## 7. Bring-up order on the CAN bus

The trunk, both 120 Ω terminators (RT1 at TRX1, RT2 at TRX3) and the 60 Ω check come from the manual. Change wiring only with every board unplugged.

**A. Node 3 + Node 1.** Plug in Node 3 and Node 1 (Node 2 not plugged in). On the dashboard:
- Node 3 card: CAN `error_active`; frames `0x120` every 100 ms and `0x701` every 500 ms, verdict *accepted*
- *Observed on CAN by Node 3* for Node 1: `1500 rpm`, `65.0 °C`, state current
- Node 1 self-report: `txFailed` stays 0
- Node 2 shows `HEARTBEAT_LOST` / `TELEMETRY_STALE` ("no heartbeat since monitoring started"). That is correct: it is not there
- OLED summary: `N1 HB:ok TEL:ok`
- LED: red, because Node 2 is missing (critical)

**B. Node 3 + Node 2.** Unplug Node 1 and plug in Node 2, then check the same things for `0x220` / `0x702`, `48.00 V 12.0 A 85 %`.

**C. All three.** The **Overview** tab's *CAN link check* says **CAN bus operational**. After about 2 s, *Faults detected by Node 3* shows **No active faults**, the green LED is on, and the OLED shows `CANScope MON OK`.

If a step fails, see section 9 before going further.

## 8. Fault detection and recovery tests

Use the **Fault testing** tab; each ECU card has *Inject* / *Clear fault* and *Set* fields. Every command must show **acknowledged** in the command log. An ack only proves the ECU accepted it.

The pass criterion is the *Faults detected by Node 3* column, which comes from CAN. The *Requested faults vs. detection* card shows what was requested and ticks each expected detection only once Node 3 reports it.

When the ECU acknowledges *Inject*, the dashboard also sends `display fault <ecu> <fault>` to Node 3 over Node 3's own USB port. The OLED summary page is then replaced by the commanded-fault view, for example `Node 1:` / `HEARTBEAT LOST`, with both ECUs listed when both have a fault. *Clear fault* sends `display clear <ecu>` for that ECU only. The summary returns when no commanded fault is left. This works with the CAN bus disconnected, because it uses USB only. It is display only: it is not a detection, and it never appears in *Faults detected by Node 3*. In the command log, the `display` row shows *OLED updated* only after Node 3 acknowledges it. *unsupported* means Node 3 runs firmware without the command (reflash `firmware/monitor`). *not sent* means Node 3 was not connected; the current state is sent again once it reconnects.

| Test (Node 1, then repeat on Node 2) | Expected Node 3 detection | Recovery after *Clear fault* |
|---|---|---|
| `heartbeat_stop` | HEARTBEAT_LOST after ~1.5 s; telemetry stays current | cleared at next heartbeat |
| `telemetry_stop` | TELEMETRY_STALE after ~0.5 s | cleared at next frame |
| `silent` | both of the above; `0x120`/`0x701` vanish from the frame table | both clear |
| `invalid_value` | VALUE_INVALID + TELEMETRY_STALE; verdict *value out of range* | ≤ ~2.5 s |
| `bad_dlc` | INVALID_DLC + TELEMETRY_STALE; DLC 4 rows | ≤ ~2.5 s |
| `bad_checksum` | CHECKSUM_ERROR + TELEMETRY_STALE | ≤ ~2.5 s |
| `counter_freeze` | COUNTER_FROZEN; values still update | after 3 frames |
| `bad_version` | PROTOCOL_VERSION_MISMATCH + TELEMETRY_STALE (no HEARTBEAT_LOST) | at next heartbeat |
| `set temp 96` → `112` → `65` | MOTOR_TEMP_HIGH (warning, yellow) → + MOTOR_OVERTEMP (critical, red) → both clear | 3 frames below 105.0 / 90.0 |
| `set rpm 6500` | MOTOR_OVERSPEED | `set rpm 1500` |
| Node 2: `set voltage 41.5`, `set voltage 55`, `set current -100`, `set soc 10` | UNDERVOLTAGE, OVERVOLTAGE, OVERCURRENT, SOC_LOW (yellow) | back to defaults: `48`, `12`, `85` |
| Rejections: `set rpm 9000` (refused in the page, nothing sent); type `@x set rpm 9000` in a serial monitor | ack `rejected` "rpm out of range" | setpoint unchanged |
| Unplug Node 1's USB (power loss) | HEARTBEAT_LOST + TELEMETRY_STALE; Node 1 port card *lost*; its pending commands *connection lost* | replug: port reopens by itself and faults clear |
| Unplug Node 3's USB | dashboard shows Node 3 not connected; detection status unknown, not "no faults" | replug: reopens; new `bootId`, old faults discarded |

Peripherals on Node 3:

| Check | Expected |
|---|---|
| OLED pages | rotate by themselves every 5 s: Summary → Faults → Bus. While a commanded fault is set, the commanded-fault view stays on screen |
| `recover` (serial / dashboard *Recover from bus-off*), bus healthy | ack `rejected`: `controller is not bus-off` (correctly refused) |
| LEDs | yellow = worst fault is a warning; red = a critical fault; red fast blink = monitor CAN not running / bus-off. Green (all healthy) has no verified pin on this build: ledger N3-14 BLOCKED |
| Buttons, buzzer | none on this build. GPIO25, GPIO32 and GPIO33 are not configured by the firmware |

Bus-off is not forced by software. If a controller does go bus-off (a wiring fault, a wrong bit rate on one node), its `status.busState` shows `bus_off`. Fix the cause with power off, power up, then use *Recover from bus-off* (or Node 3 button B long press).

## 9. Diagnosing common failures

| Symptom | Likely cause / check |
|---|---|
| `# CAN init: FAILED (config_invalid…)` | a `-D` pin override is invalid; read the banner's ERROR lines |
| Overview *CAN link check*: **Frames are not acknowledged on the CAN bus** (all USB ports open, ECU `txFailed` rising, Node 3 RX 0) | USB works; the CAN wiring does not. If Node 1 and Node 2 both fail, they cannot hear each other either, so the fault is common to all transceivers. First read each board's *Transceiver echo* on the **Diagnostics** tab: a failure there pinpoints that board's TX/RX/Rs/power wiring. If all three pass, the fault is on CANH/CANL: continuity CANH↔CANH and CANL↔CANL between all modules, no CANH–CANL short (the 60 Ω reading does not prove this) |
| `transceiverCheck` `no_echo` | Rs pin high/floating (standby: tie Rs to GND), transceiver D input not on GPIO17, or TX/RX swapped |
| `transceiverCheck` `rx_not_driven` | transceiver R output not on GPIO16, transceiver without 3.3 V/GND, or TX/RX swapped |
| `transceiverCheck` `rx_stuck_dominant` | CANH–CANL short, a node holding the bus dominant, or a faulty transceiver |
| Monitor `node_health` stays `waiting`/`lost` with ECU `txFailed` rising | no ACK: CTX/CRX swapped, transceiver not powered at 3.3 V, Rs pin floating (high = standby), CANH/CANL swapped or open; re-run the 60 Ω check with power off |
| `BUS_SILENT` while ECUs report `txOk` rising | monitor transceiver / CRX wiring (GPIO16) or Node 3 bus stub open |
| Frames arrive but `CHECKSUM_ERROR` / `INVALID_DLC` without any demo fault | a node runs other firmware (e.g. the legacy sketch: IDs `0x201…0x210` show as *unsupported id*) |
| `error_passive` / bus errors on every node | missing/extra terminator, bit-rate mismatch, long or untwisted wires |
| `MONITOR_RX_OVERRUN` | the USB link cannot keep up: use `frames off` (raw frame lines off; telemetry and faults continue) |
| OLED `not_found` | VCC/GND/SDA(21)/SCL(22), module address; the monitor retries every 10 s |
| Dashboard: `Web Serial is not available` | use Chrome/Edge and `http://localhost` (not a `file://` page or a LAN IP over http) |

## 10. Hardware tests still required (none done)

1. Flash each board (sections 3–4) and capture its boot log into `captures/`.
2. Bench gates G1–G14 from the ledger, in particular G4/G5 (transceiver pins, Rs), G6 (onboard terminators, 60 Ω), G7 (OLED address), G9 (LED polarity).
3. Section 5 serial checks on each bare board, including one command ack.
4. Section 7 bring-up A, B and C: the first real capture of protocol v1 frames. Save a log. After this, the registry status of `0x120/0x220/0x701/0x702` can move from "specified" to "captured".
5. Every row of the section 8 tables, on both ECUs.
6. Dashboard reconnect behaviour with a real unplug and replug, and port contention with a real second program.
7. A soak run (≥ 30 min, all three nodes, raw frames on): the dashboard shows no rising invalid-line count, no `MONITOR_RX_OVERRUN`, and no sequence gaps.
