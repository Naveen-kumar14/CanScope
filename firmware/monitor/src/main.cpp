// CANScope Node 3 - CANScope Monitor firmware.
//
// Receives every CAN frame through TWAI + SN65HVD230, validates and decodes
// protocol v1 traffic, and detects faults on its own (heartbeat loss, stale
// telemetry, bad DLC/checksum/counter/values, protocol version, thresholds,
// own bus-off / error passive / RX overrun, silent bus). Reports to the
// dashboard over USB serial and locally on the SSD1306 OLED, three LEDs and
// (when enabled) the buzzer. It never transmits an application frame.
//
// Decisions are made in portable, host-tested code (monitor_core, monitor_ui,
// monitor_json); this file only moves data between them and the hardware.
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Arduino.h>
#include <Wire.h>

#include "can_protocol.h"
#include "diagnostics.h"
#include "driver/twai.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "monitor_core.h"
#include "monitor_hw_config.h"
#include "monitor_json.h"
#include "monitor_ui.h"
#include "protocol_spec.h"
#include "serial_link.h"
#include "twai_transport.h"

using namespace canscope;

namespace {

const BannerInfo kBanner = {"monitor (Node 3)", monitor_cfg::kFirmwareVersion, monitor_cfg::kBoard,
                            monitor_cfg::kTransceiver};
const size_t kMaxRxPerLoop = 32;
const size_t kMaxSerialBytesPerLoop = 256;
const uint32_t kOledRefreshMs = 250;
const uint32_t kOledRetryMs = 10000;

TwaiTransport transport;
MonitorCore core;
LineAssembler lines;
Adafruit_SSD1306 display(128, 64, &Wire, -1);
Button button_a;
Button button_b;
Buzzer buzzer;

bool can_ok = false;
TransportResult can_init = TransportResult::NotStarted;
BusStatus bus = empty_bus_status();
char boot_id[9];
bool frames_out = true;
uint8_t oled_addr = 0;
bool oled_ok = false;
uint8_t page = 0;
bool button_a_stuck = false;
bool button_b_stuck = false;
uint32_t boot_ms = 0;
uint32_t last_status_ms = 0;
uint32_t last_hello_ms = 0;
uint32_t last_oled_ms = 0;
uint32_t last_oled_probe_ms = 0;
uint32_t last_tel_event_ms[3] = {0, 0, 0};
uint32_t tel_count_at_event[3] = {0, 0, 0};
uint32_t alarm_seen_event = 0;

const char kCommands[] = "hello status help recover faults frames silence";

uint64_t now_us() { return static_cast<uint64_t>(esp_timer_get_time()); }

void serial_sink(const char* line, void*) { Serial.println(line); }

void ack(const char* id, const char* command, AckStatus status, const char* detail) {
  char line[384];
  if (encode_ack(monitor_cfg::kCanConfig.node_name, now_us(), boot_id, id, command, status, detail, line, sizeof(line))) {
    Serial.println(line);
  }
}

// ----------------------------------------------------------- serial output

void print_hello() {
  HelloInfo info = {"monitor", proto::kNodeIdMonitor, "monitor", monitor_cfg::kFirmwareVersion, boot_id,
                    kCommands};
  char line[384];
  if (encode_hello(info, now_us(), line, sizeof(line))) Serial.println(line);
}

void print_status() {
  char line[384];
  if (encode_status_json("monitor", now_us(), monitor_cfg::kCanConfig, can_ok ? bus : empty_bus_status(), line,
                         sizeof(line))) {
    Serial.println(line);
  }
}

void print_telemetry(uint8_t node, uint32_t now) {
  char line[384];
  if (encode_telemetry(core, node, now, now_us(), line, sizeof(line))) Serial.println(line);
  last_tel_event_ms[node] = now;
  tel_count_at_event[node] = core.ecu(node).stats.telemetry_frames;
}

void print_health(uint32_t now) {
  char line[768];
  for (uint8_t node = 1; node <= 2; ++node) {
    if (encode_node_health(core, node, now, now_us(), line, sizeof(line))) Serial.println(line);
  }
  static char snap[proto::kSerialMaxDeviceLine];
  if (encode_fault_snapshot(core, boot_id, now, now_us(), snap, sizeof(snap))) Serial.println(snap);
}

void print_selftest() {
  char line[512];
  char oled[24];
  if (oled_ok) {
    snprintf(oled, sizeof(oled), "ok@0x%02X", oled_addr);
  } else {
    snprintf(oled, sizeof(oled), "not_found");
  }
  snprintf(line, sizeof(line),
           "{\"type\":\"selftest\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":%llu,\"bootId\":\"%s\","
           "\"can\":\"%s\",\"oled\":\"%s\",\"buttonA\":\"%s\",\"buttonB\":\"%s\",\"buzzer\":\"%s\","
           "\"leds\":\"driven (visual check required)\"}",
           static_cast<unsigned long long>(now_us()), boot_id, transport_result_name(can_init), oled,
           button_a_stuck ? "pressed_at_boot" : "released", button_b_stuck ? "pressed_at_boot" : "released",
           MONITOR_BUZZER_ENABLED ? "enabled" : "disabled_by_build (gate G10)");
  Serial.println(line);
}

void on_fault(const FaultEvent& e, void*) {
  char line[512];
  if (encode_fault_event(e, boot_id, now_us(), line, sizeof(line))) Serial.println(line);
  if (e.active && proto::fault_info(e.code).severity == proto::Severity::Warning) buzzer.chirp(millis());
}

// ------------------------------------------------------------- peripherals

bool probe_i2c(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

void oled_init() {
  last_oled_probe_ms = millis();
  const uint8_t candidates[2] = {0x3C, 0x3D};
  oled_addr = 0;
  if (MONITOR_OLED_I2C_ADDR) {
    if (probe_i2c(MONITOR_OLED_I2C_ADDR)) oled_addr = MONITOR_OLED_I2C_ADDR;
  } else {
    for (size_t i = 0; i < 2 && !oled_addr; ++i) {
      if (probe_i2c(candidates[i])) oled_addr = candidates[i];
    }
  }
  if (!oled_addr) {
    oled_ok = false;
    Serial.println("# OLED: no SSD1306 ACK at 0x3C/0x3D (check VCC 3V3, GND, SDA GPIO21, SCL GPIO22)");
    return;
  }
  // Wire is already started on the configured pins: periphBegin = false.
  oled_ok = display.begin(SSD1306_SWITCHCAPVCC, oled_addr, true, false);
  Serial.printf("# OLED: %s at 0x%02X\n", oled_ok ? "SSD1306 initialised" : "init FAILED (out of memory?)",
                oled_addr);
  if (oled_ok) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setTextWrap(false);
    display.setCursor(0, 0);
    display.print("CANScope monitor");
    display.setCursor(0, 16);
    display.print("starting...");
    display.display();
  }
}

void oled_draw(uint32_t now) {
  if (!oled_ok) return;
  OledInput in = {&core, core.monitoring(), can_ok ? bus.state : BusState::Stopped, bus.tx_error_counter,
                  bus.rx_error_counter, bus.rx_missed, (now - boot_ms) / 1000, MONITOR_BUZZER_ENABLED != 0,
                  buzzer.silenced(), now};
  OledLines out;
  render_oled_page(page, in, out);
  display.clearDisplay();
  for (size_t r = 0; r < kOledRows; ++r) {
    display.setCursor(0, static_cast<int16_t>(r * 8));
    display.print(out.line[r]);
  }
  display.display();
}

void set_leds(const LedState& s) {
  digitalWrite(MONITOR_LED_GREEN_GPIO, s.green ? HIGH : LOW);
  digitalWrite(MONITOR_LED_YELLOW_GPIO, s.yellow ? HIGH : LOW);
  digitalWrite(MONITOR_LED_RED_GPIO, s.red ? HIGH : LOW);
}

void set_buzzer(bool on) {
#if MONITOR_BUZZER_ENABLED
  digitalWrite(MONITOR_BUZZER_GPIO, on ? HIGH : LOW);
#else
  (void)on;
#endif
}

bool request_recovery(const char** why) {
  if (!can_ok) {
    *why = "CAN controller not started";
    return false;
  }
  if (bus.state != BusState::BusOff) {
    *why = "controller is not bus-off";
    return false;
  }
  const TransportResult r = transport.request_bus_off_recovery();
  *why = r == TransportResult::Ok ? "bus-off recovery started" : transport_result_name(r);
  return r == TransportResult::Ok;
}

// ---------------------------------------------------------------- commands

void handle_line(const char* line, uint32_t now) {
  Command cmd;
  const CommandParse parsed = parse_command(line, cmd);
  if (parsed == CommandParse::Empty) return;
  if (parsed != CommandParse::Ok) {
    char id[kMaxCommandId + 1];
    extract_command_id(line, id, sizeof(id));
    ack(id, "", AckStatus::Rejected, command_parse_text(parsed));
    return;
  }
  char text[kMaxCommandLine + 1];
  command_text(cmd, text, sizeof(text));

  if (strcmp(cmd.verb, "hello") == 0 && cmd.argc == 0) {
    print_hello();
    print_selftest();
    ack(cmd.id, text, AckStatus::Ok, "hello sent");
  } else if (strcmp(cmd.verb, "status") == 0 && cmd.argc == 0) {
    print_status();
    print_health(now);
    ack(cmd.id, text, AckStatus::Ok, "status sent");
  } else if (strcmp(cmd.verb, "faults") == 0 && cmd.argc == 0) {
    print_health(now);
    ack(cmd.id, text, AckStatus::Ok, "fault snapshot sent");
  } else if (strcmp(cmd.verb, "help") == 0) {
    ack(cmd.id, text, AckStatus::Ok, "hello | status | faults | frames on|off | silence | recover");
  } else if (strcmp(cmd.verb, "frames") == 0) {
    if (cmd.argc == 1 && (strcmp(cmd.args[0], "on") == 0 || strcmp(cmd.args[0], "off") == 0)) {
      frames_out = strcmp(cmd.args[0], "on") == 0;
      ack(cmd.id, text, AckStatus::Ok, frames_out ? "raw frame output on" : "raw frame output off");
    } else {
      ack(cmd.id, text, AckStatus::Rejected, "usage: frames on|off");
    }
  } else if (strcmp(cmd.verb, "silence") == 0) {
    buzzer.silence();
    ack(cmd.id, text, AckStatus::Ok,
        MONITOR_BUZZER_ENABLED ? "buzzer silenced until the next new critical fault"
                               : "buzzer is disabled in this build; alarm state acknowledged");
  } else if (strcmp(cmd.verb, "recover") == 0) {
    const char* why = "";
    const bool ok = request_recovery(&why);
    ack(cmd.id, text, ok ? AckStatus::Ok : AckStatus::Rejected, why);
  } else if (strcmp(cmd.verb, "set") == 0 || strcmp(cmd.verb, "fault") == 0 || strcmp(cmd.verb, "profile") == 0) {
    ack(cmd.id, text, AckStatus::Unsupported, "ECU command: send it to Node 1 or Node 2, not the monitor");
  } else {
    ack(cmd.id, text, AckStatus::Unsupported, "unsupported command (try help)");
  }
}

}  // namespace

void setup() {
  // Safe output states first: LEDs off; buzzer pin untouched unless enabled.
  pinMode(MONITOR_LED_GREEN_GPIO, OUTPUT);
  pinMode(MONITOR_LED_YELLOW_GPIO, OUTPUT);
  pinMode(MONITOR_LED_RED_GPIO, OUTPUT);
  set_leds(LedState{false, false, false});
#if MONITOR_BUZZER_ENABLED
  pinMode(MONITOR_BUZZER_GPIO, OUTPUT);
  digitalWrite(MONITOR_BUZZER_GPIO, LOW);
#endif
  pinMode(MONITOR_BUTTON_A_GPIO, INPUT_PULLUP);
  pinMode(MONITOR_BUTTON_B_GPIO, INPUT_PULLUP);

  Serial.setRxBufferSize(512);
  Serial.setTxBufferSize(4096);
  Serial.begin(proto::kSerialBaud);
  delay(200);
  format_boot_id(esp_random(), boot_id);
  boot_ms = millis();

  const ConfigValidation validation = validate_config(monitor_cfg::kCanConfig);
  emit_banner(kBanner, monitor_cfg::kCanConfig, validation, serial_sink, nullptr);
  Serial.printf("# boot %s  serial %lu baud  protocol v%u\n", boot_id, static_cast<unsigned long>(proto::kSerialBaud),
                proto::kProtocolVersion);
  Serial.printf("# pins [PROVISIONAL, ledger]: OLED SDA %d SCL %d | LED G %d Y %d R %d | BTN A %d B %d | BUZ %d (%s)\n",
                MONITOR_I2C_SDA_GPIO, MONITOR_I2C_SCL_GPIO, MONITOR_LED_GREEN_GPIO, MONITOR_LED_YELLOW_GPIO,
                MONITOR_LED_RED_GPIO, MONITOR_BUTTON_A_GPIO, MONITOR_BUTTON_B_GPIO, MONITOR_BUZZER_GPIO,
                MONITOR_BUZZER_ENABLED ? "enabled" : "DISABLED: gate G10 open");

  Wire.begin(MONITOR_I2C_SDA_GPIO, MONITOR_I2C_SCL_GPIO);
  Wire.setClock(400000);
  oled_init();

  const uint32_t now = millis();
  const bool a_low = digitalRead(MONITOR_BUTTON_A_GPIO) == LOW;
  const bool b_low = digitalRead(MONITOR_BUTTON_B_GPIO) == LOW;
  button_a_stuck = a_low;
  button_b_stuck = b_low;
  button_a.reset(a_low, now);
  button_b.reset(b_low, now);
  if (a_low || b_low) {
    Serial.printf("# WARNING: button %s reads pressed at boot (held, stuck, or wired to 3V3/GND wrongly);"
                  " ignored until released\n", a_low && b_low ? "A and B" : (a_low ? "A" : "B"));
  }

  core.set_sink(on_fault, nullptr);
  core.begin(now);

  if (!validation.ok()) {
    can_init = TransportResult::ConfigInvalid;
  } else {
    can_init = transport.begin(monitor_cfg::kCanConfig);
  }
  emit_init_result(can_init, transport.last_driver_error(), serial_sink, nullptr);
  can_ok = can_init == TransportResult::Ok;

  print_hello();
  print_selftest();
  last_hello_ms = millis();
#if MONITOR_BUZZER_ENABLED
  buzzer.chirp(millis(), 100);  // audible start-up check
#endif
}

void loop() {
  const uint32_t now = millis();

  // 1. Host commands.
  for (size_t i = 0; i < kMaxSerialBytesPerLoop && Serial.available() > 0; ++i) {
    const int c = Serial.read();
    if (c < 0) break;
    const LineAssembler::Result r = lines.feed(static_cast<char>(c));
    if (r == LineAssembler::Result::Line) {
      handle_line(lines.line(), now);
    } else if (r == LineAssembler::Result::Overflow) {
      ack("", "", AckStatus::Rejected, "line longer than 120 characters (discarded)");
    }
  }

  // 2. Controller state first, so frames and timeouts see the current state.
  if (can_ok) {
    bus = transport.poll_status();
    const uint32_t alerts = transport.last_alerts();
    if (alerts & TWAI_ALERT_BUS_OFF) {
      Serial.println("# ALERT: monitor BUS-OFF. Recovery is manual: Button B long press or 'recover'.");
    }
    if (alerts & TWAI_ALERT_BUS_RECOVERED) Serial.println("# ALERT: bus-off recovery complete, restarting");
    if (alerts & TWAI_ALERT_ERR_PASS) Serial.println("# ALERT: monitor error passive");
    if (alerts & TWAI_ALERT_RX_QUEUE_FULL) Serial.println("# ALERT: RX queue full, frames dropped");
  }
  ControllerSnapshot snap = {can_ok && bus.driver_running, can_ok ? bus.state : BusState::Stopped,
                             can_ok ? bus.rx_missed : 0, bus.tx_error_counter, bus.rx_error_counter};
  core.on_controller(snap, now);

  // 3. Received frames.
  if (can_ok) {
    RawFrame frame;
    char line[384];
    for (size_t i = 0; i < kMaxRxPerLoop; ++i) {
      if (transport.receive(frame, 0) != TransportResult::Ok) break;
      const FrameVerdict v = core.on_frame(frame, millis());
      if (frames_out && encode_monitor_frame(frame, v, line, sizeof(line))) Serial.println(line);
    }
  }

  // 4. Timeouts, then telemetry events (rate-limited; immediately on a state change).
  core.tick(now);
  for (uint8_t node = 1; node <= 2; ++node) {
    const bool fresh = core.ecu(node).stats.telemetry_frames != tel_count_at_event[node];
    const uint32_t age = now - last_tel_event_ms[node];
    if ((fresh && age >= proto::kSerialTelemetryEventMinPeriodMs) || age >= proto::kSerialStatusPeriodMs) {
      print_telemetry(node, now);
    }
  }

  // 5. Buttons. A: short = next OLED page. B: short = silence, long = bus-off recovery.
  const Button::Event ea = button_a.update(digitalRead(MONITOR_BUTTON_A_GPIO) == LOW, now);
  const Button::Event eb = button_b.update(digitalRead(MONITOR_BUTTON_B_GPIO) == LOW, now);
  if (!button_a.pressed()) button_a_stuck = false;
  if (!button_b.pressed()) button_b_stuck = false;
  if (ea == Button::Event::ShortPress) {
    page = static_cast<uint8_t>((page + 1) % kOledPageCount);
    last_oled_ms = 0;
    Serial.printf("# button A: OLED page %u\n", page);
  }
  if (eb == Button::Event::ShortPress) {
    buzzer.silence();
    Serial.println("# button B: alarm silenced");
  } else if (eb == Button::Event::LongPress) {
    const char* why = "";
    request_recovery(&why);
    Serial.printf("# button B long press: %s\n", why);
  }

  // 6. Indicators.
  proto::Severity worst = proto::Severity::Info;
  const bool any = core.worst_active(worst);
  if (core.last_critical_raise_id() > alarm_seen_event) {
    alarm_seen_event = core.last_critical_raise_id();
    buzzer.on_new_critical(now);
  }
  LedState leds;
  if (!lamp_test(now - boot_ms, leds)) {
    const bool nodes_ok = core.heartbeat_state(1) == LinkState::Ok && core.telemetry_state(1) == LinkState::Ok &&
                          core.heartbeat_state(2) == LinkState::Ok && core.telemetry_state(2) == LinkState::Ok;
    IndicatorInput in = {core.monitoring(), any, worst, nodes_ok};
    leds = compute_leds(in, now);
  }
  set_leds(leds);
  set_buzzer(buzzer.output(any && worst == proto::Severity::Critical, now));

  // 7. OLED and periodic serial lines.
  if (!oled_ok && now - last_oled_probe_ms >= kOledRetryMs) oled_init();
  if (now - last_oled_ms >= kOledRefreshMs) {
    last_oled_ms = now;
    oled_draw(now);
  }
  if (now - last_status_ms >= proto::kSerialStatusPeriodMs) {
    last_status_ms = now;
    print_status();
    print_health(now);
  }
  if (now - last_hello_ms >= proto::kSerialHelloPeriodMs) {
    last_hello_ms = now;
    print_hello();
  }
  delay(1);
}
