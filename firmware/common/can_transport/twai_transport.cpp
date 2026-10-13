#include "twai_transport.h"

#if defined(ESP_PLATFORM)

#include <string.h>

#include "driver/twai.h"
#include "esp_timer.h"

namespace canscope {

namespace {

bool timing_for(uint32_t bitrate, twai_timing_config_t& out) {
  switch (bitrate) {
    case 25000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_25KBITS(); out = t; return true; }
    case 50000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_50KBITS(); out = t; return true; }
    case 100000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_100KBITS(); out = t; return true; }
    case 125000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_125KBITS(); out = t; return true; }
    case 250000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_250KBITS(); out = t; return true; }
    case 500000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_500KBITS(); out = t; return true; }
    case 800000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_800KBITS(); out = t; return true; }
    case 1000000: { twai_timing_config_t t = TWAI_TIMING_CONFIG_1MBITS(); out = t; return true; }
    default: return false;
  }
}

twai_mode_t to_twai_mode(CanMode mode) {
  switch (mode) {
    case CanMode::ListenOnly: return TWAI_MODE_LISTEN_ONLY;
    case CanMode::NoAck: return TWAI_MODE_NO_ACK;
    case CanMode::Normal: break;
  }
  return TWAI_MODE_NORMAL;
}

ControllerState to_controller_state(twai_state_t state) {
  switch (state) {
    case TWAI_STATE_STOPPED: return ControllerState::Stopped;
    case TWAI_STATE_RUNNING: return ControllerState::Running;
    case TWAI_STATE_BUS_OFF: return ControllerState::BusOff;
    case TWAI_STATE_RECOVERING: return ControllerState::Recovering;
  }
  return ControllerState::Unknown;
}

}  // namespace

TwaiTransport::TwaiTransport()
    : status_(empty_bus_status()), installed_(false), last_error_(0), last_alerts_(0) {
  memset(&cfg_, 0, sizeof(cfg_));
}

TransportResult TwaiTransport::begin(const CanConfig& cfg) {
  cfg_ = cfg;
  status_ = empty_bus_status();
  last_error_ = 0;

  if (!validate_config(cfg).ok()) return TransportResult::ConfigInvalid;

  twai_timing_config_t t_config;
  if (!timing_for(cfg.bitrate, t_config)) return TransportResult::ConfigInvalid;

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
      static_cast<gpio_num_t>(cfg.tx_gpio), static_cast<gpio_num_t>(cfg.rx_gpio),
      to_twai_mode(cfg.mode));
  g_config.rx_queue_len = 32;
  g_config.alerts_enabled = TWAI_ALERT_BUS_OFF | TWAI_ALERT_BUS_RECOVERED |
                            TWAI_ALERT_ERR_PASS | TWAI_ALERT_ERR_ACTIVE |
                            TWAI_ALERT_ABOVE_ERR_WARN | TWAI_ALERT_BUS_ERROR |
                            TWAI_ALERT_RX_QUEUE_FULL | TWAI_ALERT_ARB_LOST;

  // Accept everything: unknown frames must never be discarded.
  twai_filter_config_t f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  esp_err_t err = twai_driver_install(&g_config, &t_config, &f_config);
  if (err != ESP_OK) {
    last_error_ = err;
    return TransportResult::DriverInstallFailed;
  }
  installed_ = true;

  err = twai_start();
  if (err != ESP_OK) {
    last_error_ = err;
    twai_driver_uninstall();
    installed_ = false;
    return TransportResult::StartFailed;
  }

  poll_status();
  return TransportResult::Ok;
}

void TwaiTransport::end() {
  if (!installed_) return;
  twai_stop();
  twai_driver_uninstall();
  installed_ = false;
  status_.driver_running = false;
  status_.state = BusState::Stopped;
}

TransportResult TwaiTransport::receive(RawFrame& out, uint32_t timeout_ms) {
  if (!installed_) return TransportResult::NotStarted;

  twai_message_t msg;
  const esp_err_t err = twai_receive(&msg, pdMS_TO_TICKS(timeout_ms));
  if (err == ESP_ERR_TIMEOUT) return TransportResult::Timeout;
  if (err != ESP_OK) {
    last_error_ = err;
    return TransportResult::DriverError;
  }

  memset(&out, 0, sizeof(out));
  out.timestamp_us = static_cast<uint64_t>(esp_timer_get_time());
  out.source_node = cfg_.node_name;
  out.can_id = msg.identifier;
  out.format = msg.extd ? IdFormat::Extended : IdFormat::Standard;
  out.remote = msg.rtr;
  out.dlc = msg.data_length_code;
  const size_t n = payload_length(out);
  memcpy(out.data, msg.data, n);
  out.bus_state = status_.state;
  out.tx_error_count = static_cast<uint16_t>(status_.tx_error_counter);
  out.rx_error_count = static_cast<uint16_t>(status_.rx_error_counter);

  ++status_.rx_frames;
  return TransportResult::Ok;
}

TransportResult TwaiTransport::transmit(const RawFrame& frame, uint32_t timeout_ms) {
  const TransportResult gate = check_transmit_allowed(cfg_, status_, frame);
  if (gate != TransportResult::Ok) return gate;

  twai_message_t msg;
  memset(&msg, 0, sizeof(msg));
  msg.identifier = frame.can_id;
  msg.extd = frame.format == IdFormat::Extended ? 1 : 0;
  msg.rtr = frame.remote ? 1 : 0;
  msg.data_length_code = frame.dlc;
  memcpy(msg.data, frame.data, payload_length(frame));

  const esp_err_t err = twai_transmit(&msg, pdMS_TO_TICKS(timeout_ms));
  if (err != ESP_OK) {
    last_error_ = err;
    ++status_.tx_failed;
    return err == ESP_ERR_TIMEOUT ? TransportResult::Timeout : TransportResult::DriverError;
  }
  ++status_.tx_frames;
  return TransportResult::Ok;
}

BusStatus TwaiTransport::poll_status() {
  last_alerts_ = 0;
  if (!installed_) {
    status_.driver_running = false;
    return status_;
  }

  uint32_t alerts = 0;
  if (twai_read_alerts(&alerts, 0) == ESP_OK) {
    last_alerts_ = alerts;
    if (alerts & TWAI_ALERT_BUS_OFF) ++status_.bus_off_events;
  }

  twai_status_info_t info;
  if (twai_get_status_info(&info) == ESP_OK) {
    status_.driver_running = info.state == TWAI_STATE_RUNNING;
    status_.tx_error_counter = info.tx_error_counter;
    status_.rx_error_counter = info.rx_error_counter;
    status_.rx_missed = info.rx_missed_count;
    status_.bus_errors = info.bus_error_count;
    status_.arb_lost = info.arb_lost_count;
    status_.state = derive_bus_state(to_controller_state(info.state), info.tx_error_counter,
                                     info.rx_error_counter);
  }
  return status_;
}

TransportResult TwaiTransport::request_bus_off_recovery() {
  if (!installed_) return TransportResult::NotStarted;
  const esp_err_t err = twai_initiate_recovery();
  if (err != ESP_OK) {
    last_error_ = err;
    return TransportResult::DriverError;
  }
  // After recovery completes the controller is STOPPED; twai_start() must be
  // called again by an explicit operator action (policy: TODO, see TASK.md).
  return TransportResult::Ok;
}

}  // namespace canscope

#endif  // ESP_PLATFORM
