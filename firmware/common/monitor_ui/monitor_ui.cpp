#include "monitor_ui.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

namespace canscope {

using proto::FaultCode;

// ------------------------------------------------------------------- Button

Button::Button(uint32_t debounce_ms, uint32_t long_press_ms)
    : debounce_ms_(debounce_ms),
      long_press_ms_(long_press_ms),
      stable_(false),
      last_raw_(false),
      changed_at_(0),
      pressed_at_(0),
      long_fired_(false) {}

void Button::reset(bool raw_pressed, uint32_t now_ms) {
  stable_ = raw_pressed;
  last_raw_ = raw_pressed;
  changed_at_ = now_ms;
  pressed_at_ = now_ms;
  long_fired_ = raw_pressed;  // a button held at reset never fires
}

Button::Event Button::update(bool raw_pressed, uint32_t now_ms) {
  if (raw_pressed != last_raw_) {
    last_raw_ = raw_pressed;
    changed_at_ = now_ms;
  }
  if (raw_pressed != stable_ && now_ms - changed_at_ >= debounce_ms_) {
    stable_ = raw_pressed;
    if (stable_) {
      pressed_at_ = now_ms;
      long_fired_ = false;
    } else {
      const bool was_long = long_fired_;
      long_fired_ = false;
      if (!was_long) return Event::ShortPress;
    }
  }
  if (stable_ && !long_fired_ && now_ms - pressed_at_ >= long_press_ms_) {
    long_fired_ = true;
    return Event::LongPress;
  }
  return Event::None;
}

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

// ------------------------------------------------------------------- Buzzer

namespace {
const uint32_t kBeepMs = 150;
const uint32_t kBeeps = 3;
const uint32_t kAlarmRepeatMs = 10000;
}  // namespace

Buzzer::Buzzer()
    : alarm_(false), silenced_(false), alarm_start_ms_(0), chirp_active_(false), chirp_until_ms_(0) {}

void Buzzer::on_new_critical(uint32_t now_ms) {
  alarm_ = true;
  silenced_ = false;
  alarm_start_ms_ = now_ms;
}

void Buzzer::chirp(uint32_t now_ms, uint32_t duration_ms) {
  chirp_active_ = true;
  chirp_until_ms_ = now_ms + duration_ms;
}

void Buzzer::silence() {
  silenced_ = true;
  chirp_active_ = false;
}

bool Buzzer::output(bool critical_active, uint32_t now_ms) {
  if (chirp_active_) {
    if (static_cast<int32_t>(now_ms - chirp_until_ms_) < 0) return true;
    chirp_active_ = false;
  }
  if (!critical_active) alarm_ = false;
  if (!alarm_ || silenced_) return false;
  const uint32_t t = (now_ms - alarm_start_ms_) % kAlarmRepeatMs;
  if (t >= kBeeps * 2 * kBeepMs) return false;
  return (t / kBeepMs) % 2 == 0;
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
  put(out, 7, "A:page B:%s", !in.buzzer_enabled ? "mute(off)" : (in.buzzer_silenced ? "muted" : "silence"));
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

void render_oled_page(uint8_t page, const OledInput& in, OledLines& out) {
  for (size_t r = 0; r < kOledRows; ++r) put(out, r, "");
  switch (page % kOledPageCount) {
    case 0: summary(in, out); break;
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

}  // namespace canscope
