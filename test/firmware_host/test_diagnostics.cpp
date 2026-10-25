// Start-up banner tests.
#include <string>

#include "diagnostics.h"
#include "mini_test.h"

using namespace canscope;

static void collect(const char* line, void* ctx) {
  std::string* out = static_cast<std::string*>(ctx);
  *out += line;
  *out += "\n";
}

int main() {
  const BannerInfo info = {"node3", "0.1.0", "esp32dev (UNVERIFIED)", "UNVERIFIED"};

  {  // Node 3 default config: unverified, rejected, clearly reported.
    CanConfig c = {"node3", 3, kGpioUnverified, kGpioUnverified, kBitrateUnverified,
                   CanMode::ListenOnly, FrameStandard::Classical, false,
                   ValueStatus::Unverified, ValueStatus::Unverified};
    std::string out;
    emit_banner(info, c, validate_config(c), collect, &out);
    CHECK(out.find("# CANScope node3 v0.1.0") != std::string::npos);
    CHECK(out.find("# CAN TX: UNVERIFIED  RX: UNVERIFIED  [UNVERIFIED]") != std::string::npos);
    CHECK(out.find("# bit rate: UNVERIFIED") != std::string::npos);
    CHECK(out.find("TX permitted: no") != std::string::npos);
    CHECK(out.find("REJECTED - CAN controller will not be started") != std::string::npos);
    // Every banner line is a comment line for the host bridge.
    size_t pos = 0;
    while (pos < out.size()) {
      CHECK(out.compare(pos, 2, "# ") == 0);
      pos = out.find('\n', pos) + 1;
    }
  }
  {  // Valid config is accepted.
    CanConfig c = {"monitor", kNodeNumberUnverified, 22, 21, 500000, CanMode::ListenOnly,
                   FrameStandard::Classical, false, ValueStatus::WorkingAssumption,
                   ValueStatus::WorkingAssumption};
    std::string out;
    emit_banner(info, c, validate_config(c), collect, &out);
    CHECK(out.find("# CAN TX: GPIO22  RX: GPIO21  [WORKING_ASSUMPTION]") != std::string::npos);
    CHECK(out.find("# bit rate: 500000 bit/s") != std::string::npos);
    CHECK(out.find("# config: accepted") != std::string::npos);
  }
  {
    std::string out;
    emit_init_result(TransportResult::DriverInstallFailed, 259, collect, &out);
    CHECK(out == "# CAN init: FAILED (driver_install_failed, driver error 259)\n");
  }
  {  // Echo check line: the exact prefix operators look for, and no hint is ever truncated.
    std::string out;
    emit_transceiver_check(TransceiverCheck::NoEcho, collect, &out);
    CHECK(out.compare(0, 40, "# CAN transceiver echo check: no_echo - ") == 0);
    const TransceiverCheck all[] = {TransceiverCheck::NotRun,          TransceiverCheck::Ok,
                                    TransceiverCheck::RxNotDriven,     TransceiverCheck::RxStuckDominant,
                                    TransceiverCheck::NoEcho,          TransceiverCheck::Inconsistent};
    for (size_t i = 0; i < sizeof(all) / sizeof(all[0]); ++i) {
      std::string line;
      emit_transceiver_check(all[i], collect, &line);
      CHECK(line == std::string("# CAN transceiver echo check: ") + transceiver_check_name(all[i]) + " - " +
                        transceiver_check_hint(all[i]) + "\n");
    }
  }
  TEST_MAIN_END();
}
