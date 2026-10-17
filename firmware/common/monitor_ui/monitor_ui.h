// Node 3 peripheral logic, independent of the hardware drivers: button
// debouncing, LED policy, buzzer pattern and the OLED page text. Portable
// C++11 with an explicit millisecond clock; the ESP32 code in
// firmware/monitor/src only copies these results to GPIOs and the display.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "monitor_core.h"
#include "raw_frame.h"

namespace canscope {

// Debounced active-high "pressed" input with short/long press events.
class Button {
 public:
  enum class Event : uint8_t { None, ShortPress, LongPress };

  explicit Button(uint32_t debounce_ms = 30, uint32_t long_press_ms = 1500);
  // raw_pressed: the electrical reading already converted to "pressed" (the
  // board buttons are active LOW, so the caller passes digitalRead() == LOW).
  Event update(bool raw_pressed, uint32_t now_ms);
  bool pressed() const { return stable_; }
  void reset(bool raw_pressed, uint32_t now_ms);

 private:
  uint32_t debounce_ms_;
  uint32_t long_press_ms_;
  bool stable_;
  bool last_raw_;
  uint32_t changed_at_;
  uint32_t pressed_at_;
  bool long_fired_;
};

struct LedState {
  bool green;
  bool yellow;
  bool red;
};

struct IndicatorInput {
  bool can_running;  // monitor controller running and not bus-off
  bool any_fault;
  proto::Severity worst;
  bool all_nodes_ok;  // both ECUs: heartbeat ok and telemetry ok
};

// Green: running, both ECUs healthy, no faults (blinks while waiting for nodes).
// Yellow: worst active fault is a warning. Red: a critical fault is active.
// Red fast blink: the monitor's own CAN controller is not running / bus-off.
LedState compute_leds(const IndicatorInput& in, uint32_t now_ms);

// Start-up lamp test: green, yellow, red for 250 ms each, then all off.
// Returns false once the sequence has finished.
bool lamp_test(uint32_t elapsed_ms, LedState& out);

// Alarm pattern for the buzzer (driven through the Q1 low-side transistor;
// never directly from a GPIO). A new critical fault starts 3 beeps that repeat
// every 10 s while any critical fault is active, until silenced. A silenced
// alarm re-arms on the next newly raised critical fault.
class Buzzer {
 public:
  Buzzer();
  void on_new_critical(uint32_t now_ms);
  void chirp(uint32_t now_ms, uint32_t duration_ms = 80);
  void silence();
  bool silenced() const { return silenced_; }
  bool output(bool critical_active, uint32_t now_ms);

 private:
  bool alarm_;
  bool silenced_;
  uint32_t alarm_start_ms_;
  bool chirp_active_;
  uint32_t chirp_until_ms_;
};

static const size_t kOledCols = 21;  // 128 px / 6 px font
static const size_t kOledRows = 8;   // 64 px / 8 px font
static const uint8_t kOledPageCount = 3;

struct OledLines {
  char line[kOledRows][kOledCols + 1];
};

struct OledInput {
  const MonitorCore* core;
  bool can_running;
  BusState bus_state;
  uint32_t tec;
  uint32_t rec;
  uint32_t rx_missed;
  uint32_t uptime_s;
  bool buzzer_enabled;
  bool buzzer_silenced;
  uint32_t now_ms;
};

// Page 0 summary, 1 active faults, 2 bus statistics. Lines are space-padded
// to exactly kOledCols characters.
void render_oled_page(uint8_t page, const OledInput& in, OledLines& out);

// Short (<= 14 chars) label for the OLED.
const char* fault_short_name(proto::FaultCode code);

}  // namespace canscope
