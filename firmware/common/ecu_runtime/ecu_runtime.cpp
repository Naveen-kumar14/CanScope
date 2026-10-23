#include "ecu_runtime.h"

#if defined(ARDUINO) && defined(ESP_PLATFORM)

#include <stdio.h>
#include <string.h>

#include "driver/twai.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "protocol_spec.h"

namespace canscope {

namespace {

const size_t kMaxRxPerLoop = 16;
const size_t kMaxSerialBytesPerLoop = 256;

void serial_sink(const char* line, void*) { Serial.println(line); }

uint64_t now_us() { return static_cast<uint64_t>(esp_timer_get_time()); }

}  // namespace

EcuRuntime::EcuRuntime(const CanConfig& cfg, const BannerInfo& banner, const EcuIdentity& id)
    : cfg_(cfg),
      banner_(banner),
      id_(id),
      core_(id.node_id, id.fw_major, id.fw_minor, id.fw_patch),
      status_(empty_bus_status()),
      can_ok_(false),
      last_status_ms_(0),
      last_state_ms_(0),
      last_hello_ms_(0),
      tx_ok_(0),
      tx_failed_(0),
      rx_ignored_(0),
      last_tx_error_(TransportResult::Ok) {
  boot_id_[0] = '\0';
  snprintf(commands_, sizeof(commands_), "hello status help recover %s", EcuCore::verbs());
}

uint8_t EcuRuntime::can_state_for(BusState state) {
  switch (state) {
    case BusState::ErrorWarning: return 1;
    case BusState::ErrorPassive:
    case BusState::BusOff:
    case BusState::Recovering: return 2;
    default: return 0;
  }
}

void EcuRuntime::setup() {
  format_boot_id(esp_random(), boot_id_);

  const ConfigValidation validation = validate_config(cfg_);
  emit_banner(banner_, cfg_, validation, serial_sink, nullptr);
  Serial.printf("# role: %s  node id %u  boot %s  serial %lu baud\n", id_.role, id_.node_id, boot_id_,
                static_cast<unsigned long>(proto::kSerialBaud));
  Serial.println("# commands: @<id> set <param> <value> | profile static|drive | fault <name>|clear |"
                 " hello | status | help | recover");

  if (!validation.ok()) {
    emit_init_result(TransportResult::ConfigInvalid, 0, serial_sink, nullptr);
  } else {
    const TransportResult result = transport_.begin(cfg_);
    emit_init_result(result, transport_.last_driver_error(), serial_sink, nullptr);
    can_ok_ = result == TransportResult::Ok;
    Serial.printf("# CAN transceiver echo check: %s - %s\n", transceiver_check_name(transport_.transceiver_check()),
                  transceiver_check_hint(transport_.transceiver_check()));
  }
  if (can_ok_ && !tx_permitted(cfg_)) {
    Serial.println("# WARNING: ENABLE_TX=false - this ECU will not put any frame on the bus");
  }
  const uint32_t now = millis();
  core_.begin(now);
  print_hello();
  last_hello_ms_ = now;
}

void EcuRuntime::loop() {
  const uint32_t now = millis();

  for (size_t i = 0; i < kMaxSerialBytesPerLoop && Serial.available() > 0; ++i) {
    const int c = Serial.read();
    if (c < 0) break;
    const LineAssembler::Result r = lines_.feed(static_cast<char>(c));
    if (r == LineAssembler::Result::Line) {
      handle_line(lines_.line(), now);
    } else if (r == LineAssembler::Result::Overflow) {
      ack("", "", AckStatus::Rejected, "line longer than 120 characters (discarded)");
    }
  }

  if (can_ok_) {
    status_ = transport_.poll_status();
    if (transport_.last_alerts()) print_alerts(transport_.last_alerts());
    core_.set_can_state(can_state_for(status_.state));
    transmit_due(now);
    drain_rx();
  }  // CAN not running: nothing is scheduled, so no frame counter moves.

  if (now - last_status_ms_ >= proto::kSerialStatusPeriodMs) {
    last_status_ms_ = now;
    print_status();
    print_ecu_state();
  }
  if (now - last_hello_ms_ >= proto::kSerialHelloPeriodMs) {
    last_hello_ms_ = now;
    print_hello();
  }
  delay(1);
}

void EcuRuntime::transmit_due(uint32_t now_ms) {
  RawFrame frames[2];
  const size_t n = core_.poll(now_ms, frames, 2);
  for (size_t i = 0; i < n; ++i) {
    frames[i].source_node = cfg_.node_name;
    // Non-blocking: a full TX queue (e.g. no other node ACKs) must not stall
    // the command link. The failure is counted and reported, never hidden.
    const TransportResult r = transport_.transmit(frames[i], 0);
    if (r == TransportResult::Ok) {
      ++tx_ok_;
    } else {
      ++tx_failed_;
      if (r != last_tx_error_) {
        Serial.printf("# TX failed: %s (0x%03lX); counted in ecu_state.txFailed\n", transport_result_name(r),
                      static_cast<unsigned long>(frames[i].can_id));
      }
    }
    last_tx_error_ = r;
  }
}

void EcuRuntime::drain_rx() {
  RawFrame frame;
  for (size_t i = 0; i < kMaxRxPerLoop; ++i) {
    if (transport_.receive(frame, 0) != TransportResult::Ok) break;
    ++rx_ignored_;  // an ECU acknowledges other nodes' frames but does not use them
  }
}

void EcuRuntime::handle_line(const char* line, uint32_t now_ms) {
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

  if (strcmp(cmd.verb, "hello") == 0) {
    print_hello();
    ack(cmd.id, text, AckStatus::Ok, "hello sent");
  } else if (strcmp(cmd.verb, "status") == 0) {
    print_status();
    print_ecu_state();
    ack(cmd.id, text, AckStatus::Ok, "status sent");
  } else if (strcmp(cmd.verb, "help") == 0) {
    ack(cmd.id, text, AckStatus::Ok,
        core_.is_motor() ? "set rpm 0..8000 | set temp -40.0..150.0 | profile | fault | recover"
                         : "set voltage 0..60.00 | set current -150.0..150.0 | set soc 0..100 | profile | fault");
  } else if (strcmp(cmd.verb, "recover") == 0) {
    if (!can_ok_) {
      ack(cmd.id, text, AckStatus::Rejected, "CAN controller not started");
    } else if (status_.state != BusState::BusOff) {
      ack(cmd.id, text, AckStatus::Rejected, "controller is not bus-off");
    } else {
      const TransportResult r = transport_.request_bus_off_recovery();
      ack(cmd.id, text, r == TransportResult::Ok ? AckStatus::Ok : AckStatus::Rejected,
          r == TransportResult::Ok ? "bus-off recovery started" : transport_result_name(r));
    }
  } else {
    EcuCommandResult r = core_.handle(cmd, now_ms);
    if (r.status == AckStatus::Ok && !can_ok_) {
      strncat(r.detail, " (CAN not running)", sizeof(r.detail) - strlen(r.detail) - 1);
    }
    ack(cmd.id, text, r.status, r.detail);
    if (r.status == AckStatus::Ok) print_ecu_state();  // immediate evidence of the new state
  }
}

void EcuRuntime::ack(const char* id, const char* command, AckStatus status, const char* detail) {
  char line[384];
  if (encode_ack(cfg_.node_name, now_us(), boot_id_, id, command, status, detail, line, sizeof(line))) {
    Serial.println(line);
  }
}

void EcuRuntime::print_hello() {
  HelloInfo info = {cfg_.node_name, id_.node_id, id_.role, banner_.firmware_version, boot_id_, commands_};
  char line[384];
  if (encode_hello(info, now_us(), line, sizeof(line))) Serial.println(line);
}

void EcuRuntime::print_status() {
  char line[640];  // worst case ~500 chars with 10-digit counters
  BusStatus s = can_ok_ ? status_ : empty_bus_status();
  s.transceiver_check = transport_.transceiver_check();  // useful even when CAN did not start
  if (encode_status_json(cfg_.node_name, now_us(), cfg_, s, line, sizeof(line))) Serial.println(line);
}

void EcuRuntime::print_ecu_state() {
  EcuTxStats tx = {can_ok_, bus_state_name(can_ok_ ? status_.state : BusState::Stopped), tx_ok_, tx_failed_,
                   rx_ignored_};
  char line[640];
  if (encode_ecu_state(core_, cfg_.node_name, id_.role, boot_id_, now_us(), tx, line, sizeof(line))) {
    Serial.println(line);
  }
}

void EcuRuntime::print_alerts(uint32_t alerts) {
  if (alerts & TWAI_ALERT_BUS_OFF) {
    Serial.println("# ALERT: BUS-OFF entered. Not automatic: send 'recover' after fixing the bus.");
  }
  if (alerts & TWAI_ALERT_BUS_RECOVERED) Serial.println("# ALERT: bus-off recovery complete, restarting");
  if (alerts & TWAI_ALERT_ERR_PASS) Serial.println("# ALERT: error passive (no ACK? check the other nodes)");
  if (alerts & TWAI_ALERT_ABOVE_ERR_WARN) Serial.println("# ALERT: error counter above warning limit");
  if (alerts & TWAI_ALERT_RX_QUEUE_FULL) Serial.println("# ALERT: RX queue full");
}

}  // namespace canscope

#endif
