#include "monitor_core.h"

#include <stdio.h>
#include <string.h>

namespace canscope {

using proto::FaultCode;
using proto::FieldId;
using proto::FrameCheck;
using proto::FrameKind;

namespace {

// Wrap-safe "a is later than b" for a 32-bit millisecond clock.
bool later(uint32_t a, uint32_t b) { return static_cast<int32_t>(a - b) > 0; }

size_t slot_index(uint8_t node_id) {
  if (node_id == proto::kNodeIdNode1) return 1;
  if (node_id == proto::kNodeIdNode2) return 2;
  return kMonitorSlot;
}

size_t integrity_index(FaultCode code) {
  switch (code) {
    case FaultCode::InvalidDlc: return 0;
    case FaultCode::ChecksumError: return 1;
    default: return 2;  // ValueInvalid
  }
}

const FaultCode kIntegrityCodes[] = {FaultCode::InvalidDlc, FaultCode::ChecksumError,
                                     FaultCode::ValueInvalid};

void format_value(FieldId id, int32_t raw, char* out, size_t len) {
  const proto::FieldInfo& f = proto::field_info(id);
  char num[16];
  proto::format_scaled(raw, f.decimals, num, sizeof(num));
  snprintf(out, len, "%s %s", num, f.unit);
}

bool threshold_raise(const proto::ThresholdDef& th, int32_t v) {
  switch (th.compare) {
    case proto::Compare::Ge: return v >= th.raise;
    case proto::Compare::Le: return v <= th.raise;
    case proto::Compare::AbsGe: return (v < 0 ? -v : v) >= th.raise;
  }
  return false;
}

bool threshold_clear(const proto::ThresholdDef& th, int32_t v) {
  switch (th.compare) {
    case proto::Compare::Ge: return v < th.clear;
    case proto::Compare::Le: return v > th.clear;
    case proto::Compare::AbsGe: return (v < 0 ? -v : v) < th.clear;
  }
  return true;
}

const char* compare_text(proto::Compare c) {
  switch (c) {
    case proto::Compare::Ge: return ">=";
    case proto::Compare::Le: return "<=";
    case proto::Compare::AbsGe: return "|x| >=";
  }
  return "?";
}

}  // namespace

const char* link_state_name(LinkState state) {
  switch (state) {
    case LinkState::Unknown: return "unknown";
    case LinkState::Waiting: return "waiting";
    case LinkState::Ok: return "ok";
    case LinkState::Lost: return "lost";
  }
  return "unknown";
}

MonitorCore::MonitorCore() : sink_(nullptr), sink_ctx_(nullptr) { begin(0); }

void MonitorCore::begin(uint32_t now_ms) {
  memset(slots_, 0, sizeof(slots_));
  memset(ecus_, 0, sizeof(ecus_));
  ecus_[0].node_id = proto::kNodeIdNode1;
  ecus_[1].node_id = proto::kNodeIdNode2;
  for (size_t i = 0; i < 2; ++i) ecus_[i].version_ok = true;
  event_id_ = 0;
  last_critical_raise_id_ = 0;
  monitoring_ = false;
  controller_seen_ = false;
  watch_since_ms_ = now_ms;
  any_frame_fresh_ = false;
  last_any_frame_ms_ = now_ms;
  total_frames_ = 0;
  unknown_frames_ = 0;
  last_rx_missed_ = 0;
  last_overrun_ms_ = now_ms;
}

EcuTrack& MonitorCore::track(uint8_t node_id) {
  return ecus_[node_id == proto::kNodeIdNode2 ? 1 : 0];
}

const EcuTrack& MonitorCore::ecu(uint8_t node_id) const {
  return ecus_[node_id == proto::kNodeIdNode2 ? 1 : 0];
}

bool MonitorCore::active(FaultCode code, uint8_t node_id) const {
  return slot(code, node_id).active;
}

const FaultSlot& MonitorCore::slot(FaultCode code, uint8_t node_id) const {
  return slots_[static_cast<size_t>(code)][slot_index(node_id)];
}

size_t MonitorCore::active_count() const {
  size_t n = 0;
  for (size_t c = 0; c < proto::kFaultCount; ++c) {
    for (size_t s = 0; s < kSlotCount; ++s) n += slots_[c][s].active ? 1 : 0;
  }
  return n;
}

bool MonitorCore::worst_active(proto::Severity& out) const {
  bool any = false;
  for (size_t c = 0; c < proto::kFaultCount; ++c) {
    for (size_t s = 0; s < kSlotCount; ++s) {
      if (!slots_[c][s].active) continue;
      const proto::Severity sev = proto::kFaults[c].severity;
      if (!any || static_cast<uint8_t>(sev) > static_cast<uint8_t>(out)) out = sev;
      any = true;
    }
  }
  return any;
}

void MonitorCore::raise(FaultCode code, uint8_t node_id, uint32_t now_ms, const char* detail) {
  FaultSlot& s = slots_[static_cast<size_t>(code)][slot_index(node_id)];
  if (s.active) return;
  s.active = true;
  s.since_ms = now_ms;
  snprintf(s.detail, sizeof(s.detail), "%s", detail ? detail : "");
  ++event_id_;
  if (proto::fault_info(code).severity == proto::Severity::Critical) last_critical_raise_id_ = event_id_;
  if (sink_) {
    FaultEvent e = {event_id_, code, node_id, true, now_ms, s.detail};
    sink_(e, sink_ctx_);
  }
}

void MonitorCore::clear(FaultCode code, uint8_t node_id, uint32_t now_ms, const char* detail) {
  FaultSlot& s = slots_[static_cast<size_t>(code)][slot_index(node_id)];
  if (!s.active) return;
  s.active = false;
  snprintf(s.detail, sizeof(s.detail), "%s", detail ? detail : "");
  ++event_id_;
  if (sink_) {
    FaultEvent e = {event_id_, code, node_id, false, now_ms, s.detail};
    sink_(e, sink_ctx_);
  }
}

void MonitorCore::start_watch(uint32_t now_ms) {
  watch_since_ms_ = now_ms;
  any_frame_fresh_ = false;
  for (size_t i = 0; i < 2; ++i) {
    ecus_[i].hb_fresh = false;
    ecus_[i].tel_fresh = false;
  }
}

void MonitorCore::on_controller(const ControllerSnapshot& snap, uint32_t now_ms) {
  const bool bus_off = snap.state == BusState::BusOff || snap.state == BusState::Recovering;
  const bool running = snap.driver_running && !bus_off;
  const uint8_t m = proto::kNodeIdMonitor;

  if (bus_off) {
    raise(FaultCode::MonitorBusOff, m, now_ms,
          "monitor controller bus-off; node timeouts suspended (send 'recover')");
  } else {
    clear(FaultCode::MonitorBusOff, m, now_ms, "controller left bus-off");
  }
  if (!snap.driver_running && !bus_off) {
    raise(FaultCode::MonitorCanNotRunning, m, now_ms, "monitor CAN controller not running");
  } else {
    clear(FaultCode::MonitorCanNotRunning, m, now_ms, "controller running");
  }
  if (snap.state == BusState::ErrorPassive) {
    char d[kFaultDetailLen];
    snprintf(d, sizeof(d), "TEC %lu REC %lu", static_cast<unsigned long>(snap.tx_error_counter),
             static_cast<unsigned long>(snap.rx_error_counter));
    raise(FaultCode::MonitorErrorPassive, m, now_ms, d);
  } else if (!bus_off) {
    clear(FaultCode::MonitorErrorPassive, m, now_ms, "error counters below 128");
  }
  if (controller_seen_ && snap.rx_missed > last_rx_missed_) {
    char d[kFaultDetailLen];
    snprintf(d, sizeof(d), "%lu frames lost (total %lu)",
             static_cast<unsigned long>(snap.rx_missed - last_rx_missed_),
             static_cast<unsigned long>(snap.rx_missed));
    last_overrun_ms_ = now_ms;
    raise(FaultCode::MonitorRxOverrun, m, now_ms, d);
  }
  last_rx_missed_ = snap.rx_missed;
  controller_seen_ = true;

  if (running && !monitoring_) start_watch(now_ms);
  monitoring_ = running;
}

FrameVerdict MonitorCore::on_frame(const RawFrame& frame, uint32_t now_ms) {
  FrameVerdict v;
  v.decoded = proto::decode(frame);
  v.accepted = false;
  v.reason = proto::frame_check_name(v.decoded.check);

  ++total_frames_;
  last_any_frame_ms_ = now_ms;
  any_frame_fresh_ = true;
  clear(FaultCode::BusSilent, proto::kNodeIdMonitor, now_ms, "bus traffic received");

  const proto::DecodedFrame& d = v.decoded;
  if (d.check == FrameCheck::UnsupportedId || d.check == FrameCheck::ExtendedId) {
    ++unknown_frames_;
    return v;
  }

  EcuTrack& t = track(d.node_id);
  char detail[kFaultDetailLen];
  switch (d.check) {
    case FrameCheck::Remote:
    case FrameCheck::BadDlc:
      ++t.stats.dlc_errors;
      ++t.stats.rejected_frames;
      if (d.check == FrameCheck::Remote) {
        snprintf(detail, sizeof(detail), "0x%03lX remote frame", static_cast<unsigned long>(frame.can_id));
      } else {
        snprintf(detail, sizeof(detail), "0x%03lX DLC %u, expected 8",
                 static_cast<unsigned long>(frame.can_id), static_cast<unsigned>(frame.dlc));
      }
      integrity_error(t, FaultCode::InvalidDlc, now_ms, detail);
      return v;
    case FrameCheck::BadChecksum:
      ++t.stats.checksum_errors;
      ++t.stats.rejected_frames;
      snprintf(detail, sizeof(detail), "0x%03lX checksum 0x%02X, expected 0x%02X",
               static_cast<unsigned long>(frame.can_id), frame.data[proto::kChecksumByte],
               proto::compute_checksum(frame.can_id, frame.data));
      integrity_error(t, FaultCode::ChecksumError, now_ms, detail);
      return v;
    case FrameCheck::BadNodeId:
      ++t.stats.range_errors;
      ++t.stats.rejected_frames;
      snprintf(detail, sizeof(detail), "heartbeat 0x%03lX carries node id %u",
               static_cast<unsigned long>(frame.can_id), d.heartbeat.node_id);
      integrity_error(t, FaultCode::ValueInvalid, now_ms, detail);
      return v;
    case FrameCheck::ValueOutOfRange:
      ++t.stats.range_errors;
      ++t.stats.rejected_frames;
      if (d.kind == FrameKind::Heartbeat) {
        snprintf(detail, sizeof(detail), "heartbeat canState %u outside 0..%u", d.heartbeat.can_state,
                 static_cast<unsigned>(proto::kCanStateMax));
      } else {
        const proto::FieldInfo& f = proto::field_info(d.bad_field);
        snprintf(detail, sizeof(detail), "%s raw %ld outside %ld..%ld", f.key,
                 static_cast<long>(d.values[static_cast<size_t>(d.bad_field)]),
                 static_cast<long>(f.min), static_cast<long>(f.max));
      }
      integrity_error(t, FaultCode::ValueInvalid, now_ms, detail);
      return v;
    case FrameCheck::UnsupportedVersion:
      // The node is alive but speaks another protocol version: liveness yes,
      // data no. Its telemetry is rejected until a v1 heartbeat arrives.
      ++t.stats.version_rejects;
      t.hb_seen = t.hb_fresh = true;
      t.last_hb_ms = now_ms;
      t.heartbeat = d.heartbeat;
      t.version_ok = false;
      snprintf(detail, sizeof(detail), "protocol version %u, supported %u", d.heartbeat.protocol_version,
               static_cast<unsigned>(proto::kProtocolVersion));
      raise(FaultCode::ProtocolVersionMismatch, t.node_id, now_ms, detail);
      clear(FaultCode::HeartbeatLost, t.node_id, now_ms, "heartbeat received (unsupported version)");
      v.reason = "heartbeat_unsupported_version";
      return v;
    case FrameCheck::Ok:
    case FrameCheck::UnsupportedId:
    case FrameCheck::ExtendedId:
      break;
  }

  if (d.kind == FrameKind::Heartbeat) {
    ++t.stats.heartbeat_frames;
    t.hb_seen = t.hb_fresh = true;
    t.last_hb_ms = now_ms;
    t.heartbeat = d.heartbeat;
    t.version_ok = true;
    clear(FaultCode::ProtocolVersionMismatch, t.node_id, now_ms, "protocol version 1 heartbeat");
    clear(FaultCode::HeartbeatLost, t.node_id, now_ms, "heartbeat received");
    if (d.heartbeat.can_state >= 2) {
      raise(FaultCode::EcuCanErrorPassive, t.node_id, now_ms, "ECU reports its controller error passive");
    } else {
      clear(FaultCode::EcuCanErrorPassive, t.node_id, now_ms, "ECU reports error active/warning");
    }
    integrity_good(t, now_ms);
    v.accepted = true;
    return v;
  }

  if (!t.version_ok) {
    ++t.stats.version_rejects;
    ++t.stats.rejected_frames;
    v.reason = "rejected_protocol_version";
    return v;
  }
  accept_telemetry(t, d, now_ms);
  integrity_good(t, now_ms);
  v.accepted = true;
  return v;
}

void MonitorCore::accept_telemetry(EcuTrack& t, const proto::DecodedFrame& d, uint32_t now_ms) {
  ++t.stats.telemetry_frames;
  if (t.counter_init) {
    if (d.counter == t.last_counter) {
      ++t.stats.counter_repeats;
      t.good_run = 0;
      if (t.repeat_run < 255) ++t.repeat_run;
      if (t.repeat_run + 1u >= proto::kCounterFrozenFrames) {
        char detail[kFaultDetailLen];
        snprintf(detail, sizeof(detail), "counter stuck at %u for %u frames", d.counter,
                 static_cast<unsigned>(t.repeat_run + 1u));
        raise(FaultCode::CounterFrozen, t.node_id, now_ms, detail);
      }
    } else {
      if (d.counter != static_cast<uint8_t>(t.last_counter + 1)) ++t.stats.sequence_gaps;
      t.repeat_run = 0;
      if (t.good_run < 255) ++t.good_run;
      if (t.good_run >= proto::kCounterFrozenFrames) {
        clear(FaultCode::CounterFrozen, t.node_id, now_ms, "counter incrementing again");
      }
    }
  }
  t.counter_init = true;
  t.last_counter = d.counter;

  t.tel_seen = t.tel_fresh = true;
  t.last_tel_ms = now_ms;
  t.last_tel_counter = d.counter;
  for (size_t i = 0; i < proto::kFieldCount; ++i) {
    if (proto::kFields[i].node_id == t.node_id) t.values[i] = d.values[i];
  }
  clear(FaultCode::TelemetryStale, t.node_id, now_ms, "telemetry received");
  evaluate_thresholds(t, now_ms);
}

void MonitorCore::evaluate_thresholds(EcuTrack& t, uint32_t now_ms) {
  for (size_t i = 0; i < proto::kThresholdCount; ++i) {
    const proto::ThresholdDef& th = proto::kThresholds[i];
    if (th.node_id != t.node_id) continue;
    const int32_t v = t.values[static_cast<size_t>(th.field)];
    char value_text[24];
    char limit_text[24];
    char detail[kFaultDetailLen];
    format_value(th.field, v, value_text, sizeof(value_text));
    if (!active(th.fault, t.node_id)) {
      t.th_clear[i] = 0;
      if (!threshold_raise(th, v)) {
        t.th_raise[i] = 0;
        continue;
      }
      if (t.th_raise[i] < 255) ++t.th_raise[i];
      if (t.th_raise[i] >= proto::kThresholdRaiseFrames) {
        format_value(th.field, th.raise, limit_text, sizeof(limit_text));
        snprintf(detail, sizeof(detail), "%s = %s (%s %s)", proto::field_info(th.field).key, value_text,
                 compare_text(th.compare), limit_text);
        raise(th.fault, t.node_id, now_ms, detail);
        t.th_raise[i] = 0;
      }
    } else {
      t.th_raise[i] = 0;
      if (!threshold_clear(th, v)) {
        t.th_clear[i] = 0;
        continue;
      }
      if (t.th_clear[i] < 255) ++t.th_clear[i];
      if (t.th_clear[i] >= proto::kThresholdClearFrames) {
        format_value(th.field, th.clear, limit_text, sizeof(limit_text));
        snprintf(detail, sizeof(detail), "%s = %s (back past %s)", proto::field_info(th.field).key,
                 value_text, limit_text);
        clear(th.fault, t.node_id, now_ms, detail);
        t.th_clear[i] = 0;
      }
    }
  }
}

void MonitorCore::integrity_error(EcuTrack& t, FaultCode code, uint32_t now_ms, const char* detail) {
  t.last_integrity_ms[integrity_index(code)] = now_ms;
  raise(code, t.node_id, now_ms, detail);
}

void MonitorCore::integrity_good(EcuTrack& t, uint32_t now_ms) {
  for (size_t i = 0; i < 3; ++i) {
    const FaultCode code = kIntegrityCodes[i];
    if (!active(code, t.node_id)) continue;
    if (now_ms - t.last_integrity_ms[i] >= proto::kIntegrityClearMs) {
      clear(code, t.node_id, now_ms, "only valid frames for the clear period");
    }
  }
}

void MonitorCore::check_timeouts(EcuTrack& t, uint32_t now_ms) {
  char detail[kFaultDetailLen];
  // Heartbeat
  if (!active(FaultCode::HeartbeatLost, t.node_id)) {
    if (t.hb_fresh) {
      const uint32_t ref = later(t.last_hb_ms, watch_since_ms_) ? t.last_hb_ms : watch_since_ms_;
      const uint32_t age = now_ms - ref;
      if (age > proto::kHeartbeatTimeoutMs) {
        if (t.heartbeat.can_state >= 2) {
          snprintf(detail, sizeof(detail), "no heartbeat for %lu ms; ECU was error passive (bus-off?)",
                   static_cast<unsigned long>(age));
        } else {
          snprintf(detail, sizeof(detail), "no heartbeat for %lu ms", static_cast<unsigned long>(age));
        }
        raise(FaultCode::HeartbeatLost, t.node_id, now_ms, detail);
      }
    } else if (now_ms - watch_since_ms_ > proto::kStartupGraceMs) {
      raise(FaultCode::HeartbeatLost, t.node_id, now_ms, "no heartbeat since monitoring started");
    }
  }
  // Telemetry
  if (!active(FaultCode::TelemetryStale, t.node_id)) {
    if (t.tel_fresh) {
      const uint32_t ref = later(t.last_tel_ms, watch_since_ms_) ? t.last_tel_ms : watch_since_ms_;
      const uint32_t age = now_ms - ref;
      if (age > proto::kTelemetryTimeoutMs) {
        snprintf(detail, sizeof(detail), "no valid telemetry for %lu ms", static_cast<unsigned long>(age));
        raise(FaultCode::TelemetryStale, t.node_id, now_ms, detail);
      }
    } else if (now_ms - watch_since_ms_ > proto::kStartupGraceMs) {
      raise(FaultCode::TelemetryStale, t.node_id, now_ms, "no valid telemetry since monitoring started");
    }
  }
}

void MonitorCore::tick(uint32_t now_ms) {
  if (active(FaultCode::MonitorRxOverrun, proto::kNodeIdMonitor) &&
      now_ms - last_overrun_ms_ >= proto::kRxOverrunClearMs) {
    clear(FaultCode::MonitorRxOverrun, proto::kNodeIdMonitor, now_ms, "no further RX overruns");
  }
  if (!monitoring_) return;  // own controller down: say nothing about the nodes

  for (size_t i = 0; i < 2; ++i) check_timeouts(ecus_[i], now_ms);

  if (!active(FaultCode::BusSilent, proto::kNodeIdMonitor)) {
    if (any_frame_fresh_) {
      const uint32_t age = now_ms - last_any_frame_ms_;
      if (age > proto::kBusSilentTimeoutMs) {
        char detail[kFaultDetailLen];
        snprintf(detail, sizeof(detail), "no frame of any kind for %lu ms", static_cast<unsigned long>(age));
        raise(FaultCode::BusSilent, proto::kNodeIdMonitor, now_ms, detail);
      }
    } else if (now_ms - watch_since_ms_ > proto::kStartupGraceMs) {
      raise(FaultCode::BusSilent, proto::kNodeIdMonitor, now_ms, "no frame received since monitoring started");
    }
  }
}

LinkState MonitorCore::heartbeat_state(uint8_t node_id) const {
  if (!monitoring_) return LinkState::Unknown;
  if (active(FaultCode::HeartbeatLost, node_id)) return LinkState::Lost;
  return ecu(node_id).hb_fresh ? LinkState::Ok : LinkState::Waiting;
}

LinkState MonitorCore::telemetry_state(uint8_t node_id) const {
  if (!monitoring_) return LinkState::Unknown;
  if (active(FaultCode::TelemetryStale, node_id)) return LinkState::Lost;
  return ecu(node_id).tel_fresh ? LinkState::Ok : LinkState::Waiting;
}

}  // namespace canscope
