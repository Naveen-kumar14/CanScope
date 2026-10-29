#include "monitor_ui.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

namespace canscope {

using proto::FaultCode;

// --------------------------------------------------------------------- LEDs

LedState compute_leds(const IndicatorInput& in, uint32_t now_ms) {
  LedState s = {false, false, false};
  if (!in.can_running) {
    s.red = (now_ms / 125) % 2 == 0;  // 4 Hz
    return s;
  }
  if (in.any_fault && in.worst == proto::Severity::Critical) {
    s.red = true;
    return s;
  }
  if (in.any_fault && in.worst == proto::Severity::Warning) {
    s.yellow = true;
    return s;
  }
  s.green = in.all_nodes_ok ? true : (now_ms / 500) % 2 == 0;  // 1 Hz while waiting
  return s;
}

bool lamp_test(uint32_t elapsed_ms, LedState& out) {
  out.green = elapsed_ms < 250;
  out.yellow = elapsed_ms >= 250 && elapsed_ms < 500;
  out.red = elapsed_ms >= 500 && elapsed_ms < 750;
  return elapsed_ms < 750;
}

// --------------------------------------------------------- commanded faults

CommandedFaults::CommandedFaults() { clear_all(); }

bool CommandedFaults::set(uint8_t node_id, proto::DemoFault fault) {
  if (node_id != proto::kNodeIdNode1 && node_id != proto::kNodeIdNode2) return false;
  fault_[node_id - 1] = fault;
  return true;
}

void CommandedFaults::clear_all() {
  fault_[0] = proto::DemoFault::None;
  fault_[1] = proto::DemoFault::None;
}

proto::DemoFault CommandedFaults::get(uint8_t node_id) const {
  if (node_id != proto::kNodeIdNode1 && node_id != proto::kNodeIdNode2) return proto::DemoFault::None;
  return fault_[node_id - 1];
}

bool CommandedFaults::any() const {
  return fault_[0] != proto::DemoFault::None || fault_[1] != proto::DemoFault::None;
}

namespace {

bool parse_ecu(const char* name, uint8_t& node_id) {
  if (strcmp(name, "node1") == 0) {
    node_id = proto::kNodeIdNode1;
  } else if (strcmp(name, "node2") == 0) {
    node_id = proto::kNodeIdNode2;
  } else {
    return false;
  }
  return true;
}

}  // namespace

AckStatus apply_display_command(CommandedFaults& commanded, const Command& cmd, const char** detail) {
  uint8_t node = 0;
  if (cmd.argc == 1 && strcmp(cmd.args[0], "clear") == 0) {
    commanded.clear_all();
    *detail = "OLED: commanded faults cleared (display only)";
    return AckStatus::Ok;
  }
  if (cmd.argc == 2 && strcmp(cmd.args[0], "clear") == 0 && parse_ecu(cmd.args[1], node)) {
    commanded.set(node, proto::DemoFault::None);
    *detail = "OLED: commanded fault cleared (display only)";
    return AckStatus::Ok;
  }
  if (cmd.argc == 3 && strcmp(cmd.args[0], "fault") == 0 && parse_ecu(cmd.args[1], node)) {
    proto::DemoFault fault = proto::DemoFault::None;
    if (!proto::parse_demo_fault(cmd.args[2], fault)) {
      *detail = "unknown demo fault";
      return AckStatus::Rejected;
    }
    const bool same = commanded.get(node) == fault;
    commanded.set(node, fault);
    if (fault == proto::DemoFault::None) {
      *detail = "OLED: commanded fault cleared (display only)";
    } else {
      *detail = same ? "OLED: commanded fault already shown (display only, not a detection)"
                     : "OLED: commanded fault shown (display only, not a detection)";
    }
    return AckStatus::Ok;
  }
  *detail = "usage: display fault node1|node2 <demo fault> | display clear [node1|node2]";
  return AckStatus::Rejected;
}

// --------------------------------------------------------------------- OLED

namespace {

void put(OledLines& out, size_t row, const char* fmt, ...) {
  if (row >= kOledRows) return;
  char tmp[64];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(tmp, sizeof(tmp), fmt, ap);
  va_end(ap);
  size_t n = strlen(tmp);
  if (n > kOledCols) n = kOledCols;
  memcpy(out.line[row], tmp, n);
  for (size_t i = n; i < kOledCols; ++i) out.line[row][i] = ' ';
  out.line[row][kOledCols] = '\0';
}

const char* link_text(LinkState s) {
  switch (s) {
    case LinkState::Unknown: return "??";
    case LinkState::Waiting: return "..";
    case LinkState::Ok: return "ok";
    case LinkState::Lost: return "LOST";
  }
  return "??";
}

const char* bus_text(BusState s) {
  switch (s) {
    case BusState::Unknown: return "UNKNOWN";
    case BusState::Stopped: return "STOPPED";
    case BusState::ErrorActive: return "ERR-ACTIVE";
    case BusState::ErrorWarning: return "ERR-WARN";
    case BusState::ErrorPassive: return "ERR-PASSIVE";
    case BusState::BusOff: return "BUS-OFF";
    case BusState::Recovering: return "RECOVERING";
  }
  return "?";
}

void scaled(const MonitorCore& core, uint8_t node, proto::FieldId id, char* out, size_t len) {
  const EcuTrack& t = core.ecu(node);
  if (!t.tel_seen) {
    snprintf(out, len, "--");
    return;
  }
  proto::format_scaled(t.values[static_cast<size_t>(id)], proto::field_info(id).decimals, out, len);
}

void summary(const OledInput& in, OledLines& out) {
  const MonitorCore& c = *in.core;
  proto::Severity worst = proto::Severity::Info;
  const bool any = c.worst_active(worst);
  const size_t n = c.active_count();
  const char* state = "OK";
  char buf[16];
  if (!in.can_running) {
    state = in.bus_state == BusState::BusOff || in.bus_state == BusState::Recovering ? "BUS-OFF" : "CAN DOWN";
  } else if (any) {
    snprintf(buf, sizeof(buf), "%s %u", worst == proto::Severity::Critical ? "CRIT" : "WARN",
             static_cast<unsigned>(n));
    state = buf;
  }
  put(out, 0, "CANScope MON %8s", state);

  const uint8_t n1 = proto::kNodeIdNode1;
  const uint8_t n2 = proto::kNodeIdNode2;
  put(out, 1, "N1 HB:%-4s TEL:%-4s", link_text(c.heartbeat_state(n1)), link_text(c.telemetry_state(n1)));
  char a[12];
  char b[12];
  char d[12];
  scaled(c, n1, proto::FieldId::Rpm, a, sizeof(a));
  scaled(c, n1, proto::FieldId::MotorTempC, b, sizeof(b));
  put(out, 2, " %5srpm %6sC", a, b);
  put(out, 3, "N2 HB:%-4s TEL:%-4s", link_text(c.heartbeat_state(n2)), link_text(c.telemetry_state(n2)));
  scaled(c, n2, proto::FieldId::PackVoltageV, a, sizeof(a));
  scaled(c, n2, proto::FieldId::PackCurrentA, b, sizeof(b));
  scaled(c, n2, proto::FieldId::SocPct, d, sizeof(d));
  put(out, 4, " %sV %sA %s%%", a, b, d);

  // First active fault, most severe first.
  const char* first = "none";
  const char* where = "";
  bool found = false;
  const uint8_t nodes[3] = {proto::kNodeIdMonitor, n1, n2};
  for (int sev = 2; sev >= 0 && !found; --sev) {
    for (size_t i = 0; i < proto::kFaultCount && !found; ++i) {
      if (static_cast<int>(proto::kFaults[i].severity) != sev) continue;
      const FaultCode code = static_cast<FaultCode>(i);
      for (size_t k = 0; k < 3 && !found; ++k) {
        if (!c.active(code, nodes[k])) continue;
        first = fault_short_name(code);
        where = k == 0 ? "MON" : (k == 1 ? "N1" : "N2");
        found = true;
      }
    }
  }
  put(out, 5, "F:%u %s %s", static_cast<unsigned>(n), where, first);
  put(out, 6, "%s rx%lu", bus_text(in.bus_state), static_cast<unsigned long>(c.total_frames()));
  put(out, 7, "up %lus", static_cast<unsigned long>(in.uptime_s));
}

void faults_page(const OledInput& in, OledLines& out) {
  const MonitorCore& c = *in.core;
  put(out, 0, "ACTIVE FAULTS (%u)", static_cast<unsigned>(c.active_count()));
  size_t row = 1;
  const uint8_t nodes[3] = {proto::kNodeIdMonitor, proto::kNodeIdNode1, proto::kNodeIdNode2};
  for (int sev = 2; sev >= 0; --sev) {
    for (size_t i = 0; i < proto::kFaultCount; ++i) {
      if (static_cast<int>(proto::kFaults[i].severity) != sev) continue;
      for (size_t k = 0; k < 3; ++k) {
        const FaultCode code = static_cast<FaultCode>(i);
        if (!c.active(code, nodes[k])) continue;
        if (row < kOledRows) {
          put(out, row, "%c %-3s %s", sev == 2 ? '!' : '-', k == 0 ? "MON" : (k == 1 ? "N1" : "N2"),
              fault_short_name(code));
        }
        ++row;
      }
    }
  }
  if (row == 1) put(out, row++, "none");
  if (row > kOledRows) put(out, kOledRows - 1, "+%u more", static_cast<unsigned>(row - kOledRows + 1));
  for (; row < kOledRows; ++row) put(out, row, "");
}

// Commanded-fault view: only the ECUs the dashboard commanded a fault on and
// the readable fault names, e.g. "Node 1:" / "  HEARTBEAT LOST". It reads
// CommandedFaults only; MonitorCore's detections, the bus state and the fault
// counts stay on the summary, faults and bus pages.
const size_t kNameIndent = 2;
const size_t kMaxNameLines = 2;

// Splits `text` at spaces into lines of at most `width` characters (a word
// longer than `width` is cut). Returns the number of lines written.
size_t wrap(const char* text, size_t width, char lines[][kOledCols + 1], size_t max_lines) {
  size_t count = 0;
  const char* p = text;
  while (*p && count < max_lines) {
    while (*p == ' ') ++p;
    if (!*p) break;
    size_t take = strlen(p);
    if (take > width) {
      take = width;
      while (take > 0 && p[take] != ' ') --take;
      if (take == 0) take = width;
    }
    memcpy(lines[count], p, take);
    lines[count][take] = '\0';
    ++count;
    p += take;
  }
  return count;
}

// Two ECUs x (1 label + 2 name lines) + 1 blank separator = 7 rows <= 8.
void commanded_view(const CommandedFaults& cf, OledLines& out) {
  size_t row = 0;
  for (uint8_t node = proto::kNodeIdNode1; node <= proto::kNodeIdNode2; ++node) {
    const proto::DemoFault f = cf.get(node);
    if (f == proto::DemoFault::None) continue;
    if (row > 0) ++row;  // blank line between ECUs
    char lines[kMaxNameLines][kOledCols + 1];
    const size_t n = wrap(demo_fault_display_name(f), kOledCols - kNameIndent, lines, kMaxNameLines);
    put(out, row++, "Node %u:", static_cast<unsigned>(node));
    for (size_t l = 0; l < n; ++l) put(out, row++, "  %s", lines[l]);
  }
}

void bus_page(const OledInput& in, OledLines& out) {
  const MonitorCore& c = *in.core;
  put(out, 0, "BUS %s", bus_text(in.bus_state));
  put(out, 1, "TEC %lu  REC %lu", static_cast<unsigned long>(in.tec), static_cast<unsigned long>(in.rec));
  put(out, 2, "RX frames %lu", static_cast<unsigned long>(c.total_frames()));
  put(out, 3, "Unknown IDs %lu", static_cast<unsigned long>(c.unknown_frames()));
  put(out, 4, "RX missed %lu", static_cast<unsigned long>(in.rx_missed));
  for (uint8_t node = 1; node <= 2; ++node) {
    const EcuStats& s = c.ecu(node).stats;
    put(out, 4 + node, "N%u rej%lu gap%lu", node, static_cast<unsigned long>(s.rejected_frames),
        static_cast<unsigned long>(s.sequence_gaps));
  }
  put(out, 7, "up %lus", static_cast<unsigned long>(in.uptime_s));
}

}  // namespace

uint8_t oled_page_for(uint32_t now_ms, bool commanded_active) {
  if (commanded_active) return 0;
  return static_cast<uint8_t>((now_ms / kOledPagePeriodMs) % kOledPageCount);
}

void render_oled_page(uint8_t page, const OledInput& in, OledLines& out) {
  for (size_t r = 0; r < kOledRows; ++r) put(out, r, "");
  switch (page % kOledPageCount) {
    case 0:
      if (in.commanded && in.commanded->any()) {
        commanded_view(*in.commanded, out);
      } else {
        summary(in, out);
      }
      break;
    case 1: faults_page(in, out); break;
    default: bus_page(in, out); break;
  }
}

const char* fault_short_name(FaultCode code) {
  switch (code) {
    case FaultCode::HeartbeatLost: return "HB LOST";
    case FaultCode::TelemetryStale: return "TEL STALE";
    case FaultCode::InvalidDlc: return "BAD DLC";
    case FaultCode::ChecksumError: return "CHECKSUM";
    case FaultCode::CounterFrozen: return "CTR FROZEN";
    case FaultCode::ValueInvalid: return "BAD VALUE";
    case FaultCode::ProtocolVersionMismatch: return "PROTO VER";
    case FaultCode::EcuCanErrorPassive: return "ECU ERR-PASS";
    case FaultCode::MotorTempHigh: return "TEMP HIGH";
    case FaultCode::MotorOvertemp: return "OVERTEMP";
    case FaultCode::MotorOverspeed: return "OVERSPEED";
    case FaultCode::BatteryUndervoltage: return "UNDERVOLT";
    case FaultCode::BatteryOvervoltage: return "OVERVOLT";
    case FaultCode::BatteryOvercurrent: return "OVERCURRENT";
    case FaultCode::BatterySocLow: return "SOC LOW";
    case FaultCode::MonitorCanNotRunning: return "CAN DOWN";
    case FaultCode::MonitorBusOff: return "BUS-OFF";
    case FaultCode::MonitorErrorPassive: return "ERR-PASSIVE";
    case FaultCode::MonitorRxOverrun: return "RX OVERRUN";
    case FaultCode::BusSilent: return "BUS SILENT";
    case FaultCode::Count: break;
  }
  return "?";
}

const char* demo_fault_display_name(proto::DemoFault fault) {
  switch (fault) {
    case proto::DemoFault::None: return "NONE";
    case proto::DemoFault::HeartbeatStop: return "HEARTBEAT LOST";
    case proto::DemoFault::TelemetryStop: return "TELEMETRY LOST";
    case proto::DemoFault::Silent: return "ECU SILENT";
    case proto::DemoFault::InvalidValue: return "INVALID VALUE";
    case proto::DemoFault::BadDlc: return "BAD FRAME LENGTH";
    case proto::DemoFault::BadChecksum: return "BAD CHECKSUM";
    case proto::DemoFault::CounterFreeze: return "COUNTER FROZEN";
    case proto::DemoFault::BadVersion: return "PROTOCOL VERSION MISMATCH";
    case proto::DemoFault::Count: break;
  }
  return "?";
}

}  // namespace canscope
