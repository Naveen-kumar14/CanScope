#include "ecu_core.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "json_writer.h"

namespace canscope {

using proto::DemoFault;
using proto::FieldId;

namespace {

const double kTwoPi = 6.283185307179586;

// "Drive" profile: deterministic variation around the commanded setpoint.
struct Wave {
  FieldId id;
  int32_t amplitude_permille;  // of the setpoint magnitude (0 = use fixed)
  int32_t amplitude_fixed;     // raw units
  uint32_t period_ms;
};

const Wave kWaves[] = {
    {FieldId::Rpm, 80, 0, 10000},          // +-8 % over 10 s
    {FieldId::MotorTempC, 0, 10, 30000},   // +-1.0 degC over 30 s
    {FieldId::PackVoltageV, 0, 30, 20000}, // +-0.30 V over 20 s
    {FieldId::PackCurrentA, 150, 0, 8000}, // +-15 % over 8 s
};

bool due(uint32_t now, uint32_t at) { return static_cast<int32_t>(now - at) >= 0; }

void set_detail(EcuCommandResult& r, AckStatus status, const char* text) {
  r.status = status;
  snprintf(r.detail, sizeof(r.detail), "%s", text);
}

int32_t clamp_field(FieldId id, int32_t v) {
  const proto::FieldInfo& f = proto::field_info(id);
  return v < f.min ? f.min : (v > f.max ? f.max : v);
}

}  // namespace

const char* ecu_profile_name(EcuProfile profile) {
  return profile == EcuProfile::Drive ? "drive" : "static";
}

EcuCore::EcuCore(uint8_t node_id, uint8_t fw_major, uint8_t fw_minor, uint8_t fw_patch)
    : node_id_(node_id),
      can_state_(0),
      profile_(EcuProfile::Static),
      profile_start_ms_(0),
      fault_(DemoFault::None),
      next_tel_ms_(0),
      next_hb_ms_(0),
      tel_counter_(0),
      hb_counter_(0),
      tel_frames_(0),
      hb_frames_(0) {
  fw_[0] = fw_major;
  fw_[1] = fw_minor;
  fw_[2] = fw_patch;
  for (size_t i = 0; i < proto::kFieldCount; ++i) {
    setpoint_[i] = proto::kFields[i].def;
    sent_[i] = proto::kFields[i].def;
  }
}

void EcuCore::begin(uint32_t now_ms) {
  next_tel_ms_ = now_ms;
  next_hb_ms_ = now_ms;
  profile_start_ms_ = now_ms;
}

bool EcuCore::owns_field(FieldId id) const {
  return proto::field_info(id).node_id == node_id_;
}

int32_t EcuCore::profile_value(FieldId id, uint32_t now_ms) const {
  const int32_t sp = setpoint_[static_cast<size_t>(id)];
  if (profile_ != EcuProfile::Drive) return sp;
  for (size_t i = 0; i < sizeof(kWaves) / sizeof(kWaves[0]); ++i) {
    const Wave& w = kWaves[i];
    if (w.id != id) continue;
    const int32_t magnitude = sp < 0 ? -sp : sp;
    const int32_t amp = w.amplitude_permille ? magnitude * w.amplitude_permille / 1000 : w.amplitude_fixed;
    const double phase = kTwoPi * static_cast<double>((now_ms - profile_start_ms_) % w.period_ms) /
                         static_cast<double>(w.period_ms);
    const double v = static_cast<double>(sp) + static_cast<double>(amp) * sin(phase);
    return clamp_field(id, static_cast<int32_t>(v >= 0 ? v + 0.5 : v - 0.5));
  }
  return sp;  // e.g. SoC: held at the setpoint
}

size_t EcuCore::poll(uint32_t now_ms, RawFrame* out, size_t max_frames) {
  size_t n = 0;
  const bool silent = fault_ == DemoFault::Silent;

  if (n < max_frames && due(now_ms, next_tel_ms_)) {
    next_tel_ms_ += proto::kTelemetryPeriodMs;
    if (due(now_ms, next_tel_ms_)) next_tel_ms_ = now_ms + proto::kTelemetryPeriodMs;  // stalled
    if (!silent && fault_ != DemoFault::TelemetryStop) {
      make_telemetry(now_ms, out[n++]);
      ++tel_frames_;
    }
  }
  if (n < max_frames && due(now_ms, next_hb_ms_)) {
    next_hb_ms_ += proto::kHeartbeatPeriodMs;
    if (due(now_ms, next_hb_ms_)) next_hb_ms_ = now_ms + proto::kHeartbeatPeriodMs;
    if (!silent && fault_ != DemoFault::HeartbeatStop) {
      make_heartbeat(out[n++]);
      ++hb_frames_;
    }
  }
  return n;
}

void EcuCore::make_telemetry(uint32_t now_ms, RawFrame& out) {
  int32_t values[proto::kFieldCount];
  for (size_t i = 0; i < proto::kFieldCount; ++i) {
    const FieldId id = static_cast<FieldId>(i);
    values[i] = owns_field(id) ? profile_value(id, now_ms) : 0;
    if (owns_field(id)) sent_[i] = values[i];
  }
  if (fault_ == DemoFault::InvalidValue) {
    // Raw patterns outside the valid range on the wire.
    if (is_motor()) {
      values[static_cast<size_t>(FieldId::Rpm)] = 0xFFFF;  // 65535 rpm > 8000
    } else {
      values[static_cast<size_t>(FieldId::SocPct)] = 0xFF;  // 255 % > 100
    }
  }

  const uint8_t counter = tel_counter_;
  if (fault_ != DemoFault::CounterFreeze) ++tel_counter_;

  if (is_motor()) {
    proto::encode_motor(values, counter, out);
  } else {
    proto::encode_battery(values, counter, out);
  }
  if (fault_ == DemoFault::BadChecksum) out.data[proto::kChecksumByte] ^= 0x5A;
  if (fault_ == DemoFault::BadDlc) out.dlc = 4;
}

void EcuCore::make_heartbeat(RawFrame& out) {
  proto::Heartbeat hb;
  hb.protocol_version =
      fault_ == DemoFault::BadVersion ? proto::kBadProtocolVersion : proto::kProtocolVersion;
  hb.node_id = node_id_;
  hb.fw_major = fw_[0];
  hb.fw_minor = fw_[1];
  hb.fw_patch = fw_[2];
  hb.can_state = can_state_;
  proto::encode_heartbeat(hb, hb_counter_++, out);
}

EcuCommandResult EcuCore::handle(const Command& cmd, uint32_t now_ms) {
  if (strcmp(cmd.verb, "set") == 0) return handle_set(cmd);
  if (strcmp(cmd.verb, "profile") == 0) return handle_profile(cmd, now_ms);
  if (strcmp(cmd.verb, "fault") == 0) return handle_fault(cmd);
  EcuCommandResult r;
  set_detail(r, AckStatus::Unsupported, "unsupported command");
  return r;
}

EcuCommandResult EcuCore::handle_set(const Command& cmd) {
  EcuCommandResult r;
  if (cmd.argc != 2) {
    set_detail(r, AckStatus::Rejected, "usage: set <param> <value>");
    return r;
  }
  const proto::CommandParam* param = nullptr;
  for (size_t i = 0; i < proto::kCommandParamCount; ++i) {
    const proto::CommandParam& p = proto::kCommandParams[i];
    if (p.node_id == node_id_ && strcmp(p.param, cmd.args[0]) == 0) param = &p;
  }
  if (param == nullptr) {
    snprintf(r.detail, sizeof(r.detail), "unknown parameter '%s' (use %s)", cmd.args[0],
             is_motor() ? "rpm|temp" : "voltage|current|soc");
    r.status = AckStatus::Rejected;
    return r;
  }
  const proto::FieldInfo& f = proto::field_info(param->field);
  int32_t raw = 0;
  const proto::NumberParse np = proto::parse_scaled(cmd.args[1], f.decimals, raw);
  if (np != proto::NumberParse::Ok) {
    snprintf(r.detail, sizeof(r.detail), "%s: %s (max %u decimals)", param->param,
             proto::number_parse_name(np), static_cast<unsigned>(f.decimals));
    r.status = AckStatus::Rejected;
    return r;
  }
  if (raw < f.min || raw > f.max) {
    char lo[16];
    char hi[16];
    proto::format_scaled(f.min, f.decimals, lo, sizeof(lo));
    proto::format_scaled(f.max, f.decimals, hi, sizeof(hi));
    snprintf(r.detail, sizeof(r.detail), "%s out of range %s..%s %s", param->param, lo, hi, f.unit);
    r.status = AckStatus::Rejected;
    return r;
  }
  setpoint_[static_cast<size_t>(param->field)] = raw;
  char text[16];
  proto::format_scaled(raw, f.decimals, text, sizeof(text));
  snprintf(r.detail, sizeof(r.detail), "%s=%s", f.key, text);
  r.status = AckStatus::Ok;
  return r;
}

EcuCommandResult EcuCore::handle_profile(const Command& cmd, uint32_t now_ms) {
  EcuCommandResult r;
  if (cmd.argc != 1) {
    set_detail(r, AckStatus::Rejected, "usage: profile static|drive");
    return r;
  }
  if (strcmp(cmd.args[0], "static") == 0) {
    profile_ = EcuProfile::Static;
  } else if (strcmp(cmd.args[0], "drive") == 0) {
    profile_ = EcuProfile::Drive;
    profile_start_ms_ = now_ms;
  } else {
    set_detail(r, AckStatus::Rejected, "unknown profile (use static|drive)");
    return r;
  }
  snprintf(r.detail, sizeof(r.detail), "profile=%s", ecu_profile_name(profile_));
  r.status = AckStatus::Ok;
  return r;
}

EcuCommandResult EcuCore::handle_fault(const Command& cmd) {
  EcuCommandResult r;
  if (cmd.argc != 1) {
    set_detail(r, AckStatus::Rejected, "usage: fault <name>|clear");
    return r;
  }
  DemoFault f = DemoFault::None;
  if (strcmp(cmd.args[0], "clear") == 0) {
    f = DemoFault::None;
  } else if (!proto::parse_demo_fault(cmd.args[0], f) || f == DemoFault::None) {
    snprintf(r.detail, sizeof(r.detail), "unknown demo fault '%s'", cmd.args[0]);
    r.status = AckStatus::Rejected;
    return r;
  }
  fault_ = f;
  snprintf(r.detail, sizeof(r.detail), "demoFault=%s", proto::demo_fault_name(fault_));
  r.status = AckStatus::Ok;
  return r;
}

size_t encode_ecu_state(const EcuCore& core, const char* node, const char* role, const char* boot_id,
                        uint64_t device_time_us, const EcuTxStats& tx, char* out, size_t out_len) {
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "ecu_state");
  w.field_string("sourceNode", node ? node : "unknown");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("bootId", boot_id ? boot_id : "");
  w.field_string("role", role ? role : "unknown");
  w.field_bool("canRunning", tx.can_running);
  w.field_string("busState", tx.bus_state ? tx.bus_state : "unknown");
  w.field_string("profile", ecu_profile_name(core.profile()));
  w.field_string("demoFault", proto::demo_fault_name(core.demo_fault()));
  w.field_object("setpoint");
  for (size_t i = 0; i < proto::kFieldCount; ++i) {
    const proto::FieldInfo& f = proto::kFields[i];
    if (core.owns_field(f.id)) w.field_scaled(f.key, core.setpoint(f.id), f.decimals);
  }
  w.end_object();
  w.field_object("sent");
  for (size_t i = 0; i < proto::kFieldCount; ++i) {
    const proto::FieldInfo& f = proto::kFields[i];
    if (core.owns_field(f.id)) w.field_scaled(f.key, core.sent_value(f.id), f.decimals);
  }
  w.end_object();
  w.field_u64("telemetryFrames", core.telemetry_frames());
  w.field_u64("heartbeatFrames", core.heartbeat_frames());
  w.field_u64("txOk", tx.tx_ok);
  w.field_u64("txFailed", tx.tx_failed);
  w.field_u64("rxIgnored", tx.rx_ignored);
  w.end_object();
  return w.finish();
}

}  // namespace canscope
