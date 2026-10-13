// CANScope raw CAN frame model and serial JSON-line encoding.
//
// Raw capture is deliberately independent of protocol decoding: every frame is
// kept, including frames whose ID is unknown. Portable C++11.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace canscope {

static const uint32_t kMaxStandardId = 0x7FF;
static const uint32_t kMaxExtendedId = 0x1FFFFFFF;
static const uint8_t kMaxClassicalPayload = 8;

enum class IdFormat : uint8_t { Standard, Extended };

enum class BusState : uint8_t {
  Unknown,
  Stopped,
  ErrorActive,
  ErrorWarning,  // TEC or REC >= 96
  ErrorPassive,  // TEC or REC >= 128
  BusOff,
  Recovering,
};

// Controller state as reported by the driver, before counter interpretation.
enum class ControllerState : uint8_t { Unknown, Stopped, Running, BusOff, Recovering };

struct RawFrame {
  uint64_t timestamp_us;    // device monotonic time (no wall clock on the ESP32)
  const char* source_node;  // node that captured/reported the frame
  uint32_t can_id;
  IdFormat format;
  bool remote;              // RTR frame (carries no data bytes)
  uint8_t dlc;              // raw DLC 0..15; classical payload is min(dlc, 8)
  uint8_t data[kMaxClassicalPayload];
  BusState bus_state;       // bus state when the frame was captured
  uint16_t tx_error_count;
  uint16_t rx_error_count;
};

bool frame_is_valid(const RawFrame& frame);
size_t payload_length(const RawFrame& frame);

BusState derive_bus_state(ControllerState controller, uint32_t tec, uint32_t rec);

const char* bus_state_name(BusState state);
const char* id_format_name(IdFormat format);

// Serial line protocol (one JSON object per line, see docs/architecture.md).
// Returns the number of characters written (excluding NUL), or 0 if the
// buffer is too small or the frame is invalid.
size_t encode_frame_json(const RawFrame& frame, char* out, size_t out_len);

}  // namespace canscope
