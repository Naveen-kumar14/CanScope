// Node 3 monitoring core tests with fixed timestamps (no sleeps): heartbeat
// and telemetry timeouts, start-up grace, monitor bus-off vs ECU heartbeat
// loss, frame validation faults, counters, protocol version, thresholds with
// hysteresis, recovery, and the demo-fault -> detection contract from
// protocol/canscope_protocol.json.
#include <string.h>

#include "can_protocol.h"
#include "ecu_core.h"
#include "mini_test.h"
#include "monitor_core.h"
#include "serial_link.h"

using namespace canscope;
using namespace canscope::proto;

namespace {

struct Recorded {
  FaultCode code;
  uint8_t node;
  bool active;
  uint32_t id;
};

struct Fixture {
  MonitorCore m;
  Recorded events[256];
  size_t n_events = 0;
  uint8_t ctr[3] = {0, 0, 0};
  uint8_t hbc[3] = {0, 0, 0};

  Fixture() { m.set_sink(&Fixture::sink, this); }

  static void sink(const FaultEvent& e, void* ctx) {
    Fixture* f = static_cast<Fixture*>(ctx);
    if (f->n_events < 256) f->events[f->n_events++] = {e.code, e.node_id, e.active, e.event_id};
  }

  void controller(uint32_t t, BusState state = BusState::ErrorActive, bool running = true,
                  uint32_t rx_missed = 0) {
    ControllerSnapshot s = {running, state, rx_missed, 0, 0};
    m.on_controller(s, t);
  }
  FrameVerdict motor(uint32_t t, int32_t rpm = kRpmDefault, int32_t temp = kMotorTempCDefault) {
    int32_t v[kFieldCount] = {0};
    v[static_cast<size_t>(FieldId::Rpm)] = rpm;
    v[static_cast<size_t>(FieldId::MotorTempC)] = temp;
    RawFrame f;
    encode_motor(v, ctr[1]++, f);
    return m.on_frame(f, t);
  }
  FrameVerdict battery(uint32_t t, int32_t volt = kPackVoltageVDefault, int32_t amp = kPackCurrentADefault,
                       int32_t soc = kSocPctDefault) {
    int32_t v[kFieldCount] = {0};
    v[static_cast<size_t>(FieldId::PackVoltageV)] = volt;
    v[static_cast<size_t>(FieldId::PackCurrentA)] = amp;
    v[static_cast<size_t>(FieldId::SocPct)] = soc;
    RawFrame f;
    encode_battery(v, ctr[2]++, f);
    return m.on_frame(f, t);
  }
  FrameVerdict hb(uint8_t node, uint32_t t, uint8_t version = kProtocolVersion, uint8_t can_state = 0) {
    Heartbeat h = {version, node, 1, 0, 0, can_state};
    RawFrame f;
    encode_heartbeat(h, hbc[node]++, f);
    return m.on_frame(f, t);
  }
  // Both ECUs healthy from t0 to t1 (telemetry every 100 ms, heartbeat 500 ms).
  void healthy(uint32_t t0, uint32_t t1, bool node1 = true, bool node2 = true) {
    for (uint32_t t = t0; static_cast<int32_t>(t1 - t) >= 0; t += 100) {
      if (node1) motor(t);
      if (node2) battery(t);
      if ((t - t0) % 500 == 0) {
        if (node1) hb(1, t);
        if (node2) hb(2, t);
      }
      m.tick(t);
    }
  }
  bool active(FaultCode c, uint8_t node) const { return m.active(c, node); }
  size_t raises(FaultCode c, uint8_t node) const {
    size_t n = 0;
    for (size_t i = 0; i < n_events; ++i) n += events[i].code == c && events[i].node == node && events[i].active;
    return n;
  }
};

}  // namespace

static void test_healthy_bus_has_no_faults() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 10000);
  CHECK(f.m.active_count() == 0);
  CHECK(f.n_events == 0);
  CHECK(f.m.heartbeat_state(1) == LinkState::Ok);
  CHECK(f.m.telemetry_state(2) == LinkState::Ok);
  CHECK(f.m.ecu(1).values[static_cast<size_t>(FieldId::Rpm)] == kRpmDefault);
  CHECK(f.m.ecu(2).values[static_cast<size_t>(FieldId::SocPct)] == kSocPctDefault);
  CHECK(f.m.ecu(1).stats.sequence_gaps == 0);
  CHECK(f.m.ecu(1).stats.heartbeat_frames == 21);
}

static void test_startup_grace_and_never_seen() {
  Fixture f;
  f.controller(1000);
  f.m.tick(1000 + kStartupGraceMs);
  CHECK(f.m.active_count() == 0);
  CHECK(f.m.heartbeat_state(1) == LinkState::Waiting);
  f.m.tick(1000 + kStartupGraceMs + 1);
  CHECK(f.active(FaultCode::HeartbeatLost, 1));
  CHECK(f.active(FaultCode::HeartbeatLost, 2));
  CHECK(f.active(FaultCode::TelemetryStale, 1));
  CHECK(f.active(FaultCode::BusSilent, kNodeIdMonitor));
  CHECK_STR_EQ(f.m.slot(FaultCode::HeartbeatLost, 1).detail, "no heartbeat since monitoring started");
  CHECK(f.m.heartbeat_state(1) == LinkState::Lost);

  // Only Node 1 comes up: its faults clear, Node 2's stay. BUS_SILENT clears.
  f.healthy(4000, 4600, true, false);
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  CHECK(!f.active(FaultCode::TelemetryStale, 1));
  CHECK(f.active(FaultCode::HeartbeatLost, 2));
  CHECK(!f.active(FaultCode::BusSilent, kNodeIdMonitor));
}

static void test_heartbeat_loss() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 1000);  // node1 last heartbeat at t=1000
  for (uint32_t t = 1100; t <= 2400; t += 100) {
    f.motor(t);
    f.battery(t);
    if (t % 500 == 0) f.hb(2, t);
    f.m.tick(t);
  }
  f.m.tick(1000 + kHeartbeatTimeoutMs);  // exactly at the limit: not yet
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  f.m.tick(1000 + kHeartbeatTimeoutMs + 1);
  CHECK(f.active(FaultCode::HeartbeatLost, 1));
  CHECK(!f.active(FaultCode::HeartbeatLost, 2));
  CHECK(!f.active(FaultCode::TelemetryStale, 1));  // telemetry still arriving
  CHECK_STR_EQ(f.m.slot(FaultCode::HeartbeatLost, 1).detail, "no heartbeat for 1501 ms");
  // No duplicate raise while still lost.
  f.m.tick(2600);
  CHECK(f.raises(FaultCode::HeartbeatLost, 1) == 1);
  // Recovery on the first valid heartbeat.
  f.hb(1, 9100);
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  CHECK(f.n_events == 2 && !f.events[1].active && f.events[1].id > f.events[0].id);
}

static void test_ecu_error_passive_then_lost() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 500);
  f.hb(1, 600, kProtocolVersion, 2);  // ECU reports error passive
  CHECK(f.active(FaultCode::EcuCanErrorPassive, 1));
  f.m.tick(600 + kHeartbeatTimeoutMs + 1);
  CHECK(f.active(FaultCode::HeartbeatLost, 1));
  CHECK(strstr(f.m.slot(FaultCode::HeartbeatLost, 1).detail, "bus-off?") != nullptr);
  f.hb(1, 5000, kProtocolVersion, 0);
  CHECK(!f.active(FaultCode::EcuCanErrorPassive, 1));
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
}

static void test_telemetry_stale() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 1000);  // last telemetry at t=1000
  f.m.tick(1000 + kTelemetryTimeoutMs);
  CHECK(!f.active(FaultCode::TelemetryStale, 1));
  f.m.tick(1000 + kTelemetryTimeoutMs + 1);
  CHECK(f.active(FaultCode::TelemetryStale, 1));
  CHECK_STR_EQ(f.m.slot(FaultCode::TelemetryStale, 1).detail, "no valid telemetry for 501 ms");
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));  // heartbeat timeout is longer
  CHECK(f.m.telemetry_state(1) == LinkState::Lost);
  f.motor(1700);
  CHECK(!f.active(FaultCode::TelemetryStale, 1));
  CHECK(f.m.telemetry_state(1) == LinkState::Ok);
}

static void test_monitor_bus_off_is_not_heartbeat_loss() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 1000);
  f.controller(1100, BusState::BusOff, false);
  CHECK(f.active(FaultCode::MonitorBusOff, kNodeIdMonitor));
  CHECK(!f.active(FaultCode::MonitorCanNotRunning, kNodeIdMonitor));
  CHECK(!f.m.monitoring());
  // A long time with no frames: no node is declared lost, the state is unknown.
  for (uint32_t t = 1100; t <= 20000; t += 100) {
    f.controller(t, t < 10000 ? BusState::BusOff : BusState::Recovering, false);
    f.m.tick(t);
  }
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  CHECK(!f.active(FaultCode::HeartbeatLost, 2));
  CHECK(!f.active(FaultCode::BusSilent, kNodeIdMonitor));
  CHECK(f.m.heartbeat_state(1) == LinkState::Unknown);
  CHECK(f.m.telemetry_state(2) == LinkState::Unknown);
  // Recovered and restarted: a fresh grace period starts, then nodes are judged again.
  f.controller(20000);
  CHECK(!f.active(FaultCode::MonitorBusOff, kNodeIdMonitor));
  CHECK(f.m.heartbeat_state(1) == LinkState::Waiting);
  f.m.tick(20000 + kStartupGraceMs);
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  f.healthy(22000, 23000);
  CHECK(f.m.active_count() == 0);
}

static void test_monitor_not_running_and_error_passive() {
  Fixture f;
  f.controller(0, BusState::Stopped, false);
  CHECK(f.active(FaultCode::MonitorCanNotRunning, kNodeIdMonitor));
  f.m.tick(60000);
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  f.controller(60000, BusState::ErrorPassive, true);
  CHECK(!f.active(FaultCode::MonitorCanNotRunning, kNodeIdMonitor));
  CHECK(f.active(FaultCode::MonitorErrorPassive, kNodeIdMonitor));
  f.controller(60100, BusState::ErrorActive, true);
  CHECK(!f.active(FaultCode::MonitorErrorPassive, kNodeIdMonitor));
}

static void test_rx_overrun() {
  Fixture f;
  f.controller(0, BusState::ErrorActive, true, 0);
  f.controller(100, BusState::ErrorActive, true, 3);
  CHECK(f.active(FaultCode::MonitorRxOverrun, kNodeIdMonitor));
  CHECK_STR_EQ(f.m.slot(FaultCode::MonitorRxOverrun, kNodeIdMonitor).detail, "3 frames lost (total 3)");
  f.m.tick(100 + kRxOverrunClearMs - 1);
  CHECK(f.active(FaultCode::MonitorRxOverrun, kNodeIdMonitor));
  f.m.tick(100 + kRxOverrunClearMs);
  CHECK(!f.active(FaultCode::MonitorRxOverrun, kNodeIdMonitor));
}

static void test_invalid_dlc_rejected_and_recovers() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 1000);
  const int32_t before = f.m.ecu(1).values[static_cast<size_t>(FieldId::Rpm)];
  int32_t v[kFieldCount] = {0};
  v[static_cast<size_t>(FieldId::Rpm)] = 4321;
  RawFrame bad;
  encode_motor(v, 99, bad);
  bad.dlc = 4;
  const FrameVerdict verdict = f.m.on_frame(bad, 1100);
  CHECK(!verdict.accepted);
  CHECK_STR_EQ(verdict.reason, "bad_dlc");
  CHECK(f.active(FaultCode::InvalidDlc, 1));
  CHECK_STR_EQ(f.m.slot(FaultCode::InvalidDlc, 1).detail, "0x120 DLC 4, expected 8");
  CHECK(f.m.ecu(1).values[static_cast<size_t>(FieldId::Rpm)] == before);  // not taken
  CHECK(f.m.ecu(1).stats.dlc_errors == 1);

  RawFrame rtr = bad;
  rtr.dlc = 8;
  rtr.remote = true;
  CHECK(!f.m.on_frame(rtr, 1150).accepted);
  CHECK(f.m.ecu(1).stats.dlc_errors == 2);

  // Good frames resume: the fault stays until the clear period has passed.
  f.healthy(1200, 1200 + kIntegrityClearMs - 100);
  CHECK(f.active(FaultCode::InvalidDlc, 1));
  f.healthy(1200 + kIntegrityClearMs, 1200 + kIntegrityClearMs + 200);
  CHECK(!f.active(FaultCode::InvalidDlc, 1));
}

static void test_checksum_and_value_invalid() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 500);
  int32_t v[kFieldCount] = {0};
  RawFrame fr;
  encode_battery(v, 1, fr);
  fr.data[proto::kChecksumByte] ^= 0xFF;
  CHECK(!f.m.on_frame(fr, 600).accepted);
  CHECK(f.active(FaultCode::ChecksumError, 2));
  CHECK(f.m.ecu(2).stats.checksum_errors == 1);

  v[static_cast<size_t>(FieldId::SocPct)] = 0xFF;
  encode_battery(v, 2, fr);
  const FrameVerdict verdict = f.m.on_frame(fr, 610);
  CHECK(!verdict.accepted);
  CHECK(f.active(FaultCode::ValueInvalid, 2));
  CHECK_STR_EQ(f.m.slot(FaultCode::ValueInvalid, 2).detail, "socPct raw 255 outside 0..100");

  // Heartbeat carrying the wrong node id.
  Heartbeat h = {kProtocolVersion, 1, 1, 0, 0, 0};
  RawFrame hf;
  encode_heartbeat(h, 0, hf);
  hf.data[kHbNodeIdByte] = 7;
  hf.data[kChecksumByte] = compute_checksum(hf.can_id, hf.data);
  CHECK(!f.m.on_frame(hf, 620).accepted);
  CHECK(f.active(FaultCode::ValueInvalid, 1));
}

static void test_counter_frozen_and_gaps() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 500);
  int32_t v[kFieldCount] = {0};
  v[static_cast<size_t>(FieldId::Rpm)] = 1000;
  RawFrame fr;
  encode_motor(v, 50, fr);
  f.m.on_frame(fr, 600);  // jump from the fixture's counter -> one gap
  CHECK(f.m.ecu(1).stats.sequence_gaps == 1);
  f.m.on_frame(fr, 700);  // same counter twice
  CHECK(!f.active(FaultCode::CounterFrozen, 1));
  f.m.on_frame(fr, 800);  // three identical in a row
  CHECK(f.active(FaultCode::CounterFrozen, 1));
  CHECK_STR_EQ(f.m.slot(FaultCode::CounterFrozen, 1).detail, "counter stuck at 50 for 3 frames");
  CHECK(f.m.ecu(1).values[static_cast<size_t>(FieldId::Rpm)] == 1000);  // values still accepted
  for (uint8_t c = 51; c <= 52; ++c) {
    encode_motor(v, c, fr);
    f.m.on_frame(fr, 900 + c);
  }
  CHECK(f.active(FaultCode::CounterFrozen, 1));
  encode_motor(v, 53, fr);
  f.m.on_frame(fr, 1000);
  CHECK(!f.active(FaultCode::CounterFrozen, 1));
  // Wrap 255 -> 0 is not a gap.
  const uint32_t gaps = f.m.ecu(1).stats.sequence_gaps;
  encode_motor(v, 255, fr);
  f.m.on_frame(fr, 1100);
  encode_motor(v, 0, fr);
  f.m.on_frame(fr, 1200);
  CHECK(f.m.ecu(1).stats.sequence_gaps == gaps + 1);  // only the 53 -> 255 jump
}

static void test_protocol_version_mismatch() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 500);
  const FrameVerdict hbv = f.hb(1, 600, 99);
  CHECK(!hbv.accepted);
  CHECK(f.active(FaultCode::ProtocolVersionMismatch, 1));
  CHECK_STR_EQ(f.m.slot(FaultCode::ProtocolVersionMismatch, 1).detail, "protocol version 99, supported 1");
  // Telemetry from the incompatible node is rejected...
  const FrameVerdict tv = f.motor(700, 7777);
  CHECK(!tv.accepted);
  CHECK_STR_EQ(tv.reason, "rejected_protocol_version");
  CHECK(f.m.ecu(1).values[static_cast<size_t>(FieldId::Rpm)] != 7777);
  // ...but the node is alive, so no heartbeat loss while it keeps announcing.
  f.hb(1, 1100, 99);
  f.m.tick(1100 + kTelemetryTimeoutMs + 1);
  CHECK(!f.active(FaultCode::HeartbeatLost, 1));
  CHECK(f.active(FaultCode::TelemetryStale, 1));
  // A v1 heartbeat restores trust.
  f.hb(1, 1700);
  CHECK(!f.active(FaultCode::ProtocolVersionMismatch, 1));
  CHECK(f.motor(1750, 7777).accepted);
  CHECK(!f.active(FaultCode::TelemetryStale, 1));
}

static void test_thresholds_and_hysteresis() {
  Fixture f;
  f.controller(0);
  f.healthy(0, 500);
  // Two frames over the critical limit: not yet (needs 3 consecutive).
  f.motor(600, 1500, 1120);
  f.motor(700, 1500, 1120);
  CHECK(!f.active(FaultCode::MotorOvertemp, 1));
  f.motor(800, 1500, 1050);  // interruption resets the count
  f.motor(900, 1500, 1120);
  f.motor(1000, 1500, 1120);
  CHECK(!f.active(FaultCode::MotorOvertemp, 1));
  f.motor(1100, 1500, 1120);
  CHECK(f.active(FaultCode::MotorOvertemp, 1));
  CHECK(f.active(FaultCode::MotorTempHigh, 1));  // warning level crossed too
  CHECK_STR_EQ(f.m.slot(FaultCode::MotorOvertemp, 1).detail, "motorTempC = 112.0 degC (>= 110.0 degC)");
  // Between clear (105.0) and raise (110.0): stays active.
  for (uint32_t t = 1200; t <= 1600; t += 100) f.motor(t, 1500, 1070);
  CHECK(f.active(FaultCode::MotorOvertemp, 1));
  // Three frames below the clear level -> recovered.
  f.motor(1700, 1500, 1040);
  f.motor(1800, 1500, 1040);
  CHECK(f.active(FaultCode::MotorOvertemp, 1));
  f.motor(1900, 1500, 1040);
  CHECK(!f.active(FaultCode::MotorOvertemp, 1));
  CHECK(f.active(FaultCode::MotorTempHigh, 1));  // 104.0 is still >= 90.0 clear level

  // Overspeed at exactly the threshold.
  for (uint32_t t = 2000; t <= 2200; t += 100) f.motor(t, 6500, 650);
  CHECK(f.active(FaultCode::MotorOverspeed, 1));

  // Battery: undervoltage (<=), overcurrent on |current| (negative = charging), SoC low.
  for (uint32_t t = 2000; t <= 2200; t += 100) f.battery(t, 4200, -1000, 15);
  CHECK(f.active(FaultCode::BatteryUndervoltage, 2));
  CHECK(f.active(FaultCode::BatteryOvercurrent, 2));
  CHECK(f.active(FaultCode::BatterySocLow, 2));
  CHECK(!f.active(FaultCode::BatteryOvervoltage, 2));
  for (uint32_t t = 2300; t <= 2500; t += 100) f.battery(t, 4301, 899, 21);
  CHECK(!f.active(FaultCode::BatteryUndervoltage, 2));
  CHECK(!f.active(FaultCode::BatteryOvercurrent, 2));
  CHECK(!f.active(FaultCode::BatterySocLow, 2));
  for (uint32_t t = 2600; t <= 2800; t += 100) f.battery(t, 5500, 0, 90);
  CHECK(f.active(FaultCode::BatteryOvervoltage, 2));
}

static void test_unknown_and_extended_frames() {
  Fixture f;
  f.controller(0);
  RawFrame fr;
  memset(&fr, 0, sizeof(fr));
  fr.can_id = 0x201;  // legacy test-sketch ID
  fr.dlc = 2;
  const FrameVerdict v = f.m.on_frame(fr, 100);
  CHECK(!v.accepted);
  CHECK_STR_EQ(v.reason, "unsupported_id");
  fr.can_id = 0x120;
  fr.format = IdFormat::Extended;
  CHECK_STR_EQ(f.m.on_frame(fr, 200).reason, "extended_id");
  CHECK(f.m.unknown_frames() == 2);
  CHECK(f.m.total_frames() == 2);
  CHECK(f.m.active_count() == 0);
  // Unknown traffic still proves the bus is alive, but not that any ECU is.
  fr.format = IdFormat::Standard;
  fr.can_id = 0x201;
  f.m.on_frame(fr, 2050);
  f.m.tick(kStartupGraceMs + 101);
  CHECK(!f.active(FaultCode::BusSilent, kNodeIdMonitor));
  CHECK(f.active(FaultCode::HeartbeatLost, 1));
}

static void test_clock_wrap() {
  Fixture f;
  const uint32_t t0 = 0xFFFFFC00u;  // ~1 s before wrap
  f.controller(t0);
  f.healthy(t0, t0 + 3000);
  CHECK(f.m.active_count() == 0);
  f.m.tick(t0 + 3000 + kHeartbeatTimeoutMs + 1);
  CHECK(f.active(FaultCode::HeartbeatLost, 1));
}

// Contract with protocol/canscope_protocol.json: each demo fault, injected by
// the real EcuCore and observed by the real MonitorCore, produces exactly the
// documented detections for that node, and everything recovers after "fault clear".
static void test_demo_fault_contract() {
  for (size_t i = 0; i < kDemoFaultExpectCount; ++i) {
    const DemoFaultExpect& exp = kDemoFaultExpect[i];
    for (uint8_t node = 1; node <= 2; ++node) {
      Fixture f;
      EcuCore n1(1, 1, 0, 0);
      EcuCore n2(2, 1, 0, 0);
      n1.begin(0);
      n2.begin(0);
      f.controller(0);
      EcuCore& target = node == 1 ? n1 : n2;

      uint32_t t = 0;
      auto run_until = [&](uint32_t end) {
        for (; t <= end; t += 10) {
          RawFrame out[2];
          size_t k = n1.poll(t, out, 2);
          for (size_t j = 0; j < k; ++j) f.m.on_frame(out[j], t);
          k = n2.poll(t, out, 2);
          for (size_t j = 0; j < k; ++j) f.m.on_frame(out[j], t);
          f.m.tick(t);
        }
      };
      run_until(3000);
      CHECK(f.m.active_count() == 0);

      Command c;
      char line[48];
      snprintf(line, sizeof(line), "fault %s", demo_fault_name(exp.fault));
      parse_command(line, c);
      CHECK(target.handle(c, t).status == AckStatus::Ok);
      run_until(7000);

      size_t expected_hits = 0;
      for (size_t k = 0; k < exp.count; ++k) {
        const bool hit = f.active(exp.codes[k], node);
        if (!hit) printf("  %s node%u: expected %s\n", demo_fault_name(exp.fault), node, fault_name(exp.codes[k]));
        CHECK(hit);
        expected_hits += hit ? 1 : 0;
      }
      if (f.m.active_count() != expected_hits) {
        printf("  %s node%u: %u active faults, expected %u\n", demo_fault_name(exp.fault), node,
               static_cast<unsigned>(f.m.active_count()), static_cast<unsigned>(expected_hits));
      }
      CHECK(f.m.active_count() == expected_hits);  // nothing else, nothing on the other node

      parse_command("fault clear", c);
      target.handle(c, t);
      run_until(11000);
      if (f.m.active_count() != 0) printf("  %s node%u: not recovered\n", demo_fault_name(exp.fault), node);
      CHECK(f.m.active_count() == 0);
    }
  }
}

int main() {
  test_healthy_bus_has_no_faults();
  test_startup_grace_and_never_seen();
  test_heartbeat_loss();
  test_ecu_error_passive_then_lost();
  test_telemetry_stale();
  test_monitor_bus_off_is_not_heartbeat_loss();
  test_monitor_not_running_and_error_passive();
  test_rx_overrun();
  test_invalid_dlc_rejected_and_recovers();
  test_checksum_and_value_invalid();
  test_counter_frozen_and_gaps();
  test_protocol_version_mismatch();
  test_thresholds_and_hysteresis();
  test_unknown_and_extended_frames();
  test_clock_wrap();
  test_demo_fault_contract();
  TEST_MAIN_END();
}
