// Node 3 peripheral logic tests: button debounce and long press, LED policy,
// buzzer alarm/silence, OLED page text, and the monitor's JSON lines.
#include <string.h>

#include "can_protocol.h"
#include "mini_test.h"
#include "monitor_core.h"
#include "monitor_json.h"
#include "monitor_ui.h"

using namespace canscope;
using namespace canscope::proto;

static void test_button() {
  Button b(30, 1500);
  b.reset(false, 0);
  // Contact bounce shorter than the debounce time: no event, not pressed.
  CHECK(b.update(true, 100) == Button::Event::None);
  CHECK(b.update(false, 110) == Button::Event::None);
  CHECK(b.update(true, 115) == Button::Event::None);
  CHECK(b.update(false, 125) == Button::Event::None);
  CHECK(b.update(false, 300) == Button::Event::None);
  CHECK(!b.pressed());
  // Clean press for 200 ms -> one short press on release.
  CHECK(b.update(true, 1000) == Button::Event::None);
  CHECK(b.update(true, 1029) == Button::Event::None);
  CHECK(b.update(true, 1030) == Button::Event::None);
  CHECK(b.pressed());
  CHECK(b.update(false, 1200) == Button::Event::None);
  CHECK(b.update(false, 1230) == Button::Event::ShortPress);
  CHECK(b.update(false, 1300) == Button::Event::None);
  // Long press fires once while held, and its release is not a short press.
  b.update(true, 2000);
  b.update(true, 2030);
  CHECK(b.update(true, 3529) == Button::Event::None);
  CHECK(b.update(true, 3530) == Button::Event::LongPress);
  CHECK(b.update(true, 9000) == Button::Event::None);
  b.update(false, 9100);
  CHECK(b.update(false, 9130) == Button::Event::None);
  // A button already held at reset (stuck or miswired) never fires.
  Button stuck(30, 1500);
  stuck.reset(true, 0);
  CHECK(stuck.update(true, 5000) == Button::Event::None);
  CHECK(stuck.update(false, 5100) == Button::Event::None);
  CHECK(stuck.update(false, 5130) == Button::Event::None);
}

static void test_leds() {
  IndicatorInput in = {true, false, Severity::Info, true};
  LedState s = compute_leds(in, 0);
  CHECK(s.green && !s.yellow && !s.red);
  in.all_nodes_ok = false;  // waiting for an ECU: green blinks at 1 Hz
  CHECK(compute_leds(in, 100).green);
  CHECK(!compute_leds(in, 600).green);
  in.any_fault = true;
  in.worst = Severity::Warning;
  s = compute_leds(in, 0);
  CHECK(!s.green && s.yellow && !s.red);
  in.worst = Severity::Critical;
  s = compute_leds(in, 0);
  CHECK(!s.green && !s.yellow && s.red);
  in.can_running = false;  // own controller down: red blinks at 4 Hz
  CHECK(compute_leds(in, 0).red);
  CHECK(!compute_leds(in, 130).red);
  CHECK(compute_leds(in, 260).red);

  LedState lt;
  CHECK(lamp_test(0, lt) && lt.green && !lt.yellow && !lt.red);
  CHECK(lamp_test(300, lt) && lt.yellow);
  CHECK(lamp_test(600, lt) && lt.red);
  CHECK(!lamp_test(750, lt) && !lt.green && !lt.yellow && !lt.red);
}

static void test_buzzer() {
  Buzzer bz;
  CHECK(!bz.output(true, 0));  // no alarm without a new critical event
  bz.on_new_critical(1000);
  CHECK(bz.output(true, 1000));
  CHECK(!bz.output(true, 1150));
  CHECK(bz.output(true, 1300));
  CHECK(bz.output(true, 1600));
  CHECK(!bz.output(true, 1900));  // after 3 beeps
  CHECK(!bz.output(true, 5000));
  CHECK(bz.output(true, 11000));  // repeats every 10 s while critical
  CHECK(!bz.output(false, 21000));  // critical cleared: alarm ends
  CHECK(!bz.output(true, 31000));
  bz.on_new_critical(40000);
  bz.silence();
  CHECK(bz.silenced());
  CHECK(!bz.output(true, 40000));
  bz.on_new_critical(41000);  // a newer critical fault re-arms
  CHECK(!bz.silenced());
  CHECK(bz.output(true, 41000));
  Buzzer c;
  c.chirp(0, 80);
  CHECK(c.output(false, 79));
  CHECK(!c.output(false, 80));
}

static void feed_healthy(MonitorCore& m, uint32_t t0, uint32_t t1) {
  uint8_t c = 0;
  for (uint32_t t = t0; t <= t1; t += 100, ++c) {
    int32_t v[kFieldCount] = {0};
    for (size_t i = 0; i < kFieldCount; ++i) v[i] = kFields[i].def;
    RawFrame f;
    encode_motor(v, c, f);
    m.on_frame(f, t);
    encode_battery(v, c, f);
    m.on_frame(f, t);
    if (t % 500 == 0) {
      Heartbeat h1 = {kProtocolVersion, 1, 1, 0, 0, 0};
      encode_heartbeat(h1, c, f);
      m.on_frame(f, t);
      Heartbeat h2 = {kProtocolVersion, 2, 1, 0, 0, 0};
      encode_heartbeat(h2, c, f);
      m.on_frame(f, t);
    }
    m.tick(t);
  }
}

static OledInput oled_input(const MonitorCore& m, uint32_t now) {
  OledInput in = {&m, true, BusState::ErrorActive, 0, 0, 0, 12, true, false, now};
  return in;
}

static void test_oled_pages() {
  MonitorCore m;
  ControllerSnapshot snap = {true, BusState::ErrorActive, 0, 0, 0};
  m.on_controller(snap, 0);
  feed_healthy(m, 0, 2000);
  OledLines o;
  render_oled_page(0, oled_input(m, 2000), o);
  for (size_t r = 0; r < kOledRows; ++r) CHECK(strlen(o.line[r]) == kOledCols);
  CHECK(strncmp(o.line[0], "CANScope MON       OK", kOledCols) == 0);
  CHECK(strstr(o.line[1], "N1 HB:ok") != nullptr);
  CHECK(strstr(o.line[2], "1500rpm") != nullptr && strstr(o.line[2], "65.0C") != nullptr);
  CHECK(strstr(o.line[4], "48.00V 12.0A 85%") != nullptr);
  CHECK(strstr(o.line[5], "F:0") != nullptr);

  m.tick(2000 + kHeartbeatTimeoutMs + 1);  // everything goes quiet
  render_oled_page(0, oled_input(m, 3501), o);
  CHECK(strstr(o.line[0], "CRIT") != nullptr);
  CHECK(strstr(o.line[1], "HB:LOST") != nullptr);
  render_oled_page(1, oled_input(m, 3501), o);
  CHECK(strncmp(o.line[0], "ACTIVE FAULTS", 13) == 0);
  CHECK(strstr(o.line[1], "! N1  HB LOST") != nullptr);  // critical first
  render_oled_page(2, oled_input(m, 3501), o);
  CHECK(strncmp(o.line[0], "BUS ERR-ACTIVE", 14) == 0);

  OledInput down = oled_input(m, 3501);
  down.can_running = false;
  down.bus_state = BusState::BusOff;
  render_oled_page(0, down, o);
  CHECK(strstr(o.line[0], "BUS-OFF") != nullptr);
  for (size_t i = 0; i < kFaultCount; ++i) {
    CHECK(strlen(fault_short_name(static_cast<FaultCode>(i))) <= 14);
    CHECK(strcmp(fault_short_name(static_cast<FaultCode>(i)), "?") != 0);
  }
}

static void test_monitor_json() {
  MonitorCore m;
  ControllerSnapshot snap = {true, BusState::ErrorActive, 0, 0, 0};
  m.on_controller(snap, 0);
  char buf[2048];

  // Before any traffic.
  encode_telemetry(m, 1, 100, 5, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"telemetry\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":5,\"node\":\"node1\","
               "\"valid\":false,\"ageMs\":null,\"counter\":0,\"state\":\"waiting\",\"values\":{}}");

  feed_healthy(m, 0, 1000);
  encode_telemetry(m, 1, 1050, 77, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"telemetry\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":77,\"node\":\"node1\","
               "\"valid\":true,\"ageMs\":50,\"counter\":10,\"state\":\"ok\","
               "\"values\":{\"rpm\":1500,\"motorTempC\":65.0}}");
  encode_telemetry(m, 2, 1000, 1, buf, sizeof(buf));
  CHECK(strstr(buf, "\"values\":{\"packVoltageV\":48.00,\"packCurrentA\":12.0,\"socPct\":85}") != nullptr);

  encode_node_health(m, 2, 1100, 9, buf, sizeof(buf));
  CHECK(strstr(buf, "\"type\":\"node_health\"") != nullptr);
  CHECK(strstr(buf, "\"heartbeat\":\"ok\",\"telemetry\":\"ok\",\"heartbeatAgeMs\":100,\"telemetryAgeMs\":100") !=
        nullptr);
  CHECK(strstr(buf, "\"protocolVersion\":1,\"versionOk\":true,\"firmware\":\"1.0.0\",\"ecuCanState\":\"error_active\"") !=
        nullptr);
  CHECK(strstr(buf, "\"stats\":{\"heartbeatFrames\":3,\"telemetryFrames\":11,") != nullptr);

  FaultEvent e = {7, FaultCode::HeartbeatLost, 1, true, 10, "no heartbeat for 1501 ms"};
  encode_fault_event(e, "cafe0001", 99, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"fault\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":99,\"bootId\":\"cafe0001\","
               "\"eventId\":7,\"code\":\"HEARTBEAT_LOST\",\"node\":\"node1\",\"severity\":\"critical\","
               "\"state\":\"active\",\"detail\":\"no heartbeat for 1501 ms\"}");

  encode_fault_snapshot(m, "cafe0001", 1100, 3, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"faults\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":3,\"bootId\":\"cafe0001\","
               "\"lastEventId\":0,\"count\":0,\"active\":[],\"truncated\":false}");
  // Many faults: the line stays within the serial limit and says it was truncated.
  m.tick(60000);
  RawFrame bad;
  memset(&bad, 0, sizeof(bad));
  bad.can_id = kMotorTelemetryId;
  bad.dlc = 3;
  m.on_frame(bad, 60001);
  ControllerSnapshot passive = {true, BusState::ErrorPassive, 50, 130, 0};
  m.on_controller(passive, 60002);
  const size_t n = encode_fault_snapshot(m, "cafe0001", 60010, 3, buf, sizeof(buf));
  CHECK(n > 0 && n < kSerialMaxDeviceLine);
  CHECK(strstr(buf, "\"code\":\"HEARTBEAT_LOST\",\"node\":\"node1\",\"severity\":\"critical\"") != nullptr);

  RawFrame f;
  int32_t v[kFieldCount] = {0};
  encode_motor(v, 0, f);
  f.source_node = "monitor";
  f.timestamp_us = 12;
  f.bus_state = BusState::ErrorActive;
  FrameVerdict verdict = m.on_frame(f, 60100);
  encode_monitor_frame(f, verdict, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"frame\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":12,\"canId\":\"0x120\","
               "\"identifierFormat\":\"standard\",\"remote\":false,\"dlc\":8,\"data\":[0,0,0,0,0,0,0,222],"
               "\"busState\":\"error_active\",\"txErrorCount\":0,\"rxErrorCount\":0,"
               "\"kind\":\"motor_telemetry\",\"check\":\"ok\",\"accepted\":true}");
}

int main() {
  test_button();
  test_leds();
  test_buzzer();
  test_oled_pages();
  test_monitor_json();
  TEST_MAIN_END();
}
