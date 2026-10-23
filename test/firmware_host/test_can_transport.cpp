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
  CHECK(strstr(buf, "\"busOffEvents\":1,\"transceiverCheck\":\"not_run\"}") != nullptr);

  // Worst case: every counter at its maximum still fits the runtimes' 640-byte buffer.
  BusStatus worst = running;
  worst.state = BusState::ErrorWarning;
  worst.tx_error_counter = worst.rx_error_counter = worst.rx_frames = worst.tx_frames = 0xFFFFFFFFu;
  worst.tx_failed = worst.rx_missed = worst.bus_errors = worst.arb_lost = worst.bus_off_events = 0xFFFFFFFFu;
  worst.transceiver_check = TransceiverCheck::RxStuckDominant;
  char big[640];
  const size_t worst_len =
      encode_status_json("monitor", 0xFFFFFFFFFFFFFFFFull, cfg(CanMode::ListenOnly, false), worst, big, sizeof(big));
  CHECK(worst_len > 384);  // the old 384-byte buffers could silently drop this line
  CHECK(worst_len < sizeof(big));
  CHECK(strstr(big, "\"transceiverCheck\":\"rx_stuck_dominant\"}") != nullptr);

  // Start-up transceiver echo check classifier.
  {
    const TransceiverSamples healthy = {64, 64, 64, 8, 8, 8};
    CHECK(classify_transceiver(healthy) == TransceiverCheck::Ok);
    const TransceiverSamples busy_bus = {64, 50, 48, 8, 8, 5};  // other nodes' dominant bits
    CHECK(classify_transceiver(busy_bus) == TransceiverCheck::Ok);
    const TransceiverSamples floating = {64, 64, 0, 8, 0, 8};  // RX follows the internal pull
    CHECK(classify_transceiver(floating) == TransceiverCheck::RxNotDriven);
    const TransceiverSamples stuck = {64, 0, 0, 8, 8, 0};
    CHECK(classify_transceiver(stuck) == TransceiverCheck::RxStuckDominant);
    const TransceiverSamples no_echo = {64, 64, 64, 8, 0, 8};  // e.g. Rs high: driver in standby
    CHECK(classify_transceiver(no_echo) == TransceiverCheck::NoEcho);
    const TransceiverSamples partial = {64, 64, 64, 8, 5, 8};
    CHECK(classify_transceiver(partial) == TransceiverCheck::Inconsistent);
    const TransceiverSamples none = {0, 0, 0, 0, 0, 0};
    CHECK(classify_transceiver(none) == TransceiverCheck::NotRun);
    CHECK_STR_EQ(transceiver_check_name(TransceiverCheck::NoEcho), "no_echo");
    CHECK(strstr(transceiver_check_hint(TransceiverCheck::NoEcho), "Rs") != nullptr);
    CHECK(strstr(transceiver_check_hint(TransceiverCheck::Ok), "NOT tested") != nullptr);
  }

  CHECK_STR_EQ(transport_result_name(TransportResult::TxDisabled), "tx_disabled");
  TEST_MAIN_END();
}
