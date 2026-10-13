// Configuration validation tests. GPIO/bit-rate numbers here are test inputs,
// not project hardware facts.
#include "can_config.h"
#include "mini_test.h"

using namespace canscope;

static CanConfig valid_config() {
  CanConfig c = {"test_node", 9, 22, 21, 500000, CanMode::ListenOnly, FrameStandard::Classical,
                 false, ValueStatus::Verified, ValueStatus::Verified};
  return c;
}

int main() {
  {
    ConfigValidation v = validate_config(valid_config());
    CHECK(v.ok());
    CHECK(v.count == 0);
  }
  {  // Node 3 defaults: everything unverified -> rejected.
    CanConfig c = valid_config();
    c.tx_gpio = kGpioUnverified;
    c.rx_gpio = kGpioUnverified;
    c.bitrate = kBitrateUnverified;
    c.pins_status = ValueStatus::Unverified;
    ConfigValidation v = validate_config(c);
    CHECK(!v.ok());
    CHECK(v.has(ConfigIssue::TxGpioUnverified));
    CHECK(v.has(ConfigIssue::RxGpioUnverified));
    CHECK(v.has(ConfigIssue::BitrateUnverified));
    CHECK(v.has(ConfigIssue::WarnValuesNotVerified));
    CHECK(!v.has(ConfigIssue::TxRxSameGpio));
  }
  {  // Missing name.
    CanConfig c = valid_config();
    c.node_name = "";
    CHECK(validate_config(c).has(ConfigIssue::MissingNodeName));
    c.node_name = nullptr;
    CHECK(validate_config(c).has(ConfigIssue::MissingNodeName));
  }
  {  // Invalid pins.
    CanConfig c = valid_config();
    c.tx_gpio = 34;  // input-only
    CHECK(validate_config(c).has(ConfigIssue::TxGpioInvalid));
    c.tx_gpio = 6;  // flash
    CHECK(validate_config(c).has(ConfigIssue::TxGpioInvalid));
    c.tx_gpio = 40;
    CHECK(validate_config(c).has(ConfigIssue::TxGpioInvalid));
    c = valid_config();
    c.rx_gpio = 34;  // input-only is fine for RX
    CHECK(validate_config(c).ok());
    c.rx_gpio = 9;
    CHECK(validate_config(c).has(ConfigIssue::RxGpioInvalid));
    c = valid_config();
    c.rx_gpio = c.tx_gpio;
    CHECK(validate_config(c).has(ConfigIssue::TxRxSameGpio));
  }
  {  // Bit rate.
    CanConfig c = valid_config();
    c.bitrate = 333333;
    CHECK(validate_config(c).has(ConfigIssue::BitrateUnsupported));
    CHECK(is_supported_bitrate(125000));
    CHECK(is_supported_bitrate(1000000));
    CHECK(!is_supported_bitrate(0));
  }
  {  // CAN FD and TX in listen-only are blocking.
    CanConfig c = valid_config();
    c.standard = FrameStandard::Fd;
    CHECK(validate_config(c).has(ConfigIssue::CanFdUnsupported));
    c = valid_config();
    c.enable_tx = true;
    ConfigValidation v = validate_config(c);
    CHECK(v.has(ConfigIssue::TxEnabledInListenOnly));
    CHECK(!v.ok());
  }
  {  // Warnings do not block.
    CanConfig c = valid_config();
    c.tx_gpio = 17;
    c.rx_gpio = 16;
    c.node_number = kNodeNumberUnverified;
    c.bitrate_status = ValueStatus::WorkingAssumption;
    ConfigValidation v = validate_config(c);
    CHECK(v.ok());
    CHECK(v.has(ConfigIssue::WarnPsramPin));
    CHECK(v.has(ConfigIssue::WarnNodeNumberUnverified));
    CHECK(v.has(ConfigIssue::WarnValuesNotVerified));
    CHECK(v.warning_count() == 3);
    c.tx_gpio = 5;
    CHECK(validate_config(c).has(ConfigIssue::WarnStrappingPin));
  }
  {  // TX permission.
    CanConfig c = valid_config();
    CHECK(!tx_permitted(c));  // listen-only, disabled
    c.mode = CanMode::Normal;
    CHECK(!tx_permitted(c));  // still ENABLE_TX=false
    c.enable_tx = true;
    CHECK(tx_permitted(c));
  }
  CHECK_STR_EQ(mode_name(CanMode::ListenOnly), "listen_only");
  CHECK_STR_EQ(status_name(ValueStatus::WorkingAssumption), "WORKING_ASSUMPTION");
  TEST_MAIN_END();
}
