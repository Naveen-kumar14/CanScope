// CANScope Node 3 monitoring core: validates every received frame, tracks
// each ECU's heartbeat and telemetry, and detects faults on its own.
//
// Inputs are only what the monitor observes: received CAN frames (with the
// time they were read) and its own CAN controller state. Dashboard commands
// sent to an ECU are never an input, so a "commanded" fault shows up here
// only if it actually changes the traffic on the bus.
//
// Portable C++11 with an explicit millisecond clock (wrap-safe), unit-tested on
// the host with fixed timestamps (test/firmware_host/test_monitor_core.cpp).
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "can_protocol.h"
#include "raw_frame.h"

namespace canscope {

// Fault slots are per (code, node). Node index 0 is the monitor itself.
static const uint8_t kMonitorSlot = 0;
static const uint8_t kSlotCount = 3;  // monitor, node1, node2
static const size_t kFaultDetailLen = 72;

struct ControllerSnapshot {
  bool driver_running;
  BusState state;
  uint32_t rx_missed;  // cumulative
  uint32_t tx_error_counter;
  uint32_t rx_error_counter;
};

struct FaultSlot {
  bool active;
  uint32_t since_ms;
  char detail[kFaultDetailLen];
};

struct FaultEvent {
  uint32_t event_id;  // increments on every raise and clear, per boot
  proto::FaultCode code;
  uint8_t node_id;    // proto::kNodeIdMonitor for monitor-scope faults
  bool active;        // true = raised, false = cleared (recovered)
  uint32_t at_ms;
  const char* detail;
};

typedef void (*FaultSink)(const FaultEvent& event, void* ctx);

enum class LinkState : uint8_t {
  Unknown,  // monitor CAN not running / bus-off: nothing can be said about the node
  Waiting,  // monitoring, not seen yet, still inside the start-up grace period
  Ok,
  Lost,     // timed out (heartbeat) / stale (telemetry)
};
const char* link_state_name(LinkState state);

struct EcuStats {
  uint32_t heartbeat_frames;
  uint32_t telemetry_frames;
  uint32_t rejected_frames;
  uint32_t dlc_errors;
  uint32_t checksum_errors;
  uint32_t range_errors;
  uint32_t version_rejects;
  uint32_t counter_repeats;
  uint32_t sequence_gaps;
};

struct EcuTrack {
  uint8_t node_id;
  bool hb_seen;     // ever, this boot
  bool hb_fresh;    // since the current monitoring period started
  uint32_t last_hb_ms;
  proto::Heartbeat heartbeat;  // last heartbeat with a valid layout
  bool version_ok;
  bool tel_seen;
  bool tel_fresh;
  uint32_t last_tel_ms;
  uint8_t last_tel_counter;
  int32_t values[proto::kFieldCount];  // last accepted raw values
  bool counter_init;
  uint8_t last_counter;
  uint8_t repeat_run;
  uint8_t good_run;
  uint32_t last_integrity_ms[3];  // INVALID_DLC, CHECKSUM_ERROR, VALUE_INVALID
  uint8_t th_raise[proto::kThresholdCount];
  uint8_t th_clear[proto::kThresholdCount];
  EcuStats stats;
};

// What happened to one received frame (for the serial "frame" event).
struct FrameVerdict {
  proto::DecodedFrame decoded;
  bool accepted;      // values/liveness were taken from this frame
  const char* reason; // "ok" or why it was rejected/ignored
};

class MonitorCore {
 public:
  MonitorCore();

  void begin(uint32_t now_ms);
  void set_sink(FaultSink sink, void* ctx) {
    sink_ = sink;
    sink_ctx_ = ctx;
  }

  FrameVerdict on_frame(const RawFrame& frame, uint32_t now_ms);
  void on_controller(const ControllerSnapshot& snap, uint32_t now_ms);
  void tick(uint32_t now_ms);

  bool monitoring() const { return monitoring_; }
  bool active(proto::FaultCode code, uint8_t node_id) const;
  const FaultSlot& slot(proto::FaultCode code, uint8_t node_id) const;
  size_t active_count() const;
  // Worst active severity; false if nothing is active.
  bool worst_active(proto::Severity& out) const;
  bool new_critical_since(uint32_t event_id) const { return last_critical_raise_id_ > event_id; }
  uint32_t last_event_id() const { return event_id_; }
  uint32_t last_critical_raise_id() const { return last_critical_raise_id_; }

  const EcuTrack& ecu(uint8_t node_id) const;  // node 1 or 2
  LinkState heartbeat_state(uint8_t node_id) const;
  LinkState telemetry_state(uint8_t node_id) const;
  uint32_t total_frames() const { return total_frames_; }
  uint32_t unknown_frames() const { return unknown_frames_; }
  bool any_frame_since_start() const { return any_frame_fresh_; }

 private:
  EcuTrack& track(uint8_t node_id);
  void raise(proto::FaultCode code, uint8_t node_id, uint32_t now_ms, const char* detail);
  void clear(proto::FaultCode code, uint8_t node_id, uint32_t now_ms, const char* detail);
  void integrity_error(EcuTrack& t, proto::FaultCode code, uint32_t now_ms, const char* detail);
  void integrity_good(EcuTrack& t, uint32_t now_ms);
  void accept_telemetry(EcuTrack& t, const proto::DecodedFrame& d, uint32_t now_ms);
  void evaluate_thresholds(EcuTrack& t, uint32_t now_ms);
  void start_watch(uint32_t now_ms);
  void check_timeouts(EcuTrack& t, uint32_t now_ms);

  FaultSlot slots_[proto::kFaultCount][kSlotCount];
  EcuTrack ecus_[2];
  FaultSink sink_;
  void* sink_ctx_;
  uint32_t event_id_;
  uint32_t last_critical_raise_id_;
  bool monitoring_;
  bool controller_seen_;
  uint32_t watch_since_ms_;
  bool any_frame_fresh_;
  uint32_t last_any_frame_ms_;
  uint32_t total_frames_;
  uint32_t unknown_frames_;
  uint32_t last_rx_missed_;
  uint32_t last_overrun_ms_;
};

}  // namespace canscope
