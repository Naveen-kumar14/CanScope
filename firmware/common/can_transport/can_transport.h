// CANScope transport boundary: the only layer that touches a CAN controller.
//
// The interface and the transmit gate are portable; the ESP32 TWAI
// implementation lives in twai_transport.{h,cpp} and is compiled only when
// ESP_PLATFORM is defined.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "can_config.h"
#include "raw_frame.h"
#include "transceiver_check.h"

namespace canscope {

enum class TransportResult : uint8_t {
  Ok,
  Timeout,              // no frame within the timeout (not an error)
  NotStarted,
  ConfigInvalid,        // validate_config() reported a blocking error
  DriverInstallFailed,
  StartFailed,
  TxDisabled,           // ENABLE_TX=false or listen-only mode
  BusOff,
  InvalidFrame,
  DriverError,
};

struct BusStatus {
  BusState state;
  bool driver_running;
  uint32_t tx_error_counter;
  uint32_t rx_error_counter;
  uint32_t rx_frames;       // frames handed to the application
  uint32_t tx_frames;       // frames accepted by the driver
  uint32_t tx_failed;
  uint32_t rx_missed;       // dropped because the RX queue was full
  uint32_t bus_errors;
  uint32_t arb_lost;
  uint32_t bus_off_events;  // number of times bus-off was entered
  TransceiverCheck transceiver_check;  // start-up echo check (transceiver_check.h)
};

BusStatus empty_bus_status();

// Transmit gate shared by every transport implementation. Transmission is
// refused unless ENABLE_TX is true, the mode is not listen-only, the driver is
// running, the bus is not off and the frame is valid classical CAN.
TransportResult check_transmit_allowed(const CanConfig& cfg, const BusStatus& status,
                                       const RawFrame& frame);

const char* transport_result_name(TransportResult result);

// One JSON status line for the dashboard ("type":"status").
size_t encode_status_json(const char* node_name, uint64_t device_time_us, const CanConfig& cfg,
                          const BusStatus& status, char* out, size_t out_len);

class CanTransport {
 public:
  virtual ~CanTransport() {}

  // Validates cfg, installs and starts the controller. Explicit failure codes.
  virtual TransportResult begin(const CanConfig& cfg) = 0;
  virtual void end() = 0;

  // Blocks up to timeout_ms. Returns Ok with a fully populated frame, or Timeout.
  virtual TransportResult receive(RawFrame& out, uint32_t timeout_ms) = 0;

  // Always passes through check_transmit_allowed() first.
  virtual TransportResult transmit(const RawFrame& frame, uint32_t timeout_ms) = 0;

  // Reads driver alerts/state and refreshes counters. Call regularly.
  virtual BusStatus poll_status() = 0;

  // Explicitly requested bus-off recovery. Never called automatically.
  virtual TransportResult request_bus_off_recovery() = 0;
};

}  // namespace canscope
