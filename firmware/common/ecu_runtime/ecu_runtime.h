// ESP32 glue for the Node 1 / Node 2 ECU firmware: TWAI transmit of the
// frames EcuCore schedules, USB-serial command handling with explicit acks,
// and the periodic hello / status / ecu_state lines. ESP32/Arduino only; all
// decisions live in the portable, host-tested EcuCore and serial_link.
#pragma once

#if defined(ARDUINO) && defined(ESP_PLATFORM)

#include <Arduino.h>

#include "can_config.h"
#include "diagnostics.h"
#include "ecu_core.h"
#include "serial_link.h"
#include "twai_transport.h"

namespace canscope {

struct EcuIdentity {
  uint8_t node_id;   // proto::kNodeIdNode1 / kNodeIdNode2
  const char* role;  // "motor_ecu" / "battery_ecu"
  uint8_t fw_major;
  uint8_t fw_minor;
  uint8_t fw_patch;
};

class EcuRuntime {
 public:
  EcuRuntime(const CanConfig& cfg, const BannerInfo& banner, const EcuIdentity& id);

  void setup();
  void loop();

 private:
  void handle_line(const char* line, uint32_t now_ms);
  void ack(const char* id, const char* command, AckStatus status, const char* detail);
  void print_hello();
  void print_status();
  void print_ecu_state();
  void print_alerts(uint32_t alerts);
  void transmit_due(uint32_t now_ms);
  void drain_rx();
  static uint8_t can_state_for(BusState state);

  CanConfig cfg_;
  BannerInfo banner_;
  EcuIdentity id_;
  TwaiTransport transport_;
  EcuCore core_;
  LineAssembler lines_;
  BusStatus status_;
  bool can_ok_;
  char boot_id_[9];
  char commands_[96];
  uint32_t last_status_ms_;
  uint32_t last_state_ms_;
  uint32_t last_hello_ms_;
  uint32_t tx_ok_;
  uint32_t tx_failed_;
  uint32_t rx_ignored_;
  TransportResult last_tx_error_;
};

}  // namespace canscope

#endif
