# Node 3 pin map

Source of truth for Node 3 wiring. Firmware counterpart: `firmware/node3/include/node3_hw_config.h`.

**Every row is UNVERIFIED.** No Node 3 schematic, component list, photo or measurement is available yet. Do not power Node 3 peripherals based on this table until the rows have evidence.

| ESP32 pin / signal | Connected device / pin | Signal purpose | Voltage | Direction (ESP32 view) | Evidence | Verification state |
|---|---|---|---|---|---|---|
| 3V3 | Transceiver VCC, approved 3.3 V peripherals | Logic power | 3.3 V | out (supply) | none | UNVERIFIED |
| GND | Transceiver GND, peripheral grounds | Reference | 0 V | — | none | UNVERIFIED |
| CAN TX GPIO (`NODE3_CAN_TX_GPIO`) | Transceiver TXD/D | CAN controller TX | 3.3 V logic | output | none. Candidates: GPIO22 (brief) or GPIO17 (legacy sketches) | UNVERIFIED |
| CAN RX GPIO (`NODE3_CAN_RX_GPIO`) | Transceiver RXD/R | CAN controller RX | 3.3 V logic | input | none. Candidates: GPIO21 (brief) or GPIO16 (legacy sketches) | UNVERIFIED |
| Transceiver STB/RS/EN | fixed level or GPIO | Mode control | datasheet-specific | output or tied | none | UNVERIFIED |
| Transceiver CANH | Bus CANH | Differential bus | CAN physical layer | — | none | UNVERIFIED |
| Transceiver CANL | Bus CANL | Differential bus | CAN physical layer | — | none | UNVERIFIED |
| Sensor power | TBD | Sensor supply | TBD | — | none | UNVERIFIED |
| Sensor ground | TBD | Sensor return | 0 V | — | none | UNVERIFIED |
| Sensor signal(s) | TBD | Application input | TBD | input | none | UNVERIFIED |
| Output / actuator signal(s) | TBD | Application output | TBD | output | none | UNVERIFIED. No output code exists |

Pin-selection cautions (classic ESP32, a WORKING_ASSUMPTION):

- GPIO6–11 are flash pins; never use them. The firmware rejects them.
- GPIO34–39 are input-only, so they can't be CAN TX. The firmware rejects them for TX.
- GPIO0/2/5/12/15 are strapping pins. The firmware warns.
- GPIO16/17 are PSRAM pins on WROVER modules. The firmware warns.
- Never connect CANH/CANL directly to ESP32 pins.

## Running Node 3 under a bench assumption

With the defaults, Node 3 prints its banner and does not start CAN. For a recorded bench test, pass the assumed values as build flags. Don't edit guesses into the header.

```sh
# PowerShell
$env:PLATFORMIO_BUILD_FLAGS="-DNODE3_CAN_TX_GPIO=22 -DNODE3_CAN_RX_GPIO=21 -DNODE3_CAN_BITRATE=500000"
pio run -d firmware/node3 -e node3 -t upload
```

The banner will still say `[UNVERIFIED]`. Log the assumption, the wiring and the result in `TASK.md`. Once you have evidence, set the values in `node3_hw_config.h`, change `pins_status`/`bitrate_status` to `Verified`, and fill in the Evidence column above.

## Change log

- 2026-10-13: table created from the project brief. All rows UNVERIFIED.
