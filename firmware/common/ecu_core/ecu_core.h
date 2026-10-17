// CANScope ECU application core shared by Node 1 (motor) and Node 2 (battery).
//
// Owns the configurable sensor values, the periodic telemetry/heartbeat
// schedule, demonstration fault injection and the validated command set.
// Portable C++11 with an explicit millisecond clock, so it is unit-tested on
// the host (test/firmware_host/test_ecu_core.cpp). The ESP32 glue that moves
// frames to TWAI and lines to USB serial lives in ecu_runtime.
//
// The ECU never announces an injected fault on CAN. Each demo fault only
// changes what is transmitted; the monitor has to detect it from the bus.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "can_protocol.h"
#include "raw_frame.h"
#include "serial_link.h"

namespace canscope {

enum class EcuProfile : uint8_t { Static, Drive };

struct EcuCommandResult {
  AckStatus status;
  char detail[72];
};

class EcuCore {
 public:
  // node_id must be proto::kNodeIdNode1 (motor) or kNodeIdNode2 (battery).
  EcuCore(uint8_t node_id, uint8_t fw_major, uint8_t fw_minor, uint8_t fw_patch);

  // Starts the schedule: first telemetry and heartbeat are due at now_ms.
  void begin(uint32_t now_ms);

  // Writes the frames due at now_ms (0..2) into out; returns the count.
  // Does not burst after a stall: a late period is sent once and re-anchored.
  size_t poll(uint32_t now_ms, RawFrame* out, size_t max_frames);

  // Own CAN controller state for heartbeat byte 5 (0..2).
  void set_can_state(uint8_t state) { can_state_ = state > 2 ? 2 : state; }

  // Handles "set", "profile" and "fault". Any other verb -> Unsupported.
  EcuCommandResult handle(const Command& cmd, uint32_t now_ms);

  uint8_t node_id() const { return node_id_; }
  bool is_motor() const { return node_id_ == proto::kNodeIdNode1; }
  int32_t setpoint(proto::FieldId id) const { return setpoint_[static_cast<size_t>(id)]; }
  // Value placed in the last telemetry frame (before any fault injection).
  int32_t sent_value(proto::FieldId id) const { return sent_[static_cast<size_t>(id)]; }
  proto::DemoFault demo_fault() const { return fault_; }
  EcuProfile profile() const { return profile_; }
  uint8_t telemetry_counter() const { return tel_counter_; }
  uint8_t heartbeat_counter() const { return hb_counter_; }
  uint32_t telemetry_frames() const { return tel_frames_; }
  uint32_t heartbeat_frames() const { return hb_frames_; }
  bool owns_field(proto::FieldId id) const;

  // Value the profile generates at now_ms (clamped to the valid range).
  int32_t profile_value(proto::FieldId id, uint32_t now_ms) const;

  // Space-separated verbs this core handles (for "hello").
  static const char* verbs() { return "set profile fault"; }

 private:
  void make_telemetry(uint32_t now_ms, RawFrame& out);
  void make_heartbeat(RawFrame& out);
  EcuCommandResult handle_set(const Command& cmd);
  EcuCommandResult handle_profile(const Command& cmd, uint32_t now_ms);
  EcuCommandResult handle_fault(const Command& cmd);

  uint8_t node_id_;
  uint8_t fw_[3];
  uint8_t can_state_;
  int32_t setpoint_[proto::kFieldCount];
  int32_t sent_[proto::kFieldCount];
  EcuProfile profile_;
  uint32_t profile_start_ms_;
  proto::DemoFault fault_;
  uint32_t next_tel_ms_;
  uint32_t next_hb_ms_;
  uint8_t tel_counter_;
  uint8_t hb_counter_;
  uint32_t tel_frames_;
  uint32_t hb_frames_;
};

const char* ecu_profile_name(EcuProfile profile);

// Transmit-side counters kept by the ESP32 runtime (not by the core).
struct EcuTxStats {
  bool can_running;
  const char* bus_state;  // bus_state_name() of the ECU's own controller
  uint32_t tx_ok;
  uint32_t tx_failed;     // driver refused/timeout (e.g. TX queue full: no ACK on the bus)
  uint32_t rx_ignored;    // frames from other nodes, drained and discarded
};

// "ecu_state" line: what this ECU was commanded to do and what it put on the
// bus, as reported by the ECU itself over its own USB port. This is NOT
// evidence that the monitor received anything.
size_t encode_ecu_state(const EcuCore& core, const char* node, const char* role, const char* boot_id,
                        uint64_t device_time_us, const EcuTxStats& tx, char* out, size_t out_len);

}  // namespace canscope
