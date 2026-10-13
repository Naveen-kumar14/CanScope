// CANScope monitor firmware: banner, CAN start-up, raw frame capture to serial
// JSON lines and periodic status. No application logic, no transmission.
#include <Arduino.h>

#include "node_runtime.h"
#include "monitor_hw_config.h"

namespace {

const canscope::BannerInfo kBanner = {"monitor", monitor_cfg::kFirmwareVersion, monitor_cfg::kBoard,
                                      monitor_cfg::kTransceiver};

canscope::NodeRuntime runtime(monitor_cfg::kCanConfig, kBanner);

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(500);
  runtime.setup();
}

void loop() { runtime.loop(); }
