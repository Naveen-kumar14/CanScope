#include "diagnostics.h"

#include <stdio.h>

namespace canscope {

namespace {

const char* gpio_text(int gpio, char* buf, size_t len) {
  if (gpio == kGpioUnverified) return "UNVERIFIED";
  snprintf(buf, len, "GPIO%d", gpio);
  return buf;
}

}  // namespace

void emit_banner(const BannerInfo& info, const CanConfig& cfg, const ConfigValidation& validation,
                 LineSink sink, void* ctx) {
  char line[160];
  char tx[16];
  char rx[16];

  sink("# ==================================================", ctx);
  snprintf(line, sizeof(line), "# CANScope %s v%s", info.firmware_name, info.firmware_version);
  sink(line, ctx);
  const char* name = cfg.node_name ? cfg.node_name : "UNVERIFIED";
  if (cfg.node_number == kNodeNumberUnverified) {
    snprintf(line, sizeof(line), "# node: %s (number UNVERIFIED)", name);
  } else {
    snprintf(line, sizeof(line), "# node: %s (number %d)", name, cfg.node_number);
  }
  sink(line, ctx);
  snprintf(line, sizeof(line), "# board: %s", info.board);
  sink(line, ctx);
  snprintf(line, sizeof(line), "# transceiver: %s", info.transceiver);
  sink(line, ctx);
  snprintf(line, sizeof(line), "# CAN TX: %s  RX: %s  [%s]", gpio_text(cfg.tx_gpio, tx, sizeof(tx)),
           gpio_text(cfg.rx_gpio, rx, sizeof(rx)), status_name(cfg.pins_status));
  sink(line, ctx);
  if (cfg.bitrate == kBitrateUnverified) {
    snprintf(line, sizeof(line), "# bit rate: UNVERIFIED  [%s]", status_name(cfg.bitrate_status));
  } else {
    snprintf(line, sizeof(line), "# bit rate: %lu bit/s  [%s]", static_cast<unsigned long>(cfg.bitrate),
             status_name(cfg.bitrate_status));
  }
  sink(line, ctx);
  snprintf(line, sizeof(line), "# mode: %s  frame: %s  TX permitted: %s", mode_name(cfg.mode),
           cfg.standard == FrameStandard::Fd ? "CAN FD" : "classical",
           tx_permitted(cfg) ? "YES" : "no");
  sink(line, ctx);

  for (size_t i = 0; i < validation.count; ++i) {
    snprintf(line, sizeof(line), "# %s %s", is_warning(validation.issues[i]) ? "WARN " : "ERROR",
             issue_text(validation.issues[i]));
    sink(line, ctx);
  }
  snprintf(line, sizeof(line), "# config: %s (%u errors, %u warnings)",
           validation.ok() ? "accepted" : "REJECTED - CAN controller will not be started",
           static_cast<unsigned>(validation.error_count()),
           static_cast<unsigned>(validation.warning_count()));
  sink(line, ctx);
  sink("# ==================================================", ctx);
}

void emit_init_result(TransportResult result, int driver_error, LineSink sink, void* ctx) {
  char line[120];
  if (result == TransportResult::Ok) {
    sink("# CAN init: OK - controller running", ctx);
    return;
  }
  snprintf(line, sizeof(line), "# CAN init: FAILED (%s, driver error %d)", transport_result_name(result),
           driver_error);
  sink(line, ctx);
}

void emit_transceiver_check(TransceiverCheck check, LineSink sink, void* ctx) {
  char line[224];  // longest hint + prefix, with room to spare (host-tested)
  snprintf(line, sizeof(line), "# CAN transceiver echo check: %s - %s", transceiver_check_name(check),
           transceiver_check_hint(check));
  sink(line, ctx);
}

}  // namespace canscope
