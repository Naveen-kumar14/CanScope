# Flashing CANScope from Windows (PlatformIO Core next to Arduino IDE)

CANScope is built with **PlatformIO Core**, not Arduino IDE. Arduino IDE can stay installed; nothing here changes it.

## Why not Arduino IDE

Checked on this PC on 2026-10-17:

| | PlatformIO build (authoritative) | Installed Arduino IDE |
|---|---|---|
| IDE | — | Arduino IDE 1.8.57 (Microsoft Store; IDE 1.8.19 core), no `arduino-cli` |
| ESP32 core | arduino-esp32 **2.0.17** (`framework-arduinoespressif32 3.20017`), ESP-IDF **v4.4.7**, GCC 8.4.0 | esp32 core **3.3.12**, ESP-IDF 5.5 |
| C++ standard | `-std=gnu++11 -Os`; project sources also get `-Wall -Wextra` | `-std=gnu++2b` |
| TWAI driver | ESP-IDF 4.4 `driver/twai.h` | a different, legacy-compatibility `driver/twai.h` in IDF 5.5 |
| Shared code | 9 libraries in `firmware/common/`, generated `protocol_spec.h`, `-D` options in `platformio.ini` | IDE 1.8 compiles one sketch folder plus sketchbook libraries and cannot add include paths or `-D` options per sketch, so `firmware/common` would have to be copied |
| Libraries | Adafruit SSD1306 2.5.13, GFX 1.12.1, BusIO 1.17.1 (pinned) | whatever versions the Library Manager installs |
| Serial Monitor | any speed | offers 250000 and 500000 but **not 460800** (CANScope's serial speed) |

Building in Arduino IDE would need a downgrade of the core used by your other sketches to 2.0.17, copies of the shared sources, and a hand-set board menu. It still could not show the serial output. PlatformIO Core reproduces the exact configuration and runs alongside the IDE.

## 1. One-time setup

Prerequisites:

- **Python 3**. Already present on this PC; otherwise install it from python.org and tick "Add python.exe to PATH".
- **USB-UART driver**. DevKit V1 boards use a Silicon Labs CP210x or WCH CH340 chip. If no COM port appears when a board is plugged in, install the matching driver.

In a Command Prompt or PowerShell, in the repository folder:

```bat
cd "E:\2nd year\Embedded systems Package"
tools\setup-pio.cmd
```

This installs PlatformIO Core 6.2.0 into `C:\canscope-pio\penv`, with packages under `C:\canscope-pio`. It changes nothing on PATH. On this PC it is already installed, so the script only prints the version. From now on, use `tools\pio.cmd` wherever the docs say `pio`.

## 2. Build

```bat
tools\pio.cmd run -d firmware\node1   -e node1
tools\pio.cmd run -d firmware\node2   -e node2
tools\pio.cmd run -d firmware\monitor -e monitor
```

Each must end with `[SUCCESS]`. Board settings come from `platformio.ini` (`board = esp32dev`, `platform = espressif32@6.12.0`):

- ESP32 Dev Module at 240 MHz
- 4 MB flash in DIO mode at 40 MHz
- default partitions
- 460800 baud upload

## 3. Find each board's COM port

Plug in **one** board, then run:

```bat
tools\pio.cmd device list
```

You can also look in Device Manager → *Ports (COM & LPT)*: *Silicon Labs CP210x … (COMn)* or *USB-SERIAL CH340 (COMn)*. Write the number on the board. Close the Arduino IDE Serial Monitor and any other program using the port.

## 4. Flash (one board at a time, bare board, as the manual says)

```bat
tools\pio.cmd run -d firmware\node1   -e node1   -t upload --upload-port COM5
tools\pio.cmd run -d firmware\node2   -e node2   -t upload --upload-port COM6
tools\pio.cmd run -d firmware\monitor -e monitor -t upload --upload-port COM7
```

Replace `COM5`/`COM6`/`COM7` with the numbers you found. If the upload stalls at `Connecting....____` or reports *Wrong boot mode*, hold the board's **BOOT** button until `Writing at 0x…` appears.

Never flash `firmware\node3` on Node 3; it is the old scaffold that refuses to start CAN. Only flash `monitor_buzzer` after bench gate G10 has passed.

## 5. Serial monitor (460800 baud)

```bat
tools\pio.cmd device monitor -d firmware\node1 --port COM5
```

The speed is taken from `platformio.ini`. Press Ctrl+C to quit.

Expected output:

- unreadable characters right after reset (the ESP32 ROM prints at 115200)
- a `# ====` banner
- `# CAN init: OK - controller running`
- a `{"type":"hello",…}` line, then status lines every second

Type `@t1 help` and press Enter; an `{"type":"ack",…,"id":"t1","status":"ok",…}` line must come back.

Do **not** use the Arduino IDE Serial Monitor: it has no 460800 setting. The dashboard (`docs/physical-integration.md` section 6) also reads the boards directly. Close this monitor before opening the dashboard, because a port can only be opened once.

Continue with `docs/physical-integration.md` section 5 onward.
