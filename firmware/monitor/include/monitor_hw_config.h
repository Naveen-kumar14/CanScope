// =============================================================================
// Node 3 (CANScope Monitor) hardware configuration - the only place Node 3
// hardware values live. This is the firmware for the Node 3 board.
// (firmware/node3 is the earlier scaffold that refuses to start CAN.)
//
// Every GPIO below comes from the canonical wiring ledger
// (docs/wiring/pin_ledger.json). All ledger rows are PROVISIONAL until their
// bench gates pass, so every value is overridable with -D and reported in the
// banner with its status. tools/hwdocs/ledger.py checks the CAN #define lines.
//
//   CAN TX/RX     GPIO17 / GPIO16   N3-06 / N3-07   gates G1-G6
//   OLED SDA/SCL  GPIO21 / GPIO22   N3-12 / N3-13   gate G7 (SSD1306, I2C)
//   LED G/Y/R     GPIO25/26/27      N3-14..N3-22    gate G9 (each via 220 Ohm)
//   Button A/B    GPIO32 / GPIO33   N3-23..N3-26    gate G8 (to GND, internal pull-up)
//   Buzzer drive  GPIO13            N3-27           gate G10 BLOCKED (Q1 pinout)
//
// The buzzer is a 5 V part powered from VIN and switched by the low-side NPN
// Q1; GPIO13 only drives Q1's base through 1 kOhm. Never wire the buzzer to a
// GPIO. Because Q1's part number and E/B/C order are still unknown (gate G10),
// buzzer output is DISABLED by default: GPIO13 stays a high-impedance input
// and the 10 kOhm pull-down keeps Q1 off. Build env "monitor_buzzer" enables it
// once G10 has passed.
// =============================================================================
#pragma once

#include "can_config.h"

#ifndef MONITOR_CAN_TX_GPIO
#define MONITOR_CAN_TX_GPIO 17  // WORKING_ASSUMPTION (ledger N3-06, PROVISIONAL)
#endif
#ifndef MONITOR_CAN_RX_GPIO
#define MONITOR_CAN_RX_GPIO 16  // WORKING_ASSUMPTION (ledger N3-07, PROVISIONAL)
#endif
#ifndef MONITOR_CAN_BITRATE
#define MONITOR_CAN_BITRATE 500000  // protocol v1 bus rate
#endif
// 0 = normal mode: ACKs frames but never transmits application frames
//     (needed when only one ECU is on the bus during bring-up).
// 1 = listen-only: fully passive, sends no ACK and no error frames.
#ifndef MONITOR_LISTEN_ONLY
#define MONITOR_LISTEN_ONLY 0
#endif

#ifndef MONITOR_I2C_SDA_GPIO
#define MONITOR_I2C_SDA_GPIO 21  // ledger N3-12, PROVISIONAL
#endif
#ifndef MONITOR_I2C_SCL_GPIO
#define MONITOR_I2C_SCL_GPIO 22  // ledger N3-13, PROVISIONAL
#endif
// 0 = probe 0x3C then 0x3D (module address jumper not verified, gate G7).
#ifndef MONITOR_OLED_I2C_ADDR
#define MONITOR_OLED_I2C_ADDR 0
#endif
#ifndef MONITOR_LED_GREEN_GPIO
#define MONITOR_LED_GREEN_GPIO 25  // ledger N3-14, PROVISIONAL
#endif
#ifndef MONITOR_LED_YELLOW_GPIO
#define MONITOR_LED_YELLOW_GPIO 26  // ledger N3-17, PROVISIONAL
#endif
#ifndef MONITOR_LED_RED_GPIO
#define MONITOR_LED_RED_GPIO 27  // ledger N3-20, PROVISIONAL
#endif
#ifndef MONITOR_BUTTON_A_GPIO
#define MONITOR_BUTTON_A_GPIO 32  // ledger N3-23, PROVISIONAL (active LOW)
#endif
#ifndef MONITOR_BUTTON_B_GPIO
#define MONITOR_BUTTON_B_GPIO 33  // ledger N3-25, PROVISIONAL (active LOW)
#endif
#ifndef MONITOR_BUZZER_GPIO
#define MONITOR_BUZZER_GPIO 13  // ledger N3-27 (drives Q1 base via 1 kOhm only)
#endif
#ifndef MONITOR_BUZZER_ENABLED
#define MONITOR_BUZZER_ENABLED 0  // BLOCKED: gate G10 (Q1 part / pinout) not passed
#endif

namespace monitor_cfg {

static const char kFirmwareVersion[] = "1.0.0";
static const char kBoard[] = "ESP32 DevKit V1 / ESP-WROOM-32 (esp32dev; module not bench-verified)";
static const char kTransceiver[] = "SN65HVD230 module (3.3 V; Rs/STB wiring per ledger, gate G4/G5)";

static const canscope::CanConfig kCanConfig = {
    "monitor",                                // NODE_NAME (serial sourceNode)
    3,                                        // NODE_NUMBER: physical Node 3
    MONITOR_CAN_TX_GPIO,                      // CAN_TX_GPIO   WORKING_ASSUMPTION
    MONITOR_CAN_RX_GPIO,                      // CAN_RX_GPIO   WORKING_ASSUMPTION
    MONITOR_CAN_BITRATE,                      // CAN_BITRATE
#if MONITOR_LISTEN_ONLY
    canscope::CanMode::ListenOnly,
#else
    canscope::CanMode::Normal,                // ACKs, but ENABLE_TX=false below
#endif
    canscope::FrameStandard::Classical,
    false,                                    // ENABLE_TX=false: the monitor never transmits
    canscope::ValueStatus::WorkingAssumption,
    canscope::ValueStatus::WorkingAssumption,
};

}  // namespace monitor_cfg
