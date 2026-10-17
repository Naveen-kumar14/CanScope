// ECU core tests (Node 1 motor / Node 2 battery): schedule on a fixed clock,
// validated commands, and what each demo fault changes on the wire.
#include <string.h>

#include "can_protocol.h"
#include "ecu_core.h"
#include "mini_test.h"
#include "serial_link.h"

using namespace canscope;
using namespace canscope::proto;

static Command cmd(const char* line) {
  Command c;
  const CommandParse r = parse_command(line, c);
  CHECK(r == CommandParse::Ok);
  return c;
}

static AckStatus run(EcuCore& ecu, const char* line, const char* expect_detail = nullptr) {
  const EcuCommandResult r = ecu.handle(cmd(line), 0);
  if (expect_detail) CHECK_STR_EQ(r.detail, expect_detail);
  return r.status;
}

// Collects frames from t0 to t1 inclusive in 10 ms steps.
struct Capture {
  RawFrame frames[256];
  uint32_t at[256];
  size_t n;
};

static void run_clock(EcuCore& ecu, uint32_t t0, uint32_t t1, Capture& cap) {
  cap.n = 0;
  const uint32_t steps = (t1 - t0) / 10;  // wrap-safe span
  for (uint32_t k = 0; k <= steps; ++k) {
    const uint32_t t = t0 + k * 10;
    RawFrame out[2];
    const size_t got = ecu.poll(t, out, 2);
    for (size_t i = 0; i < got && cap.n < 256; ++i) {
      cap.frames[cap.n] = out[i];
      cap.at[cap.n++] = t;
    }
  }
}

static size_t count_id(const Capture& cap, uint32_t id) {
  size_t n = 0;
  for (size_t i = 0; i < cap.n; ++i) n += cap.frames[i].can_id == id ? 1 : 0;
  return n;
}

static void test_schedule() {
  EcuCore ecu(kNodeIdNode1, 1, 0, 0);
  ecu.begin(1000);
  Capture cap;
  run_clock(ecu, 1000, 1990, cap);  // one second
  CHECK(count_id(cap, kMotorTelemetryId) == 10);
  CHECK(count_id(cap, kNode1HeartbeatId) == 2);
  // Every frame is valid v1 and counters increment by one.
  uint8_t expect = 0;
  for (size_t i = 0; i < cap.n; ++i) {
    const DecodedFrame d = decode(cap.frames[i]);
    CHECK(d.check == FrameCheck::Ok);
    if (d.kind == FrameKind::MotorTelemetry) {
      CHECK(d.counter == expect);
      ++expect;
      CHECK(d.values[static_cast<size_t>(FieldId::Rpm)] == kRpmDefault);
      CHECK(d.values[static_cast<size_t>(FieldId::MotorTempC)] == kMotorTempCDefault);
    } else {
      CHECK(d.heartbeat.node_id == kNodeIdNode1);
      CHECK(d.heartbeat.fw_major == 1);
    }
  }

  // A stall (blocked loop) does not cause a burst of catch-up frames.
  RawFrame out[2];
  CHECK(ecu.poll(5000, out, 2) == 2);
  CHECK(ecu.poll(5000, out, 2) == 0);
  CHECK(ecu.poll(5100, out, 2) == 1);

  // Clock wrap-around keeps the schedule.
  EcuCore w(kNodeIdNode2, 1, 0, 0);
  w.begin(0xFFFFFF00u);
  run_clock(w, 0xFFFFFF00u, 0xFFFFFF00u + 990, cap);
  CHECK(count_id(cap, kBatteryTelemetryId) == 10);
  CHECK(count_id(cap, kNode2HeartbeatId) == 2);
}

static void test_commands_motor() {
  EcuCore ecu(kNodeIdNode1, 1, 0, 0);
  CHECK(run(ecu, "set rpm 3000", "rpm=3000") == AckStatus::Ok);
  CHECK(ecu.setpoint(FieldId::Rpm) == 3000);
  CHECK(run(ecu, "set temp 112.5", "motorTempC=112.5") == AckStatus::Ok);
  CHECK(ecu.setpoint(FieldId::MotorTempC) == 1125);
  CHECK(run(ecu, "set temp -40") == AckStatus::Ok);
  CHECK(ecu.setpoint(FieldId::MotorTempC) == -400);

  // Rejections leave the setpoint unchanged.
  CHECK(run(ecu, "set rpm 8001", "rpm out of range 0..8000 rpm") == AckStatus::Rejected);
  CHECK(run(ecu, "set rpm -1") == AckStatus::Rejected);
  CHECK(run(ecu, "set temp 150.1", "temp out of range -40.0..150.0 degC") == AckStatus::Rejected);
  CHECK(run(ecu, "set temp 20.25") == AckStatus::Rejected);
  CHECK(run(ecu, "set rpm 1e3") == AckStatus::Rejected);
  CHECK(run(ecu, "set rpm") == AckStatus::Rejected);
  CHECK(run(ecu, "set voltage 48") == AckStatus::Rejected);  // battery parameter on the motor ECU
  CHECK(ecu.setpoint(FieldId::Rpm) == 3000);
  CHECK(ecu.setpoint(FieldId::MotorTempC) == -400);

  CHECK(run(ecu, "profile drive", "profile=drive") == AckStatus::Ok);
  CHECK(ecu.profile() == EcuProfile::Drive);
  CHECK(run(ecu, "profile turbo") == AckStatus::Rejected);
  CHECK(run(ecu, "fault bad_dlc", "demoFault=bad_dlc") == AckStatus::Ok);
  CHECK(run(ecu, "fault explode") == AckStatus::Rejected);
  CHECK(ecu.demo_fault() == DemoFault::BadDlc);
  CHECK(run(ecu, "fault none") == AckStatus::Rejected);  // "clear" is the only way back
  CHECK(run(ecu, "fault clear", "demoFault=none") == AckStatus::Ok);
  CHECK(ecu.demo_fault() == DemoFault::None);
  CHECK(run(ecu, "reboot") == AckStatus::Unsupported);
}

static void test_commands_battery() {
  EcuCore ecu(kNodeIdNode2, 1, 0, 0);
  CHECK(run(ecu, "set voltage 41.5", "packVoltageV=41.50") == AckStatus::Ok);
  CHECK(ecu.setpoint(FieldId::PackVoltageV) == 4150);
  CHECK(run(ecu, "set current -150.0") == AckStatus::Ok);
  CHECK(run(ecu, "set current 150.1") == AckStatus::Rejected);
  CHECK(run(ecu, "set soc 100") == AckStatus::Ok);
  CHECK(run(ecu, "set soc 101") == AckStatus::Rejected);
  CHECK(run(ecu, "set soc 50.5") == AckStatus::Rejected);
  CHECK(run(ecu, "set voltage 60.01") == AckStatus::Rejected);
  CHECK(run(ecu, "set rpm 100") == AckStatus::Rejected);
}

static void test_profile_drive_stays_valid() {
  EcuCore ecu(kNodeIdNode1, 1, 0, 0);
  ecu.handle(cmd("set rpm 8000"), 0);
  ecu.handle(cmd("set temp 150"), 0);
  ecu.handle(cmd("profile drive"), 0);
  bool varied = false;
  for (uint32_t t = 0; t < 30000; t += 37) {
    const int32_t rpm = ecu.profile_value(FieldId::Rpm, t);
    CHECK(rpm >= 0 && rpm <= 8000);
    const int32_t temp = ecu.profile_value(FieldId::MotorTempC, t);
    CHECK(temp >= -400 && temp <= 1500);
    if (rpm != 8000) varied = true;
  }
  CHECK(varied);
  ecu.handle(cmd("profile static"), 0);
  CHECK(ecu.profile_value(FieldId::Rpm, 1234) == 8000);
}

static void test_demo_faults_on_wire() {
  Capture cap;
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault heartbeat_stop"), 0);
    run_clock(e, 0, 990, cap);
    CHECK(count_id(cap, kNode1HeartbeatId) == 0);
    CHECK(count_id(cap, kMotorTelemetryId) == 10);
  }
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault telemetry_stop"), 0);
    run_clock(e, 0, 990, cap);
    CHECK(count_id(cap, kNode1HeartbeatId) == 2);
    CHECK(count_id(cap, kMotorTelemetryId) == 0);
  }
  {
    EcuCore e(kNodeIdNode2, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault silent"), 0);
    run_clock(e, 0, 990, cap);
    CHECK(cap.n == 0);
  }
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault invalid_value"), 0);
    run_clock(e, 0, 90, cap);
    const DecodedFrame d = decode(cap.frames[0]);
    CHECK(d.check == FrameCheck::ValueOutOfRange);
    CHECK(d.bad_field == FieldId::Rpm);
  }
  {
    EcuCore e(kNodeIdNode2, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault invalid_value"), 0);
    run_clock(e, 0, 90, cap);
    CHECK(decode(cap.frames[0]).bad_field == FieldId::SocPct);
  }
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault bad_dlc"), 0);
    run_clock(e, 0, 90, cap);
    CHECK(cap.frames[0].dlc == 4);
    CHECK(decode(cap.frames[0]).check == FrameCheck::BadDlc);
    CHECK(decode(cap.frames[1]).check == FrameCheck::Ok);  // heartbeat unaffected
  }
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault bad_checksum"), 0);
    run_clock(e, 0, 90, cap);
    CHECK(decode(cap.frames[0]).check == FrameCheck::BadChecksum);
  }
  {
    EcuCore e(kNodeIdNode1, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault counter_freeze"), 0);
    run_clock(e, 0, 290, cap);
    uint8_t first = 255;
    for (size_t i = 0; i < cap.n; ++i) {
      const DecodedFrame d = decode(cap.frames[i]);
      if (d.kind != FrameKind::MotorTelemetry) continue;
      CHECK(d.check == FrameCheck::Ok);
      if (first == 255) first = d.counter;
      CHECK(d.counter == first);
    }
  }
  {
    EcuCore e(kNodeIdNode2, 1, 0, 0);
    e.begin(0);
    e.handle(cmd("fault bad_version"), 0);
    run_clock(e, 0, 90, cap);
    bool saw = false;
    for (size_t i = 0; i < cap.n; ++i) {
      const DecodedFrame d = decode(cap.frames[i]);
      if (d.kind != FrameKind::Heartbeat) continue;
      CHECK(d.check == FrameCheck::UnsupportedVersion);
      CHECK(d.heartbeat.protocol_version == kBadProtocolVersion);
      saw = true;
    }
    CHECK(saw);
  }
  {
    // Own controller state goes into heartbeat byte 5, clamped to 0..2.
    EcuCore e(kNodeIdNode1, 1, 2, 3);
    e.begin(0);
    e.set_can_state(7);
    RawFrame out[2];
    CHECK(e.poll(0, out, 2) == 2);
    const DecodedFrame d = decode(out[1]);
    CHECK(d.check == FrameCheck::Ok);
    CHECK(d.heartbeat.can_state == 2);
    CHECK(d.heartbeat.fw_minor == 2 && d.heartbeat.fw_patch == 3);
  }
}

static void test_ecu_state_json() {
  EcuCore ecu(kNodeIdNode2, 1, 0, 0);
  ecu.begin(0);
  ecu.handle(cmd("set voltage 41.5"), 0);
  ecu.handle(cmd("fault bad_dlc"), 0);
  RawFrame out[2];
  ecu.poll(0, out, 2);
  EcuTxStats tx = {true, "error_active", 2, 0, 5};
  char buf[640];
  CHECK(encode_ecu_state(ecu, "node2", "battery_ecu", "00c0ffee", 4, tx, buf, sizeof(buf)) > 0);
  CHECK_STR_EQ(buf,
               "{\"type\":\"ecu_state\",\"sourceNode\":\"node2\",\"deviceTimeUs\":4,\"bootId\":\"00c0ffee\","
               "\"role\":\"battery_ecu\",\"canRunning\":true,\"busState\":\"error_active\",\"profile\":\"static\","
               "\"demoFault\":\"bad_dlc\",\"setpoint\":{\"packVoltageV\":41.50,\"packCurrentA\":12.0,\"socPct\":85},"
               "\"sent\":{\"packVoltageV\":41.50,\"packCurrentA\":12.0,\"socPct\":85},\"telemetryFrames\":1,"
               "\"heartbeatFrames\":1,\"txOk\":2,\"txFailed\":0,\"rxIgnored\":5}");
}

int main() {
  test_ecu_state_json();
  test_schedule();
  test_commands_motor();
  test_commands_battery();
  test_profile_drive_stays_valid();
  test_demo_faults_on_wire();
  TEST_MAIN_END();
}
