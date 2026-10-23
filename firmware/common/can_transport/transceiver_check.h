// Start-up transceiver echo check (portable classifier).
//
// Before the TWAI driver is installed, the ESP32 drives its CAN TX pin by hand
// and reads its CAN RX pin. An SN65HVD230 in normal mode echoes its D input
// on its R output within about a microsecond, so with correct wiring RX
// follows TX. This tells, for one board alone and without any other node:
//   - whether RX is driven at all (pull-up and pull-down give the same level)
//   - whether RX is stuck at dominant (low)
//   - whether RX follows TX (the transceiver is powered, its driver is
//     enabled, and TX/RX go to D/R)
// The check proves nothing about CANH/CANL wiring or termination: a board can
// pass it with its CANH/CANL wires open. It is a diagnostic, never a gate.
//
// Sampling happens in twai_transport.cpp (ESP32 only); the decision is here so
// it is host-tested.
#pragma once

#include <stdint.h>

namespace canscope {

enum class TransceiverCheck : uint8_t {
  NotRun,           // listen-only mode (must never drive the bus) or not an ESP32 build
  Ok,               // RX idles recessive and follows TX
  RxNotDriven,      // RX level follows the internal pull: nothing drives the pin
  RxStuckDominant,  // RX reads dominant (low) whatever TX does
  NoEcho,           // RX idles recessive but does not follow TX low
  Inconsistent,     // partial echo: loose wire, noise, or heavy bus traffic
};

struct TransceiverSamples {
  // Idle phase, TX held recessive (high).
  uint16_t idle_samples;         // reads per pull setting
  uint16_t idle_high_pullup;     // RX high reads with the internal pull-up
  uint16_t idle_high_pulldown;   // RX high reads with the internal pull-down
  // Echo phase, internal pull-up on RX.
  uint16_t pulses;               // TX low pulses
  uint16_t low_when_tx_low;      // RX low while TX was low
  uint16_t high_when_tx_high;    // RX high right after TX returned high
};

TransceiverCheck classify_transceiver(const TransceiverSamples& s);

// Short stable name for serial JSON ("transceiverCheck").
const char* transceiver_check_name(TransceiverCheck check);

// One-line explanation with the most likely causes, for the "# " banner.
const char* transceiver_check_hint(TransceiverCheck check);

}  // namespace canscope
