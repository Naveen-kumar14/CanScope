# CAN ID and payload registry

This is the authoritative registry. Code copies that must match it:
- `firmware/common/protocol_decoder/protocol_registry.cpp`
- `dashboard/src/lib/protocol-registry.ts`

Rules:
- No ID goes in as **verified** without named evidence (a specification, a known-good capture, or a controlled bench test).
- Unknown frames are always kept and shown as raw data.
- Physical values (scaling and units) are shown only for verified entries.

## Bus-level parameters

| Parameter | Value | Status | Evidence |
|---|---|---|---|
| CAN version | Classical CAN | Working assumption | ESP32 TWAI limitation. Bus requirement unknown |
| Identifier type | standard 11-bit (legacy sketch) | Unverified | `sketch_node2_test.ino` |
| Nominal bit rate | 500 kbit/s | Working assumption | Legacy sketches only |
| Sample point / timing | ESP-IDF `TWAI_TIMING_CONFIG_500KBITS` preset | Working assumption | Driver default |
| Byte order | big-endian in legacy test sketch | Unverified | Test sketch only |
| Heartbeat / timeout | 0x210 every 500 ms (test sketch) | Unverified | Test sketch only |
| Error handling | Bus-off reported, no auto-recovery | Design decision | `docs/architecture.md` |

## Production registry

None. No production CAN ID has evidence yet.

| CAN ID | Format | Sender | Receiver(s) | Period / trigger | DLC | Payload fields | Byte order | Scaling / units | Counter / checksum | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| — | | | | | | | | | | | |

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
