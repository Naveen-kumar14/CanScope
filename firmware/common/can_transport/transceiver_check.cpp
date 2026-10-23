#include "transceiver_check.h"

namespace canscope {

TransceiverCheck classify_transceiver(const TransceiverSamples& s) {
  if (s.idle_samples == 0 || s.pulses == 0) return TransceiverCheck::NotRun;

  // Something that drives RX gives the same reading whatever the internal
  // pull is. Follows the pull completely: nobody drives the pin.
  if (s.idle_high_pullup == s.idle_samples && s.idle_high_pulldown == 0) {
    return TransceiverCheck::RxNotDriven;
  }
  // Low in every idle read and never high after a pulse: held dominant.
  if (s.idle_high_pullup == 0 && s.idle_high_pulldown == 0 && s.high_when_tx_high == 0) {
    return TransceiverCheck::RxStuckDominant;
  }
  // Our own dominant pulse must always read back as low. Other nodes may make
  // a recessive read low (their traffic), so only half the recessive reads
  // are required to be high.
  if (s.low_when_tx_low == s.pulses && s.high_when_tx_high * 2 >= s.pulses) {
    return TransceiverCheck::Ok;
  }
  if (s.low_when_tx_low == 0) return TransceiverCheck::NoEcho;
  return TransceiverCheck::Inconsistent;
}

const char* transceiver_check_name(TransceiverCheck check) {
  switch (check) {
    case TransceiverCheck::NotRun: return "not_run";
    case TransceiverCheck::Ok: return "ok";
    case TransceiverCheck::RxNotDriven: return "rx_not_driven";
    case TransceiverCheck::RxStuckDominant: return "rx_stuck_dominant";
    case TransceiverCheck::NoEcho: return "no_echo";
    case TransceiverCheck::Inconsistent: return "inconsistent";
  }
  return "unknown";
}

const char* transceiver_check_hint(TransceiverCheck check) {
  switch (check) {
    case TransceiverCheck::NotRun:
      return "not run (listen-only mode never drives the bus)";
    case TransceiverCheck::Ok:
      return "RX follows TX: transceiver powered, driver enabled, TX->D and R->RX wired"
             " (CANH/CANL and termination are NOT tested by this)";
    case TransceiverCheck::RxNotDriven:
      return "RX pin is not driven: R->RX wire open or on the wrong GPIO, transceiver not powered"
             " (3V3/GND), or TX/RX swapped";
    case TransceiverCheck::RxStuckDominant:
      return "RX is always dominant: CANH/CANL shorted or another node holding the bus,"
             " transceiver faulty, or RX wired to a low signal";
    case TransceiverCheck::NoEcho:
      return "RX does not follow TX: Rs pin high or floating (standby; tie Rs to GND),"
             " TX->D wire open or on the wrong GPIO, or TX/RX swapped";
    case TransceiverCheck::Inconsistent:
      return "RX follows TX only sometimes: loose breadboard contact, noise, or heavy bus traffic;"
             " press EN to repeat the check";
  }
  return "unknown";
}

}  // namespace canscope
