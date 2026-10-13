// Shared ESP32 runtime used by every node target: banner, CAN start-up,
// raw-frame capture to serial JSON lines, periodic status lines and explicit
// bus-off reporting. ESP32/Arduino only.
#pragma once

#if defined(ARDUINO) && defined(ESP_PLATFORM)

#include <Arduino.h>

#include "can_config.h"
#include "diagnostics.h"
#include "twai_transport.h"

namespace canscope {

class NodeRuntime {
 public:
  NodeRuntime(const CanConfig& cfg, const BannerInfo& info);

  // Prints the banner, validates the configuration and starts CAN if valid.
  void setup();

  // Drains received frames, prints them, polls alerts, emits status lines.
  void loop();

  bool can_running() const { return can_ok_; }
  CanTransport& transport() { return transport_; }

 private:
  void print_alerts(uint32_t alerts);
  void print_status(const BusStatus& status);

  CanConfig cfg_;
  BannerInfo info_;
  TwaiTransport transport_;
  bool can_ok_;
  uint32_t last_status_ms_;
  uint32_t last_retry_hint_ms_;
};

}  // namespace canscope

#endif
