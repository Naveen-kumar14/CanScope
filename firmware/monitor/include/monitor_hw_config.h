// =============================================================================
// monitor hardware configuration — the only place monitor hardware values live.
//
// Passive CANScope monitor. Board and wiring UNVERIFIED; pins assumed identical to the legacy nodes.
//
// CAN pins/bit rate below are WORKING_ASSUMPTION values copied from the existing
// sketch_node1_test.ino / sketch_node2_test.ino (bus settings only) (TX GPIO17, RX GPIO16, 500 kbit/s). They are in source code only;
// no schematic, continuity test or capture verifies them yet.
// Override for a bench test with e.g. -DMONITOR_CAN_TX_GPIO=22.
// =============================================================================
#pragma once

#include "can_config.h"

#ifndef MONITOR_CAN_TX_GPIO
#define MONITOR_CAN_TX_GPIO 17  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef MONITOR_CAN_RX_GPIO
#define MONITOR_CAN_RX_GPIO 16  // WORKING_ASSUMPTION (legacy sketch)
#endif
#ifndef MONITOR_CAN_BITRATE
#define MONITOR_CAN_BITRATE 500000  // WORKING_ASSUMPTION (legacy sketch)
#endif

namespace monitor_cfg {

static const char kFirmwareVersion[] = "0.1.0";
static const char kBoard[] = "esp32dev (board variant UNVERIFIED)";
static const char kTransceiver[] = "UNVERIFIED";

static const canscope::CanConfig kCanConfig = {
    "monitor",                                    // NODE_NAME
    canscope::kNodeNumberUnverified,                                        // NODE_NUMBER
    MONITOR_CAN_TX_GPIO,                          // CAN_TX_GPIO   WORKING_ASSUMPTION
    MONITOR_CAN_RX_GPIO,                          // CAN_RX_GPIO   WORKING_ASSUMPTION
    MONITOR_CAN_BITRATE,                          // CAN_BITRATE   WORKING_ASSUMPTION
    canscope::CanMode::ListenOnly,           // CAN_MODE=listen_only: passive, never ACKs or transmits
    canscope::FrameStandard::Classical,
    false,                                    // ENABLE_TX=false
    canscope::ValueStatus::WorkingAssumption,
    canscope::ValueStatus::WorkingAssumption,
};

}  // namespace monitor_cfg
