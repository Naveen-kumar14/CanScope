// CANScope shared CAN configuration model and validation.
//
// Portable C++11 (no Arduino/ESP-IDF dependency) so it can be unit-tested on
// the host. Hardware values live in each node's own config header, never here.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace canscope {

// Sentinels meaning "nobody has verified this value yet". Validation rejects
// them, so a node with unverified pins/bit rate refuses to start the CAN
// controller instead of driving guessed GPIOs.
static const int kGpioUnverified = -1;
static const uint32_t kBitrateUnverified = 0;
static const int kNodeNumberUnverified = -1;

enum class CanMode : uint8_t {
  ListenOnly,  // passive: no ACK, no error frames, no TX
  Normal,      // full participant (ACKs frames)
  NoAck,       // controller self-test mode (TX without requiring ACK)
};

enum class FrameStandard : uint8_t {
  Classical,  // classic CAN 2.0A/B, max 8 data bytes
  Fd,         // CAN FD: NOT supported by the ESP32 TWAI controller
};

// Evidence level of a hardware/protocol value (see docs/hardware-status.md).
enum class ValueStatus : uint8_t {
  Unverified,
  WorkingAssumption,
  Verified,
};

struct CanConfig {
  const char* node_name;
  int node_number;          // kNodeNumberUnverified if unknown
  int tx_gpio;              // kGpioUnverified if unknown
  int rx_gpio;              // kGpioUnverified if unknown
  uint32_t bitrate;         // nominal bit/s, kBitrateUnverified if unknown
  CanMode mode;
  FrameStandard standard;
  bool enable_tx;           // transmit permission at the driver boundary
  ValueStatus pins_status;
  ValueStatus bitrate_status;
};

enum class ConfigIssue : uint8_t {
  MissingNodeName,
  TxGpioUnverified,
  RxGpioUnverified,
  TxGpioInvalid,       // outside 0..39, flash pins 6..11, or input-only 34..39
  RxGpioInvalid,       // outside 0..39 or flash pins 6..11
  TxRxSameGpio,
  BitrateUnverified,
  BitrateUnsupported,  // not one of the TWAI preset rates
  CanFdUnsupported,
  TxEnabledInListenOnly,
  // Warnings (do not block start-up):
  WarnStrappingPin,    // GPIO 0, 2, 5, 12, 15
  WarnPsramPin,        // GPIO 16/17 are PSRAM on WROVER modules
  WarnNodeNumberUnverified,
  WarnValuesNotVerified,
};

static const size_t kMaxConfigIssues = 16;

struct ConfigValidation {
  ConfigIssue issues[kMaxConfigIssues];
  size_t count;

  bool ok() const;            // true when there are no blocking errors
  size_t error_count() const;
  size_t warning_count() const;
  bool has(ConfigIssue issue) const;
};

// GPIO rules assume a classic ESP32 (WORKING_ASSUMPTION: board variant is
// unverified). Revisit when the exact module is known.
ConfigValidation validate_config(const CanConfig& cfg);

bool is_warning(ConfigIssue issue);
bool is_supported_bitrate(uint32_t bitrate);
bool tx_permitted(const CanConfig& cfg);

const char* issue_text(ConfigIssue issue);
const char* mode_name(CanMode mode);
const char* status_name(ValueStatus status);

}  // namespace canscope
