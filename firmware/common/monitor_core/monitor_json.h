// Serial JSON lines emitted by the Node 3 monitor (device -> dashboard).
// Shapes are documented in docs/protocol/canscope-protocol-v1.md and parsed by
// dashboard/src/lib/serial-line-parser.ts. Portable C++11.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "monitor_core.h"
#include "raw_frame.h"

namespace canscope {

static const size_t kMaxSnapshotFaults = 10;

// "frame" event: the raw-frame fields of encode_frame_json() plus the
// monitor's verdict: "kind", "check", "accepted".
size_t encode_monitor_frame(const RawFrame& frame, const FrameVerdict& verdict, char* out,
                            size_t out_len);

// "telemetry": last accepted values of one ECU, decoded to physical units.
size_t encode_telemetry(const MonitorCore& core, uint8_t node_id, uint32_t now_ms,
                        uint64_t device_time_us, char* out, size_t out_len);

// "node_health": heartbeat/telemetry link state, ages, versions and counters.
size_t encode_node_health(const MonitorCore& core, uint8_t node_id, uint32_t now_ms,
                          uint64_t device_time_us, char* out, size_t out_len);

// "fault": one raise ("active") or recovery ("cleared") event.
size_t encode_fault_event(const FaultEvent& event, const char* boot_id, uint64_t device_time_us,
                          char* out, size_t out_len);

// "faults": snapshot of all active faults (at most kMaxSnapshotFaults listed;
// "count" is the true total and "truncated" says if any were left out).
size_t encode_fault_snapshot(const MonitorCore& core, const char* boot_id, uint32_t now_ms,
                             uint64_t device_time_us, char* out, size_t out_len);

}  // namespace canscope
