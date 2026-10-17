#include "can_protocol.h"

#include <string.h>

namespace canscope {
namespace proto {

namespace {

void init_frame(uint32_t id, RawFrame& out) {
  memset(&out, 0, sizeof(out));
  out.can_id = id;
  out.format = IdFormat::Standard;
  out.remote = false;
  out.dlc = 8;
}

void finish_frame(uint8_t counter, RawFrame& out) {
  out.data[kCounterByte] = counter;
  out.data[kChecksumByte] = compute_checksum(out.can_id, out.data);
}

void put_field(FieldId id, const int32_t* values, RawFrame& out) {
  const FieldInfo& f = field_info(id);
  write_be(out.data, f.start, f.length, values[static_cast<size_t>(id)]);
}

bool get_field(FieldId id, const RawFrame& frame, DecodedFrame& d) {
  const FieldInfo& f = field_info(id);
  const int32_t raw = read_be(frame.data, f.start, f.length, f.is_signed);
  d.values[static_cast<size_t>(id)] = raw;
  if (!field_in_range(id, raw) && d.check == FrameCheck::Ok) {
    d.check = FrameCheck::ValueOutOfRange;
    d.bad_field = id;
  }
  return true;
}

}  // namespace

uint8_t compute_checksum(uint32_t can_id, const uint8_t* data) {
  uint32_t sum = ((can_id >> 8) & 0xFF) + (can_id & 0xFF);
  for (uint8_t i = 0; i < kChecksumByte; ++i) sum += data[i];
  return static_cast<uint8_t>(~sum & 0xFF);
}

void write_be(uint8_t* data, uint8_t start, uint8_t length, int32_t raw) {
  uint32_t v = static_cast<uint32_t>(raw);
  for (uint8_t i = 0; i < length; ++i) {
    data[start + length - 1 - i] = static_cast<uint8_t>(v & 0xFF);
    v >>= 8;
  }
}

int32_t read_be(const uint8_t* data, uint8_t start, uint8_t length, bool is_signed) {
  uint32_t v = 0;
  for (uint8_t i = 0; i < length; ++i) v = (v << 8) | data[start + i];
  if (is_signed && length < 4) {
    const uint32_t sign = 1u << (length * 8 - 1);
    if (v & sign) return static_cast<int32_t>(v) - static_cast<int32_t>(sign << 1);
  }
  return static_cast<int32_t>(v);
}

const FieldInfo& field_info(FieldId id) { return kFields[static_cast<size_t>(id)]; }

bool field_in_range(FieldId id, int32_t raw) {
  const FieldInfo& f = field_info(id);
  return raw >= f.min && raw <= f.max;
}

const FieldInfo* find_field(const char* key) {
  if (key == nullptr) return nullptr;
  for (size_t i = 0; i < kFieldCount; ++i) {
    if (strcmp(kFields[i].key, key) == 0) return &kFields[i];
  }
  return nullptr;
}

void encode_motor(const int32_t* values, uint8_t counter, RawFrame& out) {
  init_frame(kMotorTelemetryId, out);
  put_field(FieldId::Rpm, values, out);
  put_field(FieldId::MotorTempC, values, out);
  finish_frame(counter, out);
}

void encode_battery(const int32_t* values, uint8_t counter, RawFrame& out) {
  init_frame(kBatteryTelemetryId, out);
  put_field(FieldId::PackVoltageV, values, out);
  put_field(FieldId::PackCurrentA, values, out);
  put_field(FieldId::SocPct, values, out);
  finish_frame(counter, out);
}

void encode_heartbeat(const Heartbeat& hb, uint8_t counter, RawFrame& out) {
  init_frame(heartbeat_id(hb.node_id), out);
  out.data[kHbProtocolVersionByte] = hb.protocol_version;
  out.data[kHbNodeIdByte] = hb.node_id;
  out.data[kHbFwMajorByte] = hb.fw_major;
  out.data[kHbFwMinorByte] = hb.fw_minor;
  out.data[kHbFwPatchByte] = hb.fw_patch;
  out.data[kHbCanStateByte] = hb.can_state;
  finish_frame(counter, out);
}

uint32_t heartbeat_id(uint8_t node_id) {
  if (node_id == kNodeIdNode1) return kNode1HeartbeatId;
  if (node_id == kNodeIdNode2) return kNode2HeartbeatId;
  return 0;
}

uint32_t telemetry_id(uint8_t node_id) {
  if (node_id == kNodeIdNode1) return kMotorTelemetryId;
  if (node_id == kNodeIdNode2) return kBatteryTelemetryId;
  return 0;
}

FrameKind classify(uint32_t can_id, IdFormat format, uint8_t& node_id) {
  node_id = 0;
  if (format != IdFormat::Standard) return FrameKind::Unknown;
  if (can_id == kMotorTelemetryId) {
    node_id = kNodeIdNode1;
    return FrameKind::MotorTelemetry;
  }
  if (can_id == kBatteryTelemetryId) {
    node_id = kNodeIdNode2;
    return FrameKind::BatteryTelemetry;
  }
  if (can_id == kNode1HeartbeatId) {
    node_id = kNodeIdNode1;
    return FrameKind::Heartbeat;
  }
  if (can_id == kNode2HeartbeatId) {
    node_id = kNodeIdNode2;
    return FrameKind::Heartbeat;
  }
  return FrameKind::Unknown;
}

DecodedFrame decode(const RawFrame& frame) {
  DecodedFrame d;
  memset(&d, 0, sizeof(d));
  d.check = FrameCheck::Ok;
  d.bad_field = FieldId::Count;

  if (frame.format == IdFormat::Extended) {
    // An extended frame never matches a v1 ID, even with the same number.
    d.kind = FrameKind::Unknown;
    uint8_t ignored = 0;
    d.check = classify(frame.can_id, IdFormat::Standard, ignored) == FrameKind::Unknown
                  ? FrameCheck::UnsupportedId
                  : FrameCheck::ExtendedId;
    return d;
  }
  d.kind = classify(frame.can_id, frame.format, d.node_id);
  if (d.kind == FrameKind::Unknown) {
    d.check = FrameCheck::UnsupportedId;
    return d;
  }
  if (frame.remote) {
    d.check = FrameCheck::Remote;
    return d;
  }
  if (frame.dlc != 8) {
    d.check = FrameCheck::BadDlc;
    return d;
  }
  if (compute_checksum(frame.can_id, frame.data) != frame.data[kChecksumByte]) {
    d.check = FrameCheck::BadChecksum;
    return d;
  }
  d.counter = frame.data[kCounterByte];

  switch (d.kind) {
    case FrameKind::MotorTelemetry:
      get_field(FieldId::Rpm, frame, d);
      get_field(FieldId::MotorTempC, frame, d);
      break;
    case FrameKind::BatteryTelemetry:
      get_field(FieldId::PackVoltageV, frame, d);
      get_field(FieldId::PackCurrentA, frame, d);
      get_field(FieldId::SocPct, frame, d);
      break;
    case FrameKind::Heartbeat: {
      Heartbeat& hb = d.heartbeat;
      hb.protocol_version = frame.data[kHbProtocolVersionByte];
      hb.node_id = frame.data[kHbNodeIdByte];
      hb.fw_major = frame.data[kHbFwMajorByte];
      hb.fw_minor = frame.data[kHbFwMinorByte];
      hb.fw_patch = frame.data[kHbFwPatchByte];
      hb.can_state = frame.data[kHbCanStateByte];
      if (hb.node_id != d.node_id) {
        d.check = FrameCheck::BadNodeId;
      } else if (hb.protocol_version != kProtocolVersion) {
        d.check = FrameCheck::UnsupportedVersion;
      } else if (hb.can_state > kCanStateMax) {
        d.check = FrameCheck::ValueOutOfRange;
      }
      break;
    }
    case FrameKind::Unknown:
      break;
  }
  return d;
}

const char* frame_check_name(FrameCheck check) {
  switch (check) {
    case FrameCheck::Ok: return "ok";
    case FrameCheck::UnsupportedId: return "unsupported_id";
    case FrameCheck::ExtendedId: return "extended_id";
    case FrameCheck::Remote: return "remote_frame";
    case FrameCheck::BadDlc: return "bad_dlc";
    case FrameCheck::BadChecksum: return "bad_checksum";
    case FrameCheck::ValueOutOfRange: return "value_out_of_range";
    case FrameCheck::BadNodeId: return "bad_node_id";
    case FrameCheck::UnsupportedVersion: return "unsupported_version";
  }
  return "unknown";
}

const char* frame_kind_name(FrameKind kind) {
  switch (kind) {
    case FrameKind::Unknown: return "unknown";
    case FrameKind::MotorTelemetry: return "motor_telemetry";
    case FrameKind::BatteryTelemetry: return "battery_telemetry";
    case FrameKind::Heartbeat: return "heartbeat";
  }
  return "unknown";
}

const FaultInfo& fault_info(FaultCode code) { return kFaults[static_cast<size_t>(code)]; }

const char* fault_name(FaultCode code) {
  return static_cast<size_t>(code) < kFaultCount ? fault_info(code).name : "UNKNOWN";
}

const char* severity_name(Severity severity) {
  switch (severity) {
    case Severity::Info: return "info";
    case Severity::Warning: return "warning";
    case Severity::Critical: return "critical";
  }
  return "unknown";
}

const char* demo_fault_name(DemoFault fault) {
  const size_t i = static_cast<size_t>(fault);
  return i < static_cast<size_t>(DemoFault::Count) ? kDemoFaultNames[i] : "unknown";
}

bool parse_demo_fault(const char* name, DemoFault& out) {
  if (name == nullptr) return false;
  for (size_t i = 0; i < static_cast<size_t>(DemoFault::Count); ++i) {
    if (strcmp(kDemoFaultNames[i], name) == 0) {
      out = static_cast<DemoFault>(i);
      return true;
    }
  }
  return false;
}

const char* node_name(uint8_t node_id) {
  if (node_id == kNodeIdNode1) return "node1";
  if (node_id == kNodeIdNode2) return "node2";
  if (node_id == kNodeIdMonitor) return "monitor";
  return "unknown";
}

const char* can_state_name(uint8_t state) {
  return state <= kCanStateMax ? kCanStateNames[state] : "invalid";
}

size_t format_scaled(int32_t raw, uint8_t decimals, char* out, size_t out_len) {
  char digits[16];
  size_t n = 0;
  const bool negative = raw < 0;
  // Work in uint32 so INT32_MIN negates safely.
  uint32_t v = negative ? 0u - static_cast<uint32_t>(raw) : static_cast<uint32_t>(raw);
  do {
    digits[n++] = static_cast<char>('0' + v % 10);
    v /= 10;
  } while (v != 0 || n <= decimals);

  const size_t needed = (negative ? 1 : 0) + n + (decimals ? 1 : 0);
  if (out == nullptr || out_len < needed + 1) {
    if (out && out_len) out[0] = '\0';
    return 0;
  }
  size_t pos = 0;
  if (negative) out[pos++] = '-';
  while (n > 0) {
    if (decimals && n == decimals) out[pos++] = '.';
    out[pos++] = digits[--n];
  }
  out[pos] = '\0';
  return pos;
}

NumberParse parse_scaled(const char* text, uint8_t decimals, int32_t& raw) {
  if (text == nullptr || *text == '\0') return NumberParse::Empty;
  const char* p = text;
  bool negative = false;
  if (*p == '-' || *p == '+') {
    negative = *p == '-';
    ++p;
  }
  int64_t value = 0;
  size_t int_digits = 0;
  size_t frac_digits = 0;
  bool seen_point = false;
  for (; *p; ++p) {
    if (*p >= '0' && *p <= '9') {
      if (seen_point) {
        if (++frac_digits > decimals) return NumberParse::TooManyDecimals;
      } else {
        ++int_digits;
      }
      value = value * 10 + (*p - '0');
      if (value > 2147483647LL) return NumberParse::Overflow;
    } else if (*p == '.' && !seen_point) {
      seen_point = true;
    } else {
      return NumberParse::Syntax;
    }
  }
  if (int_digits == 0 || (seen_point && frac_digits == 0)) return NumberParse::Syntax;
  for (size_t i = frac_digits; i < decimals; ++i) {
    value *= 10;
    if (value > 2147483647LL) return NumberParse::Overflow;
  }
  raw = static_cast<int32_t>(negative ? -value : value);
  return NumberParse::Ok;
}

const char* number_parse_name(NumberParse result) {
  switch (result) {
    case NumberParse::Ok: return "ok";
    case NumberParse::Empty: return "missing value";
    case NumberParse::Syntax: return "not a decimal number";
    case NumberParse::TooManyDecimals: return "too many decimal places";
    case NumberParse::Overflow: return "number too large";
  }
  return "invalid number";
}

}  // namespace proto
}  // namespace canscope
