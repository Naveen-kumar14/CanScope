#include "raw_frame.h"

#include "json_writer.h"

namespace canscope {

bool frame_is_valid(const RawFrame& frame) {
  const uint32_t max_id = frame.format == IdFormat::Extended ? kMaxExtendedId : kMaxStandardId;
  return frame.can_id <= max_id && frame.dlc <= 15;
}

size_t payload_length(const RawFrame& frame) {
  if (frame.remote) return 0;
  return frame.dlc > kMaxClassicalPayload ? kMaxClassicalPayload : frame.dlc;
}

BusState derive_bus_state(ControllerState controller, uint32_t tec, uint32_t rec) {
  switch (controller) {
    case ControllerState::Unknown: return BusState::Unknown;
    case ControllerState::Stopped: return BusState::Stopped;
    case ControllerState::BusOff: return BusState::BusOff;
    case ControllerState::Recovering: return BusState::Recovering;
    case ControllerState::Running: break;
  }
  if (tec >= 256) return BusState::BusOff;
  if (tec >= 128 || rec >= 128) return BusState::ErrorPassive;
  if (tec >= 96 || rec >= 96) return BusState::ErrorWarning;
  return BusState::ErrorActive;
}

const char* bus_state_name(BusState state) {
  switch (state) {
    case BusState::Unknown: return "unknown";
    case BusState::Stopped: return "stopped";
    case BusState::ErrorActive: return "error_active";
    case BusState::ErrorWarning: return "error_warning";
    case BusState::ErrorPassive: return "error_passive";
    case BusState::BusOff: return "bus_off";
    case BusState::Recovering: return "recovering";
  }
  return "unknown";
}

const char* id_format_name(IdFormat format) {
  return format == IdFormat::Extended ? "extended" : "standard";
}

size_t encode_frame_json(const RawFrame& frame, char* out, size_t out_len) {
  if (!frame_is_valid(frame)) return 0;

  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "frame");
  w.field_string("sourceNode", frame.source_node ? frame.source_node : "unknown");
  w.field_u64("deviceTimeUs", frame.timestamp_us);
  w.field_hex_id("canId", frame.can_id, frame.format == IdFormat::Extended);
  w.field_string("identifierFormat", id_format_name(frame.format));
  w.field_bool("remote", frame.remote);
  w.field_u64("dlc", frame.dlc);
  w.key("data");
  w.raw("[");
  const size_t n = payload_length(frame);
  for (size_t i = 0; i < n; ++i) {
    if (i) w.raw(",");
    w.u64(frame.data[i]);
  }
  w.raw("]");
  w.field_string("busState", bus_state_name(frame.bus_state));
  w.field_u64("txErrorCount", frame.tx_error_count);
  w.field_u64("rxErrorCount", frame.rx_error_count);
  w.end_object();
  return w.finish();
}

}  // namespace canscope
