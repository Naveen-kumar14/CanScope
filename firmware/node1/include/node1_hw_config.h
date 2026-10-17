// =============================================================================
// Node 1 (Motor ECU) hardware configuration - the only place Node 1 hardware
// values live.
//
// CAN pins / bit rate are WORKING_ASSUMPTION values: they match the canonical
// wiring ledger (docs/wiring/pin_ledger.json rows N1-03/N1-04, status
// PROVISIONAL until bench gates G1-G6 pass) and the original
// sketch_node1_test.ino. tools/hwdocs/ledger.py checks the #define lines below.
// Override for a bench test with e.g. -DNODE1_CAN_TX_GPIO=22.
//
// TX is enabled: Node 1 transmits MOTOR_TELEMETRY (0x120) and its heartbeat
// (0x701), see docs/protocol/canscope-protocol-v1.md.
// =============================================================================
#pragma once

#include "can_config.h"
#include "protocol_spec.h"

#ifndef NODE1_CAN_TX_GPIO
#define NODE1_CAN_TX_GPIO 17  // WORKING_ASSUMPTION (ledger N1-03, PROVISIONAL)
#endif
#ifndef NODE1_CAN_RX_GPIO
#define NODE1_CAN_RX_GPIO 16  // WORKING_ASSUMPTION (ledger N1-04, PROVISIONAL)
#endif
#ifndef NODE1_CAN_BITRATE
#define NODE1_CAN_BITRATE 500000  // protocol v1 bus rate
#endif

namespace node1_cfg {

static const uint8_t kFwMajor = 1;
static const uint8_t kFwMinor = 0;
static const uint8_t kFwPatch = 0;
static const char kFirmwareVersion[] = "1.0.0";
static const char kBoard[] = "ESP32 DevKit V1 / ESP-WROOM-32 (esp32dev; module not bench-verified)";
static const char kTransceiver[] = "SN65HVD230 module (3.3 V; Rs/STB wiring per ledger, gate G4/G5)";

static const canscope::CanConfig kCanConfig = {
    "node1",                                  // NODE_NAME (serial sourceNode)
    canscope::proto::kNodeIdNode1,            // NODE_NUMBER
    NODE1_CAN_TX_GPIO,                        // CAN_TX_GPIO   WORKING_ASSUMPTION
    NODE1_CAN_RX_GPIO,                        // CAN_RX_GPIO   WORKING_ASSUMPTION
    NODE1_CAN_BITRATE,                        // CAN_BITRATE
    canscope::CanMode::Normal,                // full participant: transmits and ACKs
    canscope::FrameStandard::Classical,
    true,                                     // ENABLE_TX=true (application frames only)
    canscope::ValueStatus::WorkingAssumption,
    canscope::ValueStatus::WorkingAssumption,
};

}  // namespace node1_cfg
