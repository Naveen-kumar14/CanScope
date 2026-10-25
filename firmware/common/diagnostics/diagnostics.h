// CANScope start-up banner and diagnostic text. Portable: lines are delivered
// to a callback so the same code prints to Serial on the ESP32 and to a buffer
// in host tests. Every human-readable line starts with "# " so that a host
// bridge can separate it from JSON event lines (which start with '{').
#pragma once

#include <stddef.h>

#include "can_config.h"
#include "can_transport.h"

namespace canscope {

typedef void (*LineSink)(const char* line, void* ctx);

struct BannerInfo {
  const char* firmware_name;
  const char* firmware_version;
  const char* board;        // e.g. "esp32dev (WORKING_ASSUMPTION)"
  const char* transceiver;  // e.g. "UNVERIFIED"
};

void emit_banner(const BannerInfo& info, const CanConfig& cfg, const ConfigValidation& validation,
                 LineSink sink, void* ctx);

void emit_init_result(TransportResult result, int driver_error, LineSink sink, void* ctx);

// "# CAN transceiver echo check: <name> - <hint>" (names: transceiver_check.h).
void emit_transceiver_check(TransceiverCheck check, LineSink sink, void* ctx);

}  // namespace canscope
