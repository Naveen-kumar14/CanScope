#include "can_transport.h"

#include "json_writer.h"

namespace canscope {

BusStatus empty_bus_status() {
  BusStatus s;
  s.state = BusState::Unknown;
  s.driver_running = false;
  s.tx_error_counter = 0;
  s.rx_error_counter = 0;
  s.rx_frames = 0;
  s.tx_frames = 0;
  s.tx_failed = 0;
  s.rx_missed = 0;
  s.bus_errors = 0;
  s.arb_lost = 0;
  s.bus_off_events = 0;
  return s;
}

TransportResult check_transmit_allowed(const CanConfig& cfg, const BusStatus& status,
                                       const RawFrame& frame) {
  if (!tx_permitted(cfg)) return TransportResult::TxDisabled;
  if (!status.driver_running) return TransportResult::NotStarted;
  if (status.state == BusState::BusOff || status.state == BusState::Recovering) {
    return TransportResult::BusOff;
  }
  if (!frame_is_valid(frame) || frame.dlc > kMaxClassicalPayload) {
    return TransportResult::InvalidFrame;
  }
  return TransportResult::Ok;
}

const char* transport_result_name(TransportResult result) {
  switch (result) {
    case TransportResult::Ok: return "ok";
    case TransportResult::Timeout: return "timeout";
    case TransportResult::NotStarted: return "not_started";
    case TransportResult::ConfigInvalid: return "config_invalid";
    case TransportResult::DriverInstallFailed: return "driver_install_failed";
    case TransportResult::StartFailed: return "start_failed";
    case TransportResult::TxDisabled: return "tx_disabled";
    case TransportResult::BusOff: return "bus_off";
    case TransportResult::InvalidFrame: return "invalid_frame";
    case TransportResult::DriverError: return "driver_error";
  }
  return "unknown";
}

size_t encode_status_json(const char* node_name, uint64_t device_time_us, const CanConfig& cfg,
                          const BusStatus& status, char* out, size_t out_len) {
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "status");
  w.field_string("sourceNode", node_name ? node_name : "unknown");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("busState", bus_state_name(status.state));
  w.field_bool("driverRunning", status.driver_running);
  w.field_string("mode", mode_name(cfg.mode));
  w.field_bool("txEnabled", tx_permitted(cfg));
  w.field_u64("bitrate", cfg.bitrate);
  w.field_string("configStatus", status_name(cfg.pins_status < cfg.bitrate_status ? cfg.pins_status
                                                                                   : cfg.bitrate_status));
  w.field_u64("txErrorCount", status.tx_error_counter);
  w.field_u64("rxErrorCount", status.rx_error_counter);
  w.field_u64("rxFrames", status.rx_frames);
  w.field_u64("txFrames", status.tx_frames);
  w.field_u64("txFailed", status.tx_failed);
  w.field_u64("rxMissed", status.rx_missed);
  w.field_u64("busErrors", status.bus_errors);
  w.field_u64("arbitrationLost", status.arb_lost);
  w.field_u64("busOffEvents", status.bus_off_events);
  w.end_object();
  return w.finish();
}

}  // namespace canscope
