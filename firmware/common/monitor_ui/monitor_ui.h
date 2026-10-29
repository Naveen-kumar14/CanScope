// Node 3 peripheral logic, independent of the hardware drivers: LED policy,
// the "display" command (commanded faults), OLED page rotation and the OLED
// page text. Portable C++11 with an explicit millisecond clock; the ESP32 code
// in firmware/monitor/src only copies these results to GPIOs and the display.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "monitor_core.h"
#include "raw_frame.h"
#include "serial_link.h"

namespace canscope {

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

// Demo faults the dashboard reports it commanded on an ECU (the monitor's
// "display" command, sent after the ECU acknowledged "fault ..."). OLED
// presentation only: never an input to MonitorCore, never counted or reported
// as a detection. MonitorCore stays the only source of detected faults.
class CommandedFaults {
 public:
  CommandedFaults();
  // node_id 1 or 2; DemoFault::None clears. False for any other node.
  bool set(uint8_t node_id, proto::DemoFault fault);
  void clear_all();
  proto::DemoFault get(uint8_t node_id) const;
  bool any() const;

 private:
  proto::DemoFault fault_[2];
};

// Applies "display fault <node1|node2> <demo fault>", "display clear
// <node1|node2>" or "display clear". *detail is the ack text. Ok or Rejected;
// a rejected command changes nothing, and repeating a command is harmless.
AckStatus apply_display_command(CommandedFaults& commanded, const Command& cmd, const char** detail);

static const size_t kOledCols = 21;  // 128 px / 6 px font
static const size_t kOledRows = 8;   // 64 px / 8 px font
static const uint8_t kOledPageCount = 3;
static const uint32_t kOledPagePeriodMs = 5000;  // automatic page rotation

// Node 3 has no buttons: the OLED turns pages by itself, summary -> faults ->
// bus, kOledPagePeriodMs each. While a commanded fault is set the page stays
// on 0 (the commanded-fault view) so it is never hidden. At the 49.7-day
// millis() wrap the rotation may skip one page once; nothing else is affected.
uint8_t oled_page_for(uint32_t now_ms, bool commanded_active);

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
  uint32_t now_ms;
  const CommandedFaults* commanded;  // may be null
};

// Page 0 summary, 1 active faults, 2 bus statistics. While a commanded fault
// is set (in.commanded->any()) page 0 shows the commanded-fault view instead
// of the summary: "Node n:" and the readable fault name for each ECU, nothing
// else. Detected faults, bus state and counts stay on the summary (when no
// commanded fault is set), faults and bus pages. Lines are space-padded to
// exactly kOledCols characters.
void render_oled_page(uint8_t page, const OledInput& in, OledLines& out);

// Short (<= 14 chars) label for the OLED.
const char* fault_short_name(proto::FaultCode code);

// Readable name of a commanded demo fault for the OLED (word-wrapped there,
// at most 2 lines of kOledCols - 2 characters).
const char* demo_fault_display_name(proto::DemoFault fault);

}  // namespace canscope
