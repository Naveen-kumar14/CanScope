// CANScope protocol v1 codec: encode/decode/validate the application frames.
//
// Constants come from protocol_spec.h, generated from
// protocol/canscope_protocol.json. Portable C++11, unit-tested on the host
// (test/protocol/test_can_protocol.cpp) against generated golden vectors that
// the dashboard tests use too.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "protocol_spec.h"
#include "raw_frame.h"

namespace canscope {
namespace proto {

enum class FrameKind : uint8_t { Unknown, MotorTelemetry, BatteryTelemetry, Heartbeat };

// Result of validating a received frame, in the order the checks are applied.
enum class FrameCheck : uint8_t {
  Ok,
  UnsupportedId,       // not a protocol ID (raw frame is still kept by the caller)
  ExtendedId,          // protocol v1 uses standard 11-bit IDs only
  Remote,              // RTR frame on a data ID
  BadDlc,
  BadChecksum,
  ValueOutOfRange,     // a field outside its valid range; see bad_field
  BadNodeId,           // heartbeat node-id byte does not match its CAN ID
  UnsupportedVersion,  // heartbeat announced a protocol version we do not speak
};

struct Heartbeat {
  uint8_t protocol_version;
  uint8_t node_id;
  uint8_t fw_major;
  uint8_t fw_minor;
  uint8_t fw_patch;
  uint8_t can_state;  // 0 error_active, 1 error_warning, 2 error_passive
};

struct DecodedFrame {
  FrameKind kind;
  FrameCheck check;
  uint8_t node_id;  // sender implied by the CAN ID (0 if unknown)
  uint8_t counter;
  // Telemetry raw values indexed by FieldId; only the sender's fields are set.
  int32_t values[kFieldCount];
  Heartbeat heartbeat;
  FieldId bad_field;  // valid when check == ValueOutOfRange on telemetry
};

// Byte 7 checksum over the CAN ID and bytes 0..6.
uint8_t compute_checksum(uint32_t can_id, const uint8_t* data);

void write_be(uint8_t* data, uint8_t start, uint8_t length, int32_t raw);
int32_t read_be(const uint8_t* data, uint8_t start, uint8_t length, bool is_signed);

const FieldInfo& field_info(FieldId id);
bool field_in_range(FieldId id, int32_t raw);
// Looks up a field by its JSON key ("rpm", "motorTempC", ...). nullptr if unknown.
const FieldInfo* find_field(const char* key);

// Encoders fill id, format, dlc and the 8 payload bytes (counter + checksum).
// `values` is indexed by FieldId. They do not range-check: the ECU validates
// before storing values, and fault injection deliberately encodes bad data.
void encode_motor(const int32_t* values, uint8_t counter, RawFrame& out);
void encode_battery(const int32_t* values, uint8_t counter, RawFrame& out);
void encode_heartbeat(const Heartbeat& hb, uint8_t counter, RawFrame& out);

uint32_t heartbeat_id(uint8_t node_id);  // 0 for a node without a heartbeat
uint32_t telemetry_id(uint8_t node_id);  // 0 for a node without telemetry

// Classifies by ID only (standard frames). node_id is set for protocol IDs.
FrameKind classify(uint32_t can_id, IdFormat format, uint8_t& node_id);

// Full validation + decode of a received frame.
DecodedFrame decode(const RawFrame& frame);

const char* frame_check_name(FrameCheck check);
const char* frame_kind_name(FrameKind kind);
const char* fault_name(FaultCode code);
const FaultInfo& fault_info(FaultCode code);
const char* severity_name(Severity severity);
const char* demo_fault_name(DemoFault fault);
bool parse_demo_fault(const char* name, DemoFault& out);
const char* node_name(uint8_t node_id);  // "node1", "node2", "monitor" or "unknown"
const char* can_state_name(uint8_t state);

// Formats a raw integer with `decimals` implied decimal places: (652, 1) -> "65.2".
// Returns characters written (excluding NUL), 0 if the buffer is too small.
size_t format_scaled(int32_t raw, uint8_t decimals, char* out, size_t out_len);

enum class NumberParse : uint8_t { Ok, Empty, Syntax, TooManyDecimals, Overflow };
// Exact decimal parse without floating point: ("65.2", 1) -> 652.
// Accepts an optional sign, digits and at most `decimals` fractional digits.
// Rejects exponents, hex, whitespace, trailing characters, "nan"/"inf".
NumberParse parse_scaled(const char* text, uint8_t decimals, int32_t& raw);
const char* number_parse_name(NumberParse result);

}  // namespace proto
}  // namespace canscope
