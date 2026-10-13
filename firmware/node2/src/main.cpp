// CANScope node2 firmware: banner, CAN start-up, raw frame capture to serial
// JSON lines and periodic status. No application logic, no transmission.
#include <Arduino.h>

#include "node_runtime.h"
#include "node2_hw_config.h"

namespace {

const canscope::BannerInfo kBanner = {"node2", node2_cfg::kFirmwareVersion, node2_cfg::kBoard,
                                      node2_cfg::kTransceiver};

canscope::NodeRuntime runtime(node2_cfg::kCanConfig, kBanner);

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  runtime.setup();
}

void loop() { runtime.loop(); }
