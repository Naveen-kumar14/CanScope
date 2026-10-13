// =============================================================================
// node1 hardware configuration — the only place node1 hardware values live.
//
// Legacy sketch only starts the controller; role beyond that is UNVERIFIED.
//
// CAN pins/bit rate below are WORKING_ASSUMPTION values copied from the existing
// sketch_node1_test.ino (TX GPIO17, RX GPIO16, 500 kbit/s). They are in source code only;
// no schematic, continuity test or capture verifies them yet.
// Override for a bench test with e.g. -DNODE1_CAN_TX_GPIO=22.
// =============================================================================
#pragma once

#include "can_config.h"

#ifndef NODE1_CAN_TX_GPIO
#define NODE1_CAN_TX_GPIO 17  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef NODE1_CAN_RX_GPIO
#define NODE1_CAN_RX_GPIO 16  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef NODE1_CAN_BITRATE
#define NODE1_CAN_BITRATE 500000  // WORKING_ASSUMPTION (legacy sketch)
#endif

namespace node1_cfg {

static const char kFirmwareVersion[] = "0.1.0";
static const char kBoard[] = "esp32dev (board variant UNVERIFIED)";
static const char kTransceiver[] = "UNVERIFIED";

static const canscope::CanConfig kCanConfig = {
    "node1",                                    // NODE_NAME
    1,                                        // NODE_NUMBER
    NODE1_CAN_TX_GPIO,                          // CAN_TX_GPIO   WORKING_ASSUMPTION
    NODE1_CAN_RX_GPIO,                          // CAN_RX_GPIO   WORKING_ASSUMPTION
    NODE1_CAN_BITRATE,                          // CAN_BITRATE   WORKING_ASSUMPTION
    canscope::CanMode::Normal,           // normal: ACKs frames like the legacy sketch (TX still disabled)
    canscope::FrameStandard::Classical,
    false,                                    // ENABLE_TX=false
    canscope::ValueStatus::WorkingAssumption,
    canscope::ValueStatus::WorkingAssumption,
};

}  // namespace node1_cfg
