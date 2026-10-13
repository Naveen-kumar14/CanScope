// =============================================================================
// node2 hardware configuration — the only place node2 hardware values live.
//
// Legacy sketch is a 'Battery ECU' TEST transmitter (constant values). Its test traffic is NOT ported: ENABLE_TX=false here. Use env legacy_sketch for that behaviour.
//
// CAN pins/bit rate below are WORKING_ASSUMPTION values copied from the existing
// sketch_node2_test.ino (TX GPIO17, RX GPIO16, 500 kbit/s). They are in source code only;
// no schematic, continuity test or capture verifies them yet.
// Override for a bench test with e.g. -DNODE2_CAN_TX_GPIO=22.
// =============================================================================
#pragma once

#include "can_config.h"

#ifndef NODE2_CAN_TX_GPIO
#define NODE2_CAN_TX_GPIO 17  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef NODE2_CAN_RX_GPIO
#define NODE2_CAN_RX_GPIO 16  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef NODE2_CAN_BITRATE
#define NODE2_CAN_BITRATE 500000  // WORKING_ASSUMPTION (legacy sketch)
#endif

namespace node2_cfg {

static const char kFirmwareVersion[] = "0.1.0";
static const char kBoard[] = "esp32dev (board variant UNVERIFIED)";
static const char kTransceiver[] = "UNVERIFIED";

static const canscope::CanConfig kCanConfig = {
    "node2",                                    // NODE_NAME
    2,                                        // NODE_NUMBER
    NODE2_CAN_TX_GPIO,                          // CAN_TX_GPIO   WORKING_ASSUMPTION
    NODE2_CAN_RX_GPIO,                          // CAN_RX_GPIO   WORKING_ASSUMPTION
    NODE2_CAN_BITRATE,                          // CAN_BITRATE   WORKING_ASSUMPTION
    canscope::CanMode::Normal,           // normal: ACKs frames like the legacy sketch (TX still disabled)
    canscope::FrameStandard::Classical,
    false,                                    // ENABLE_TX=false
    canscope::ValueStatus::WorkingAssumption,
    canscope::ValueStatus::WorkingAssumption,
};

}  // namespace node2_cfg
