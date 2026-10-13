#include "can_config.h"

namespace canscope {

namespace {

const uint32_t kSupportedBitrates[] = {25000,  50000,  100000, 125000,
                                       250000, 500000, 800000, 1000000};

bool is_flash_pin(int gpio) { return gpio >= 6 && gpio <= 11; }
bool is_input_only(int gpio) { return gpio >= 34 && gpio <= 39; }
bool in_range(int gpio) { return gpio >= 0 && gpio <= 39; }
bool is_strapping(int gpio) {
  return gpio == 0 || gpio == 2 || gpio == 5 || gpio == 12 || gpio == 15;
}

void add(ConfigValidation& v, ConfigIssue issue) {
  if (v.has(issue) || v.count >= kMaxConfigIssues) return;
  v.issues[v.count++] = issue;
}

}  // namespace

bool ConfigValidation::ok() const { return error_count() == 0; }

size_t ConfigValidation::error_count() const {
  size_t n = 0;
  for (size_t i = 0; i < count; ++i) {
    if (!is_warning(issues[i])) ++n;
  }
  return n;
}

size_t ConfigValidation::warning_count() const { return count - error_count(); }

bool ConfigValidation::has(ConfigIssue issue) const {
  for (size_t i = 0; i < count; ++i) {
    if (issues[i] == issue) return true;
  }
  return false;
}

bool is_warning(ConfigIssue issue) {
  switch (issue) {
    case ConfigIssue::WarnStrappingPin:
    case ConfigIssue::WarnPsramPin:
    case ConfigIssue::WarnNodeNumberUnverified:
    case ConfigIssue::WarnValuesNotVerified:
      return true;
    default:
      return false;
  }
}

bool is_supported_bitrate(uint32_t bitrate) {
  for (size_t i = 0; i < sizeof(kSupportedBitrates) / sizeof(kSupportedBitrates[0]); ++i) {
    if (kSupportedBitrates[i] == bitrate) return true;
  }
  return false;
}

ConfigValidation validate_config(const CanConfig& cfg) {
  ConfigValidation v;
  v.count = 0;

  if (cfg.node_name == nullptr || cfg.node_name[0] == '\0') {
    add(v, ConfigIssue::MissingNodeName);
  }

  if (cfg.tx_gpio == kGpioUnverified) {
    add(v, ConfigIssue::TxGpioUnverified);
  } else if (!in_range(cfg.tx_gpio) || is_flash_pin(cfg.tx_gpio) || is_input_only(cfg.tx_gpio)) {
    add(v, ConfigIssue::TxGpioInvalid);
  }

  if (cfg.rx_gpio == kGpioUnverified) {
    add(v, ConfigIssue::RxGpioUnverified);
  } else if (!in_range(cfg.rx_gpio) || is_flash_pin(cfg.rx_gpio)) {
    add(v, ConfigIssue::RxGpioInvalid);
  }

  if (cfg.tx_gpio != kGpioUnverified && cfg.tx_gpio == cfg.rx_gpio) {
    add(v, ConfigIssue::TxRxSameGpio);
  }

  if (cfg.bitrate == kBitrateUnverified) {
    add(v, ConfigIssue::BitrateUnverified);
  } else if (!is_supported_bitrate(cfg.bitrate)) {
    add(v, ConfigIssue::BitrateUnsupported);
  }

  if (cfg.standard == FrameStandard::Fd) add(v, ConfigIssue::CanFdUnsupported);

  if (cfg.mode == CanMode::ListenOnly && cfg.enable_tx) {
    add(v, ConfigIssue::TxEnabledInListenOnly);
  }

  if (is_strapping(cfg.tx_gpio) || is_strapping(cfg.rx_gpio)) {
    add(v, ConfigIssue::WarnStrappingPin);
  }
  if (cfg.tx_gpio == 16 || cfg.tx_gpio == 17 || cfg.rx_gpio == 16 || cfg.rx_gpio == 17) {
    add(v, ConfigIssue::WarnPsramPin);
  }
  if (cfg.node_number == kNodeNumberUnverified) {
    add(v, ConfigIssue::WarnNodeNumberUnverified);
  }
  if (cfg.pins_status != ValueStatus::Verified || cfg.bitrate_status != ValueStatus::Verified) {
    add(v, ConfigIssue::WarnValuesNotVerified);
  }

  return v;
}

bool tx_permitted(const CanConfig& cfg) {
  return cfg.enable_tx && cfg.mode != CanMode::ListenOnly;
}

const char* issue_text(ConfigIssue issue) {
  switch (issue) {
    case ConfigIssue::MissingNodeName: return "node name is missing";
    case ConfigIssue::TxGpioUnverified: return "CAN TX GPIO is UNVERIFIED";
    case ConfigIssue::RxGpioUnverified: return "CAN RX GPIO is UNVERIFIED";
    case ConfigIssue::TxGpioInvalid: return "CAN TX GPIO is not a usable ESP32 output pin";
    case ConfigIssue::RxGpioInvalid: return "CAN RX GPIO is not a usable ESP32 input pin";
    case ConfigIssue::TxRxSameGpio: return "CAN TX and RX use the same GPIO";
    case ConfigIssue::BitrateUnverified: return "CAN bit rate is UNVERIFIED";
    case ConfigIssue::BitrateUnsupported: return "CAN bit rate is not a supported TWAI preset";
    case ConfigIssue::CanFdUnsupported: return "CAN FD is not supported by the ESP32 TWAI controller";
    case ConfigIssue::TxEnabledInListenOnly: return "ENABLE_TX=true conflicts with listen-only mode";
    case ConfigIssue::WarnStrappingPin: return "warning: a CAN pin is an ESP32 strapping pin";
    case ConfigIssue::WarnPsramPin: return "warning: GPIO16/17 are PSRAM pins on WROVER modules";
    case ConfigIssue::WarnNodeNumberUnverified: return "warning: node number is UNVERIFIED";
    case ConfigIssue::WarnValuesNotVerified: return "warning: pins/bit rate are not hardware-verified";
  }
  return "unknown issue";
}

const char* mode_name(CanMode mode) {
  switch (mode) {
    case CanMode::ListenOnly: return "listen_only";
    case CanMode::Normal: return "normal";
    case CanMode::NoAck: return "no_ack";
  }
  return "unknown";
}

const char* status_name(ValueStatus status) {
  switch (status) {
    case ValueStatus::Unverified: return "UNVERIFIED";
    case ValueStatus::WorkingAssumption: return "WORKING_ASSUMPTION";
    case ValueStatus::Verified: return "VERIFIED";
  }
  return "UNKNOWN";
}

}  // namespace canscope
