// CANScope node1 firmware: banner, CAN start-up, raw frame capture to serial
// JSON lines and periodic status. No application logic, no transmission.
#include <Arduino.h>

#include "node_runtime.h"
#include "node1_hw_config.h"

namespace {

const canscope::BannerInfo kBanner = {"node1", node1_cfg::kFirmwareVersion, node1_cfg::kBoard,
                                      node1_cfg::kTransceiver};

canscope::NodeRuntime runtime(node1_cfg::kCanConfig, kBanner);

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  runtime.setup();
}

void loop() { runtime.loop(); }
