# CAN ID and payload registry

The CANScope protocol v1 IDs are defined in **one machine-readable source**, [`protocol/canscope_protocol.json`](../../protocol/canscope_protocol.json), described in [canscope-protocol-v1.md](canscope-protocol-v1.md). Firmware and dashboard code is generated from it (`tools/protocol/gen_protocol.py`), so the two cannot drift. This page summarises the IDs and keeps the legacy test-sketch entries.

The legacy registry copies are `firmware/common/protocol_decoder/protocol_registry.cpp` and the legacy part of `dashboard/src/lib/protocol-registry.ts`.

Rules:
- No ID goes in as **verified** without named evidence (a specification, a known-good capture, or a controlled bench test).
- Unknown frames are always kept and shown as raw data.
- Physical values (scaling and units) are shown only for verified entries.

## Bus-level parameters

| Parameter | Value | Status | Evidence |
|---|---|---|---|
| CAN version | Classical CAN | Working assumption | ESP32 TWAI limitation. Bus requirement unknown |
| Identifier type | standard 11-bit | Specified (v1) | protocol v1 spec; legacy sketch also standard |
| Nominal bit rate | 500 kbit/s | Specified (v1), not bench-verified | protocol v1 spec, legacy sketches |
| Sample point / timing | ESP-IDF `TWAI_TIMING_CONFIG_500KBITS` preset | Working assumption | Driver default |
| Byte order | big-endian | Specified (v1) | protocol v1 spec (legacy sketch also big-endian) |
| Heartbeat / timeout | 0x701/0x702 every 500 ms, lost after 1500 ms | Specified (v1) | protocol v1 spec |
| Error handling | Bus-off reported, recovery only on operator request (`recover`, Node 3 button B long press) | Design decision | `docs/protocol/canscope-protocol-v1.md` |

## Production registry: CANScope protocol v1

Evidence: the project's own specification, `protocol/canscope_protocol.json` (2026-10-17). These IDs are "verified" only in the sense of having a named specification, which is what lets the dashboard show physical units. **None has been captured on the physical bus yet.**

| CAN ID | Format | Sender | Receiver(s) | Period / trigger | DLC | Payload fields | Byte order | Scaling / units | Counter / checksum | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0x120 | standard | node1 | monitor | 100 ms | 8 | b0–1 `rpm` u16; b2–3 `motorTempC` i16 | BE | 1 rpm; 0.1 °C | b6 counter, b7 checksum | protocol v1 spec | SPECIFIED, not captured |
| 0x220 | standard | node2 | monitor | 100 ms | 8 | b0–1 `packVoltageV` u16; b2–3 `packCurrentA` i16; b4 `socPct` u8 | BE | 0.01 V; 0.1 A; 1 % | b6 counter, b7 checksum | protocol v1 spec | SPECIFIED, not captured |
| 0x701 | standard | node1 | monitor | 500 ms | 8 | b0 version, b1 node id, b2–4 fw, b5 CAN state | n/a | — | b6 counter, b7 checksum | protocol v1 spec | SPECIFIED, not captured |
| 0x702 | standard | node2 | monitor | 500 ms | 8 | as 0x701 | n/a | — | b6 counter, b7 checksum | protocol v1 spec | SPECIFIED, not captured |

## Legacy test-sketch traffic (UNVERIFIED)

These are transmitted by the existing `sketch_node2_test.ino` ("Battery ECU Node 2" test sketch). The values are hard-coded constants. Units and scaling are not stated anywhere, and the traffic has never been captured. They are listed so the monitor can label them "unverified" rather than "unknown". They are **not** production definitions.

| CAN ID | Format | Sender | Receiver(s) | Period / trigger | DLC | Payload fields | Byte order | Scaling / units | Counter / checksum | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0x201 | standard | node2 (test sketch) | unspecified | 1000 ms | 2 | bytes 0–1: `voltage_raw` uint16 (sketch sends 480) | big-endian | unknown | none observed | sketch source only | UNVERIFIED |
| 0x202 | standard | node2 (test sketch) | unspecified | 1000 ms | 2 | bytes 0–1: `current_raw` int16 (sketch sends 120) | big-endian | unknown | none observed | sketch source only | UNVERIFIED |
| 0x203 | standard | node2 (test sketch) | unspecified | 1000 ms | 1 | byte 0: `soc_raw` uint8 (sketch sends 85) | n/a | unknown | none observed | sketch source only | UNVERIFIED |
| 0x210 | standard | node2 (test sketch) | unspecified | 500 ms | 1 | byte 0: `heartbeat_raw` uint8 (sketch sends 1) | n/a | unknown | none observed | sketch source only | UNVERIFIED |

## Example and mock IDs (never project values)

- Host and dashboard decoder tests use `0x7E0` and `0x7E1` with fields named `example_*` / `ex_*`.
- The mock dashboard and frame tests use `0x7A0` and `0x18FEF100` as "unknown" traffic.

None of these represent anything on the real bus.

## Entry template

| CAN ID | Format | Sender | Receiver(s) | Period / trigger | DLC | Payload fields | Byte order | Scaling / units | Counter / checksum | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `0x___` | standard / extended | node _ | node _ | __ ms / event | _ | byte _: name, type | BE / LE | factor, offset, unit | algorithm, position | spec / capture file / bench test (date) | UNVERIFIED / VERIFIED |
