// =============================================================================
// Node 3 hardware configuration — the ONLY place Node 3 hardware values live.
//
// Every value below is UNVERIFIED. With these defaults the firmware prints its
// banner and REFUSES to start the CAN controller, so no guessed GPIO is driven.
//
// To run a controlled bench test with a working assumption, override from the
// command line instead of editing guesses into this file, e.g.:
//   PLATFORMIO_BUILD_FLAGS="-DNODE3_CAN_TX_GPIO=22 -DNODE3_CAN_RX_GPIO=21 -DNODE3_CAN_BITRATE=500000"
//   pio run -d firmware/node3 -e node3     (both on one command line)
// and record the assumption + evidence in TASK.md and docs/wiring/node-3-pin-map.md.
//
// Candidates on record (NOT verified):
//   - GPIO22 TX / GPIO21 RX: brief's candidate TWAI map (WORKING_ASSUMPTION).
//   - GPIO17 TX / GPIO16 RX, 500 kbit/s: used by the legacy Node 1/2 sketches.
// When a value is verified, set it here, change its *_STATUS to Verified and
// cite the evidence (schematic, datasheet, continuity test, capture) inline.
// =============================================================================
#pragma once

#include "can_config.h"

#ifndef NODE3_CAN_TX_GPIO
#define NODE3_CAN_TX_GPIO canscope::kGpioUnverified  // UNVERIFIED
#endif
#ifndef NODE3_CAN_RX_GPIO
#define NODE3_CAN_RX_GPIO canscope::kGpioUnverified  // UNVERIFIED
#endif
#ifndef NODE3_CAN_BITRATE
#define NODE3_CAN_BITRATE canscope::kBitrateUnverified  // UNVERIFIED
#endif

namespace node3 {

static const char kFirmwareVersion[] = "0.1.0";
static const char kBoard[] = "esp32dev (board variant UNVERIFIED)";
static const char kTransceiver[] = "UNVERIFIED (part, supply voltage and STB/RS wiring unknown)";

static const canscope::CanConfig kCanConfig = {
    "node3",                                  // NODE_NAME
    3,                                        // NODE_NUMBER (folder/brief naming)
    NODE3_CAN_TX_GPIO,                        // CAN_TX_GPIO        UNVERIFIED
    NODE3_CAN_RX_GPIO,                        // CAN_RX_GPIO        UNVERIFIED
    NODE3_CAN_BITRATE,                        // CAN_BITRATE        UNVERIFIED
    canscope::CanMode::ListenOnly,            // CAN_MODE=listen_only (passive by default)
    canscope::FrameStandard::Classical,       // ESP32 TWAI is classical CAN only
    false,                                    // ENABLE_TX=false
    canscope::ValueStatus::Unverified,        // pins status
    canscope::ValueStatus::Unverified,        // bit rate status
};

}  // namespace node3
