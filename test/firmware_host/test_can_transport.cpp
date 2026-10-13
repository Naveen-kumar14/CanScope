// Transmit gate and status encoding tests (portable part of can_transport).
#include <string.h>

#include "can_transport.h"
#include "mini_test.h"

using namespace canscope;

static CanConfig cfg(CanMode mode, bool enable_tx) {
  CanConfig c = {"gate_test", 1, 22, 21, 500000, mode, FrameStandard::Classical, enable_tx,
                 ValueStatus::WorkingAssumption, ValueStatus::Verified};
  return c;
}

static RawFrame example_frame() {
  RawFrame f;
  memset(&f, 0, sizeof(f));
  f.can_id = 0x7A1;  // EXAMPLE ID
  f.dlc = 1;
  return f;
}

int main() {
  BusStatus running = empty_bus_status();
  running.driver_running = true;
  running.state = BusState::ErrorActive;
  const RawFrame frame = example_frame();

  // Default monitor posture: listen-only, TX disabled -> refused.
  CHECK(check_transmit_allowed(cfg(CanMode::ListenOnly, false), running, frame) ==
        TransportResult::TxDisabled);
  // Normal mode but ENABLE_TX=false -> refused.
  CHECK(check_transmit_allowed(cfg(CanMode::Normal, false), running, frame) ==
        TransportResult::TxDisabled);
  // Listen-only always wins over ENABLE_TX=true.
  CHECK(check_transmit_allowed(cfg(CanMode::ListenOnly, true), running, frame) ==
        TransportResult::TxDisabled);
  // Explicitly enabled + running -> allowed.
  CHECK(check_transmit_allowed(cfg(CanMode::Normal, true), running, frame) == TransportResult::Ok);

  BusStatus stopped = empty_bus_status();
  CHECK(check_transmit_allowed(cfg(CanMode::Normal, true), stopped, frame) ==
        TransportResult::NotStarted);

  BusStatus bus_off = running;
  bus_off.state = BusState::BusOff;
  CHECK(check_transmit_allowed(cfg(CanMode::Normal, true), bus_off, frame) == TransportResult::BusOff);

  RawFrame bad = frame;
  bad.dlc = 9;
  CHECK(check_transmit_allowed(cfg(CanMode::Normal, true), running, bad) ==
        TransportResult::InvalidFrame);

  // Status JSON line.
  char buf[512];
  BusStatus s = running;
  s.rx_frames = 42;
  s.bus_off_events = 1;
  CHECK(encode_status_json("monitor", 1000, cfg(CanMode::ListenOnly, false), s, buf, sizeof(buf)) > 0);
  CHECK(strstr(buf, "{\"type\":\"status\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":1000,") == buf);
  CHECK(strstr(buf, "\"mode\":\"listen_only\",\"txEnabled\":false") != nullptr);
  CHECK(strstr(buf, "\"configStatus\":\"WORKING_ASSUMPTION\"") != nullptr);
  CHECK(strstr(buf, "\"rxFrames\":42") != nullptr);
  CHECK(strstr(buf, "\"busOffEvents\":1}") != nullptr);

  CHECK_STR_EQ(transport_result_name(TransportResult::TxDisabled), "tx_disabled");
  TEST_MAIN_END();
}
