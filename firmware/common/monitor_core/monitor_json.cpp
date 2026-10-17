#include "monitor_json.h"

#include <stdio.h>

#include "json_writer.h"

namespace canscope {

using proto::FaultCode;

namespace {

void write_frame_fields(JsonWriter& w, const RawFrame& frame) {
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
}

void age_field(JsonWriter& w, const char* name, bool seen, uint32_t now_ms, uint32_t at_ms) {
  w.key(name);
  if (seen) {
    w.u64(now_ms - at_ms);
  } else {
    w.raw("null");
  }
}

}  // namespace

size_t encode_monitor_frame(const RawFrame& frame, const FrameVerdict& verdict, char* out,
                            size_t out_len) {
  if (!frame_is_valid(frame)) return 0;
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "frame");
  write_frame_fields(w, frame);
  w.field_string("kind", proto::frame_kind_name(verdict.decoded.kind));
  w.field_string("check", verdict.reason);
  w.field_bool("accepted", verdict.accepted);
  w.end_object();
  return w.finish();
}

size_t encode_telemetry(const MonitorCore& core, uint8_t node_id, uint32_t now_ms,
                        uint64_t device_time_us, char* out, size_t out_len) {
  const EcuTrack& t = core.ecu(node_id);
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "telemetry");
  w.field_string("sourceNode", "monitor");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("node", proto::node_name(node_id));
  w.field_bool("valid", t.tel_seen);
  age_field(w, "ageMs", t.tel_seen, now_ms, t.last_tel_ms);
  w.field_u64("counter", t.last_tel_counter);
  w.field_string("state", link_state_name(core.telemetry_state(node_id)));
  w.field_object("values");
  if (t.tel_seen) {
    for (size_t i = 0; i < proto::kFieldCount; ++i) {
      const proto::FieldInfo& f = proto::kFields[i];
      if (f.node_id == node_id) w.field_scaled(f.key, t.values[i], f.decimals);
    }
  }
  w.end_object();
  w.end_object();
  return w.finish();
}

size_t encode_node_health(const MonitorCore& core, uint8_t node_id, uint32_t now_ms,
                          uint64_t device_time_us, char* out, size_t out_len) {
  const EcuTrack& t = core.ecu(node_id);
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "node_health");
  w.field_string("sourceNode", "monitor");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("node", proto::node_name(node_id));
  w.field_string("heartbeat", link_state_name(core.heartbeat_state(node_id)));
  w.field_string("telemetry", link_state_name(core.telemetry_state(node_id)));
  age_field(w, "heartbeatAgeMs", t.hb_seen, now_ms, t.last_hb_ms);
  age_field(w, "telemetryAgeMs", t.tel_seen, now_ms, t.last_tel_ms);
  if (t.hb_seen) {
    char fw[16];
    snprintf(fw, sizeof(fw), "%u.%u.%u", t.heartbeat.fw_major, t.heartbeat.fw_minor, t.heartbeat.fw_patch);
    w.field_u64("protocolVersion", t.heartbeat.protocol_version);
    w.field_bool("versionOk", t.version_ok);
    w.field_string("firmware", fw);
    w.field_string("ecuCanState", proto::can_state_name(t.heartbeat.can_state));
  } else {
    w.key("protocolVersion");
    w.raw("null");
    w.field_bool("versionOk", true);
    w.key("firmware");
    w.raw("null");
    w.key("ecuCanState");
    w.raw("null");
  }
  w.field_object("stats");
  w.field_u64("heartbeatFrames", t.stats.heartbeat_frames);
  w.field_u64("telemetryFrames", t.stats.telemetry_frames);
  w.field_u64("rejectedFrames", t.stats.rejected_frames);
  w.field_u64("dlcErrors", t.stats.dlc_errors);
  w.field_u64("checksumErrors", t.stats.checksum_errors);
  w.field_u64("rangeErrors", t.stats.range_errors);
  w.field_u64("versionRejects", t.stats.version_rejects);
  w.field_u64("counterRepeats", t.stats.counter_repeats);
  w.field_u64("sequenceGaps", t.stats.sequence_gaps);
  w.end_object();
  w.end_object();
  return w.finish();
}

size_t encode_fault_event(const FaultEvent& event, const char* boot_id, uint64_t device_time_us,
                          char* out, size_t out_len) {
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "fault");
  w.field_string("sourceNode", "monitor");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("bootId", boot_id ? boot_id : "");
  w.field_u64("eventId", event.event_id);
  w.field_string("code", proto::fault_name(event.code));
  w.field_string("node", proto::node_name(event.node_id));
  w.field_string("severity", proto::severity_name(proto::fault_info(event.code).severity));
  w.field_string("state", event.active ? "active" : "cleared");
  w.field_string("detail", event.detail ? event.detail : "");
  w.end_object();
  return w.finish();
}

size_t encode_fault_snapshot(const MonitorCore& core, const char* boot_id, uint32_t now_ms,
                             uint64_t device_time_us, char* out, size_t out_len) {
  static const uint8_t kNodes[kSlotCount] = {proto::kNodeIdMonitor, proto::kNodeIdNode1,
                                             proto::kNodeIdNode2};
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "faults");
  w.field_string("sourceNode", "monitor");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("bootId", boot_id ? boot_id : "");
  w.field_u64("lastEventId", core.last_event_id());
  w.field_u64("count", core.active_count());
  w.key("active");
  w.raw("[");
  size_t listed = 0;
  for (size_t c = 0; c < proto::kFaultCount; ++c) {
    for (size_t s = 0; s < kSlotCount; ++s) {
      const FaultCode code = static_cast<FaultCode>(c);
      const FaultSlot& slot = core.slot(code, kNodes[s]);
      if (!slot.active || listed >= kMaxSnapshotFaults) continue;
      if (listed++) w.raw(",");
      w.begin_object();
      w.field_string("code", proto::fault_name(code));
      w.field_string("node", proto::node_name(kNodes[s]));
      w.field_string("severity", proto::severity_name(proto::kFaults[c].severity));
      w.field_u64("ageMs", now_ms - slot.since_ms);
      w.field_string("detail", slot.detail);
      w.end_object();
    }
  }
  w.raw("]");
  w.field_bool("truncated", core.active_count() > listed);
  w.end_object();
  return w.finish();
}

}  // namespace canscope
