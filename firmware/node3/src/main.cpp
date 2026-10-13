// CANScope Node 3 firmware scaffold.
//
// Implemented: start-up diagnostic banner, config validation, CAN controller
// start (only when the config is valid), raw frame receive -> serial JSON lines,
// periodic status lines, explicit bus-off reporting.
//
// Deliberately NOT implemented: any sensor, input, output or application
// message logic. Node 3's role and peripherals are UNVERIFIED.
#include <Arduino.h>

#include "node3_hw_config.h"
#include "node_runtime.h"

namespace {

const canscope::BannerInfo kBanner = {"node3", node3::kFirmwareVersion, node3::kBoard,
                                      node3::kTransceiver};

canscope::NodeRuntime runtime(node3::kCanConfig, kBanner);

// -----------------------------------------------------------------------------
// Sensors — PLACEHOLDER. TODO: add only after the Node 3 component list and
// pin map (docs/wiring/node-3-pin-map.md) have evidence.
// -----------------------------------------------------------------------------
void sensors_setup() {}
void sensors_poll() {}

// -----------------------------------------------------------------------------
// Inputs — PLACEHOLDER. TODO: no inputs are known.
// -----------------------------------------------------------------------------
void inputs_setup() {}
void inputs_poll() {}

// -----------------------------------------------------------------------------
// Outputs — PLACEHOLDER. TODO: no outputs/actuators are known. Do not drive any
// GPIO here until its load, driver and safe default state are documented.
// -----------------------------------------------------------------------------
void outputs_setup() {}

// -----------------------------------------------------------------------------
// Application messages — PLACEHOLDER. TODO: Node 3 CAN IDs and payloads are
// UNVERIFIED (docs/protocol/can-id-registry.md). Transmission stays disabled
// (ENABLE_TX=false, listen-only) until a test plan authorizes it.
// -----------------------------------------------------------------------------
void app_messages_poll() {}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  runtime.setup();
  sensors_setup();
  inputs_setup();
  outputs_setup();
}

void loop() {
  runtime.loop();
  sensors_poll();
  inputs_poll();
  app_messages_poll();
}
