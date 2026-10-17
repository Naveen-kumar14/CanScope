// CANScope Node 2 firmware - Battery ECU: pack voltage, current + state of charge.
//
// Transmits protocol v1 telemetry every 100 ms and a heartbeat every 500 ms,
// accepts validated USB-serial commands (set / profile / fault / recover) and
// acknowledges every command line. Logic: firmware/common/ecu_core (portable,
// host-tested); ESP32 glue: firmware/common/ecu_runtime.
#include <Arduino.h>

#include "ecu_runtime.h"
#include "node2_hw_config.h"
#include "protocol_spec.h"

namespace {

const canscope::BannerInfo kBanner = {"node2 (battery_ecu)", node2_cfg::kFirmwareVersion, node2_cfg::kBoard,
                                      node2_cfg::kTransceiver};
const canscope::EcuIdentity kIdentity = {canscope::proto::kNodeIdNode2, "battery_ecu", node2_cfg::kFwMajor,
                                         node2_cfg::kFwMinor, node2_cfg::kFwPatch};

canscope::EcuRuntime runtime(node2_cfg::kCanConfig, kBanner, kIdentity);

}  // namespace

void setup() {
  Serial.setRxBufferSize(512);
  Serial.setTxBufferSize(2048);
  Serial.begin(canscope::proto::kSerialBaud);
  delay(200);
  runtime.setup();
}

void loop() { runtime.loop(); }
