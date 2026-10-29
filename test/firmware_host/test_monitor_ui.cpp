// Node 3 peripheral logic tests: LED policy, OLED page text and automatic
// page rotation, the "display" command and the commanded-fault OLED view
// (kept apart from detection), the pin configuration, and the monitor's JSON
// lines.
#include <string.h>

#include "can_protocol.h"
#include "mini_test.h"
#include "monitor_core.h"
#include "monitor_hw_config.h"
#include "monitor_json.h"
#include "monitor_ui.h"
#include "serial_link.h"

using namespace canscope;
using namespace canscope::proto;

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
  OledInput in = {&m, true, BusState::ErrorActive, 0, 0, 0, 12, now, nullptr};
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

static bool any_line_contains(const OledLines& o, const char* text) {
  for (size_t r = 0; r < kOledRows; ++r) {
    if (strstr(o.line[r], text) != nullptr) return true;
  }
  return false;
}

static void check_blank_from(const OledLines& o, size_t first_row) {
  for (size_t r = first_row; r < kOledRows; ++r) CHECK_STR_EQ(o.line[r], "                     ");
}

// The commanded-fault view shows ECU labels and fault names, nothing else:
// none of the summary diagnostics or verification wording.
static void check_commanded_view_only(const OledLines& o) {
  static const char* const kBanned[] = {"CANScope", "CRIT", "WARN", "ERR-", "BUS", "HB:", "TEL:",
                                        "rx",       "F:",   "A:page", "DETECT", "CONFIRM", "COMMAND", "ACCEPT",
                                        "UNVERIFIED", "WAITING", "EVIDENCE", "USB", "CAN"};
  for (size_t i = 0; i < sizeof(kBanned) / sizeof(kBanned[0]); ++i) CHECK(!any_line_contains(o, kBanned[i]));
  for (size_t r = 0; r < kOledRows; ++r) CHECK(strlen(o.line[r]) == kOledCols);
}

static AckStatus display(CommandedFaults& cf, const char* line, const char** detail_out = nullptr) {
  Command cmd;
  CHECK(parse_command(line, cmd) == CommandParse::Ok);
  const char* detail = "";
  const AckStatus s = apply_display_command(cf, cmd, &detail);
  if (detail_out) *detail_out = detail;
  return s;
}

static void test_display_command() {
  CommandedFaults cf;
  CHECK(!cf.any());
  const char* detail = "";
  CHECK(display(cf, "display fault node1 bad_checksum", &detail) == AckStatus::Ok);
  CHECK_STR_EQ(detail, "OLED: commanded fault shown (display only, not a detection)");
  CHECK(cf.get(1) == DemoFault::BadChecksum && cf.get(2) == DemoFault::None && cf.any());
  // Duplicate: harmless, acknowledged, state unchanged.
  CHECK(display(cf, "display fault node1 bad_checksum", &detail) == AckStatus::Ok);
  CHECK_STR_EQ(detail, "OLED: commanded fault already shown (display only, not a detection)");
  CHECK(cf.get(1) == DemoFault::BadChecksum);
  CHECK(display(cf, "@w1 display fault node2 silent") == AckStatus::Ok);
  CHECK(cf.get(2) == DemoFault::Silent);
  // Per-ECU clear leaves the other ECU alone.
  CHECK(display(cf, "display clear node1", &detail) == AckStatus::Ok);
  CHECK_STR_EQ(detail, "OLED: commanded fault cleared (display only)");
  CHECK(cf.get(1) == DemoFault::None && cf.get(2) == DemoFault::Silent);
  CHECK(display(cf, "display clear node1") == AckStatus::Ok);  // clearing twice is fine
  CHECK(display(cf, "display fault node2 none") == AckStatus::Ok);  // "none" clears too
  CHECK(!cf.any());
  CHECK(display(cf, "display fault node1 heartbeat_stop") == AckStatus::Ok);
  CHECK(display(cf, "display fault node2 heartbeat_stop") == AckStatus::Ok);
  CHECK(display(cf, "display clear") == AckStatus::Ok);
  CHECK(!cf.any());
  // Rejected input changes nothing.
  cf.set(1, DemoFault::BadDlc);
  CHECK(display(cf, "display fault node1 explode", &detail) == AckStatus::Rejected);
  CHECK_STR_EQ(detail, "unknown demo fault");
  CHECK(display(cf, "display fault monitor bad_dlc") == AckStatus::Rejected);
  CHECK(display(cf, "display fault node3 bad_dlc") == AckStatus::Rejected);
  CHECK(display(cf, "display fault node1") == AckStatus::Rejected);
  CHECK(display(cf, "display clear node1 node2") == AckStatus::Rejected);
  CHECK(display(cf, "display clear monitor") == AckStatus::Rejected);
  CHECK(display(cf, "display show node1 bad_dlc") == AckStatus::Rejected);
  CHECK(display(cf, "display", &detail) == AckStatus::Rejected);
  CHECK(strncmp(detail, "usage: display", 14) == 0);
  CHECK(cf.get(1) == DemoFault::BadDlc && cf.get(2) == DemoFault::None);
  CHECK(!cf.set(kNodeIdMonitor, DemoFault::BadDlc));
  CHECK(cf.get(kNodeIdMonitor) == DemoFault::None);
}

// Node 3 with its controller running but error passive and no frame at all:
// the state of the screenshots (HB:LOST, TEL:LOST, ERR-PASSIVE, CRIT 6).
static MonitorCore& quiet_error_passive_core(MonitorCore& m) {
  ControllerSnapshot s = {true, BusState::ErrorPassive, 0, 0, 135};
  for (uint32_t t = 0; t <= 10000; t += 100) {
    m.on_controller(s, t);
    m.tick(t);
  }
  return m;
}

static void test_commanded_view_without_can() {
  MonitorCore m;
  quiet_error_passive_core(m);
  CHECK(m.total_frames() == 0);
  CHECK(m.active_count() == 6);
  OledInput in = oled_input(m, 10000);
  in.bus_state = BusState::ErrorPassive;
  CommandedFaults cf;
  in.commanded = &cf;
  OledLines o;

  // No commanded fault: the normal summary with its diagnostics.
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "CANScope MON   CRIT 6");
  CHECK_STR_EQ(o.line[1], "N1 HB:LOST TEL:LOST  ");
  CHECK(strncmp(o.line[6], "ERR-PASSIVE rx0", 15) == 0);

  // Node 1 only.
  cf.set(1, DemoFault::HeartbeatStop);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 1:              ");
  CHECK_STR_EQ(o.line[1], "  HEARTBEAT LOST     ");
  check_blank_from(o, 2);
  check_commanded_view_only(o);

  // Node 2 only.
  cf.clear_all();
  cf.set(2, DemoFault::HeartbeatStop);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 2:              ");
  CHECK_STR_EQ(o.line[1], "  HEARTBEAT LOST     ");
  check_blank_from(o, 2);
  check_commanded_view_only(o);

  // Both at once.
  cf.set(1, DemoFault::HeartbeatStop);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 1:              ");
  CHECK_STR_EQ(o.line[1], "  HEARTBEAT LOST     ");
  CHECK_STR_EQ(o.line[2], "                     ");
  CHECK_STR_EQ(o.line[3], "Node 2:              ");
  CHECK_STR_EQ(o.line[4], "  HEARTBEAT LOST     ");
  check_blank_from(o, 5);
  check_commanded_view_only(o);

  // Both with the longest name: wrapped, still inside 8 rows x 21 columns.
  cf.set(1, DemoFault::BadVersion);
  cf.set(2, DemoFault::BadVersion);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 1:              ");
  CHECK_STR_EQ(o.line[1], "  PROTOCOL VERSION   ");
  CHECK_STR_EQ(o.line[2], "  MISMATCH           ");
  CHECK_STR_EQ(o.line[3], "                     ");
  CHECK_STR_EQ(o.line[4], "Node 2:              ");
  CHECK_STR_EQ(o.line[5], "  PROTOCOL VERSION   ");
  CHECK_STR_EQ(o.line[6], "  MISMATCH           ");
  check_blank_from(o, 7);
  check_commanded_view_only(o);

  // Clearing Node 1 keeps Node 2.
  cf.set(1, DemoFault::HeartbeatStop);
  cf.set(2, DemoFault::CounterFreeze);
  cf.set(1, DemoFault::None);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 2:              ");
  CHECK_STR_EQ(o.line[1], "  COUNTER FROZEN     ");
  check_blank_from(o, 2);
  CHECK(!any_line_contains(o, "Node 1"));

  // Clearing both restores the normal summary (detections unchanged).
  cf.set(2, DemoFault::None);
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "CANScope MON   CRIT 6");
  CHECK_STR_EQ(o.line[3], "N2 HB:LOST TEL:LOST  ");

  // The other pages are not replaced by the commanded view.
  cf.set(1, DemoFault::HeartbeatStop);
  render_oled_page(1, in, o);
  CHECK(strncmp(o.line[0], "ACTIVE FAULTS (6)", 17) == 0);
  render_oled_page(2, in, o);
  CHECK(strncmp(o.line[0], "BUS ERR-PASSIVE", 15) == 0);
  CHECK(strncmp(o.line[2], "RX frames 0", 11) == 0);

  // Every readable name fits in two indented lines.
  for (size_t i = 1; i < static_cast<size_t>(DemoFault::Count); ++i) {
    CHECK(strlen(demo_fault_display_name(static_cast<DemoFault>(i))) <= 2 * (kOledCols - 2));
  }
}

// Commanded display state and MonitorCore's detections never touch each other.
static void test_commanded_state_is_separate_from_detection() {
  MonitorCore m;
  ControllerSnapshot snap = {true, BusState::ErrorActive, 0, 0, 0};
  m.on_controller(snap, 0);
  feed_healthy(m, 0, 2000);
  CHECK(m.active_count() == 0);
  const uint32_t frames = m.total_frames();
  const uint32_t events = m.last_event_id();
  const EcuStats before = m.ecu(1).stats;

  CommandedFaults cf;
  CHECK(display(cf, "display fault node1 bad_checksum") == AckStatus::Ok);
  CHECK(display(cf, "display fault node2 heartbeat_stop") == AckStatus::Ok);
  OledInput in = oled_input(m, 2000);
  in.commanded = &cf;
  OledLines o;
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[1], "  BAD CHECKSUM       ");
  // Nothing detected, no frame, event or counter added by the display command.
  CHECK(m.active_count() == 0);
  CHECK(!m.active(FaultCode::ChecksumError, 1) && !m.active(FaultCode::HeartbeatLost, 2));
  CHECK(m.total_frames() == frames);
  CHECK(m.last_event_id() == events);
  CHECK(memcmp(&before, &m.ecu(1).stats, sizeof(before)) == 0);
  CHECK(m.heartbeat_state(2) == LinkState::Ok);

  // Real reception keeps working while the commanded view is shown: the
  // traffic stops, Node 3 detects it on its own, and the view is unchanged.
  m.tick(2000 + kHeartbeatTimeoutMs + 1);
  CHECK(m.active(FaultCode::HeartbeatLost, 1) && m.active(FaultCode::HeartbeatLost, 2));
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 1:              ");
  CHECK_STR_EQ(o.line[1], "  BAD CHECKSUM       ");
  CHECK_STR_EQ(o.line[3], "Node 2:              ");
  CHECK_STR_EQ(o.line[4], "  HEARTBEAT LOST     ");
  check_commanded_view_only(o);
  render_oled_page(1, in, o);  // the detection page still shows the truth
  CHECK(strstr(o.line[1], "! N1  HB LOST") != nullptr);

  // Traffic returns: detections clear by themselves; the commanded view stays
  // until the dashboard clears it.
  feed_healthy(m, 4000, 4600);
  CHECK(!m.active(FaultCode::HeartbeatLost, 1) && !m.active(FaultCode::HeartbeatLost, 2));
  render_oled_page(0, in, o);
  CHECK_STR_EQ(o.line[0], "Node 1:              ");
  cf.clear_all();
  in.now_ms = 4600;
  render_oled_page(0, in, o);
  CHECK(strncmp(o.line[0], "CANScope MON", 12) == 0);
}

// Node 3 pin assignments as built (monitor_hw_config.h): no push-buttons and
// no buzzer are configured; the green LED has no verified pin.
static void test_monitor_pin_config() {
  CHECK(MONITOR_LED_GREEN_GPIO == -1);
  CHECK(MONITOR_LED_YELLOW_GPIO == 26 && MONITOR_LED_RED_GPIO == 27);
  CHECK(MONITOR_I2C_SDA_GPIO == 21 && MONITOR_I2C_SCL_GPIO == 22);
  CHECK(MONITOR_CAN_TX_GPIO == 17 && MONITOR_CAN_RX_GPIO == 16);
#if defined(MONITOR_BUTTON_A_GPIO) || defined(MONITOR_BUTTON_B_GPIO) || defined(MONITOR_BUZZER_GPIO) || \
    defined(MONITOR_BUZZER_ENABLED) || defined(MONITOR_BUZZER_HW_VERIFIED)
  CHECK(false);  // removed features must not come back as configuration
#endif
}

// Without buttons the OLED turns its pages by itself; a commanded fault holds
// page 0 (the commanded-fault view) so it is never rotated away.
static void test_oled_page_rotation() {
  CHECK(oled_page_for(0, false) == 0);
  CHECK(oled_page_for(kOledPagePeriodMs - 1, false) == 0);
  CHECK(oled_page_for(kOledPagePeriodMs, false) == 1);
  CHECK(oled_page_for(2 * kOledPagePeriodMs, false) == 2);
  CHECK(oled_page_for(3 * kOledPagePeriodMs, false) == 0);
  for (uint32_t t = 0; t < 10 * kOledPagePeriodMs; t += 250) {
    CHECK(oled_page_for(t, true) == 0);
    CHECK(oled_page_for(t, false) < kOledPageCount);
  }
  CHECK(oled_page_for(0xFFFFFFFFu, false) < kOledPageCount);  // no out-of-range page at the wrap
}

// What main.cpp does, end to end on the host: serial "display" lines are
// parsed and applied, the OLED shows the commanded view (rotation held),
// clearing restores the rotating normal pages, and MonitorCore sees no frame,
// counter or fault from any of it (zero CAN frames here).
static void test_display_serial_flow() {
  MonitorCore core;
  ControllerSnapshot quiet = {true, BusState::ErrorPassive, 0, 0, 135};
  for (uint32_t t = 0; t <= 5000; t += 100) {
    core.on_controller(quiet, t);
    core.tick(t);
  }
  const size_t active_before = core.active_count();
  const uint32_t events_before = core.last_event_id();
  CHECK(core.total_frames() == 0 && active_before == 6);

  CommandedFaults cf;
  OledInput in = oled_input(core, 6000);
  in.bus_state = BusState::ErrorPassive;
  in.commanded = &cf;
  OledLines o;
  const char* const lines[] = {"@w1 display fault node1 heartbeat_stop", "@w2 display fault node1 heartbeat_stop",
                               "@w3 display fault node2 heartbeat_stop"};
  for (size_t i = 0; i < sizeof(lines) / sizeof(lines[0]); ++i) {
    Command cmd;
    CHECK(parse_command(lines[i], cmd) == CommandParse::Ok);
    const char* detail = "";
    CHECK(apply_display_command(cf, cmd, &detail) == AckStatus::Ok);
  }
  for (uint32_t t = 6000; t < 30000; t += 1000) {  // rotation is held while faults are set
    render_oled_page(oled_page_for(t, cf.any()), in, o);
    CHECK_STR_EQ(o.line[0], "Node 1:              ");
    CHECK_STR_EQ(o.line[3], "Node 2:              ");
    check_commanded_view_only(o);
  }
  CHECK(display(cf, "@w4 display clear node1") == AckStatus::Ok);
  render_oled_page(oled_page_for(31000, cf.any()), in, o);
  CHECK_STR_EQ(o.line[0], "Node 2:              ");
  CHECK(display(cf, "@w5 display clear") == AckStatus::Ok);
  // Normal pages again, rotating: summary, active faults, bus.
  render_oled_page(oled_page_for(30000, cf.any()), in, o);
  CHECK(strncmp(o.line[0], "CANScope MON   CRIT 6", kOledCols) == 0);
  render_oled_page(oled_page_for(35000, cf.any()), in, o);
  CHECK(strncmp(o.line[0], "ACTIVE FAULTS (6)", 17) == 0);
  render_oled_page(oled_page_for(40000, cf.any()), in, o);
  CHECK(strncmp(o.line[0], "BUS ERR-PASSIVE", 15) == 0);
  // Detection state untouched by all of the above.
  CHECK(core.total_frames() == 0);
  CHECK(core.active_count() == active_before && core.last_event_id() == events_before);
  CHECK(core.active(FaultCode::HeartbeatLost, 1) && core.active(FaultCode::HeartbeatLost, 2));
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
  test_leds();
  test_oled_pages();
  test_display_command();
  test_commanded_view_without_can();
  test_commanded_state_is_separate_from_detection();
  test_monitor_pin_config();
  test_oled_page_rotation();
  test_display_serial_flow();
  test_monitor_json();
  TEST_MAIN_END();
}
