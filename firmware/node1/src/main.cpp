// CANScope Node 1 firmware - Motor ECU: RPM + motor temperature.
//
// Transmits protocol v1 telemetry every 100 ms and a heartbeat every 500 ms,
// accepts validated USB-serial commands (set / profile / fault / recover) and
// acknowledges every command line. Logic: firmware/common/ecu_core (portable,
// host-tested); ESP32 glue: firmware/common/ecu_runtime.
#include <Arduino.h>

#include "ecu_runtime.h"
#include "node1_hw_config.h"
#include "protocol_spec.h"

namespace {

const canscope::BannerInfo kBanner = {"node1 (motor_ecu)", node1_cfg::kFirmwareVersion, node1_cfg::kBoard,
                                      node1_cfg::kTransceiver};
const canscope::EcuIdentity kIdentity = {canscope::proto::kNodeIdNode1, "motor_ecu", node1_cfg::kFwMajor,
                                         node1_cfg::kFwMinor, node1_cfg::kFwPatch};

canscope::EcuRuntime runtime(node1_cfg::kCanConfig, kBanner, kIdentity);

}  // namespace

void setup() {
  Serial.setRxBufferSize(512);
  Serial.setTxBufferSize(2048);
  Serial.begin(canscope::proto::kSerialBaud);
  delay(200);
  runtime.setup();
}

void loop() { runtime.loop(); }
