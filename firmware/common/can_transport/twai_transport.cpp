#include "twai_transport.h"

#if defined(ESP_PLATFORM)

#include <string.h>

#include "driver/gpio.h"
#include "driver/twai.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

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

// Start-up echo check, before the driver owns the pins (see transceiver_check.h).
// Each dominant pulse lasts about 6 us (3 bit times at 500 kbit/s): at most one
// error frame for any node already on the bus. Never called in listen-only mode.
TransceiverCheck run_echo_check(gpio_num_t tx, gpio_num_t rx) {
  const uint16_t kIdleSamples = 64;
  const uint16_t kPulses = 8;
  TransceiverSamples s = {kIdleSamples, 0, 0, kPulses, 0, 0};
  portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

  gpio_reset_pin(tx);
  gpio_reset_pin(rx);
  gpio_set_direction(tx, GPIO_MODE_OUTPUT);
  gpio_set_level(tx, 1);  // recessive
  gpio_set_direction(rx, GPIO_MODE_INPUT);

  gpio_set_pull_mode(rx, GPIO_PULLUP_ONLY);
  esp_rom_delay_us(50);
  for (uint16_t i = 0; i < kIdleSamples; ++i) {
    if (gpio_get_level(rx)) ++s.idle_high_pullup;
    esp_rom_delay_us(10);
  }
  gpio_set_pull_mode(rx, GPIO_PULLDOWN_ONLY);
  esp_rom_delay_us(50);
  for (uint16_t i = 0; i < kIdleSamples; ++i) {
    if (gpio_get_level(rx)) ++s.idle_high_pulldown;
    esp_rom_delay_us(10);
  }

  gpio_set_pull_mode(rx, GPIO_PULLUP_ONLY);
  esp_rom_delay_us(50);
  for (uint16_t i = 0; i < kPulses; ++i) {
    portENTER_CRITICAL(&mux);  // keep the dominant pulse short
    gpio_set_level(tx, 0);
    esp_rom_delay_us(6);
    const bool low = gpio_get_level(rx) == 0;
    gpio_set_level(tx, 1);
    esp_rom_delay_us(6);
    const bool high = gpio_get_level(rx) != 0;
    portEXIT_CRITICAL(&mux);
    if (low) ++s.low_when_tx_low;
    if (high) ++s.high_when_tx_high;
    esp_rom_delay_us(200);
  }
  gpio_set_pull_mode(rx, GPIO_FLOATING);
  return classify_transceiver(s);
}

}  // namespace

TwaiTransport::TwaiTransport()
    : status_(empty_bus_status()),
      installed_(false),
      last_error_(0),
      last_alerts_(0),
      recovery_pending_(false),
      recoveries_(0) {
  memset(&cfg_, 0, sizeof(cfg_));
}

TransportResult TwaiTransport::begin(const CanConfig& cfg) {
  cfg_ = cfg;
  status_ = empty_bus_status();
  last_error_ = 0;
  recovery_pending_ = false;

  if (!validate_config(cfg).ok()) return TransportResult::ConfigInvalid;

  twai_timing_config_t t_config;
  if (!timing_for(cfg.bitrate, t_config)) return TransportResult::ConfigInvalid;

  // Listen-only must never drive the bus, not even for the echo check.
  status_.transceiver_check =
      cfg.mode == CanMode::ListenOnly
          ? TransceiverCheck::NotRun
          : run_echo_check(static_cast<gpio_num_t>(cfg.tx_gpio), static_cast<gpio_num_t>(cfg.rx_gpio));

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
      static_cast<gpio_num_t>(cfg.tx_gpio), static_cast<gpio_num_t>(cfg.rx_gpio),
      to_twai_mode(cfg.mode));
  g_config.rx_queue_len = 32;
  g_config.tx_queue_len = 8;
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
    // An operator-requested recovery has completed (128 x 11 recessive bits
    // seen): the controller is STOPPED and must be started again.
    if (recovery_pending_ && info.state == TWAI_STATE_STOPPED) {
      const esp_err_t err = twai_start();
      recovery_pending_ = false;
      if (err == ESP_OK) {
        ++recoveries_;
        twai_get_status_info(&info);
      } else {
        last_error_ = err;
      }
    }
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
  // Only valid in bus-off; the driver refuses it in any other state.
  const esp_err_t err = twai_initiate_recovery();
  if (err != ESP_OK) {
    last_error_ = err;
    return TransportResult::DriverError;
  }
  // Recovery is only ever started by an explicit operator action (serial
  // "recover" or Node 3 button B long press), never automatically.
  // poll_status() restarts the controller once recovery has completed.
  recovery_pending_ = true;
  return TransportResult::Ok;
}

}  // namespace canscope

#endif  // ESP_PLATFORM
