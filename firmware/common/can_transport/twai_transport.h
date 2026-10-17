// ESP32 TWAI (classical CAN) implementation of CanTransport.
// Uses the legacy ESP-IDF driver "driver/twai.h" (same API as the existing
// sketch_node1_test / sketch_node2_test sketches). Classical CAN only.
#pragma once

#include "can_transport.h"

#if defined(ESP_PLATFORM)

namespace canscope {

class TwaiTransport : public CanTransport {
 public:
  TwaiTransport();

  TransportResult begin(const CanConfig& cfg) override;
  void end() override;
  TransportResult receive(RawFrame& out, uint32_t timeout_ms) override;
  TransportResult transmit(const RawFrame& frame, uint32_t timeout_ms) override;
  BusStatus poll_status() override;
  TransportResult request_bus_off_recovery() override;

  // ESP-IDF esp_err_t of the last failing driver call (0 if none).
  int last_driver_error() const { return last_error_; }
  // Alert bits read during the last poll_status() call.
  uint32_t last_alerts() const { return last_alerts_; }
  bool recovery_pending() const { return recovery_pending_; }
  uint32_t recoveries() const { return recoveries_; }

 private:
  CanConfig cfg_;
  BusStatus status_;
  bool installed_;
  int last_error_;
  uint32_t last_alerts_;
  bool recovery_pending_;
  uint32_t recoveries_;
};

}  // namespace canscope

#endif  // ESP_PLATFORM
