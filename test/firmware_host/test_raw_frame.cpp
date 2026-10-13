// Raw frame model tests. IDs/payloads are EXAMPLE data, not production values.
#include <string.h>

#include "mini_test.h"
#include "raw_frame.h"

using namespace canscope;

static RawFrame example_frame() {
  RawFrame f;
  memset(&f, 0, sizeof(f));
  f.timestamp_us = 1234567890123ULL;
  f.source_node = "monitor";
  f.can_id = 0x7A0;  // EXAMPLE ID
  f.format = IdFormat::Standard;
  f.dlc = 3;
  f.data[0] = 0;
  f.data[1] = 127;
  f.data[2] = 255;
  f.bus_state = BusState::ErrorActive;
  f.tx_error_count = 0;
  f.rx_error_count = 5;
  return f;
}

int main() {
  char buf[256];

  {  // Standard frame round trip to JSON line.
    RawFrame f = example_frame();
    CHECK(frame_is_valid(f));
    CHECK(payload_length(f) == 3);
    size_t n = encode_frame_json(f, buf, sizeof(buf));
    CHECK(n == strlen(buf));
    CHECK_STR_EQ(buf,
                 "{\"type\":\"frame\",\"sourceNode\":\"monitor\",\"deviceTimeUs\":1234567890123,"
                 "\"canId\":\"0x7A0\",\"identifierFormat\":\"standard\",\"remote\":false,\"dlc\":3,"
                 "\"data\":[0,127,255],\"busState\":\"error_active\",\"txErrorCount\":0,"
                 "\"rxErrorCount\":5}");
  }
  {  // Extended ID keeps 29 bits and 8 hex digits.
    RawFrame f = example_frame();
    f.format = IdFormat::Extended;
    f.can_id = 0x1ABCDEF0;  // EXAMPLE ID
    CHECK(frame_is_valid(f));
    CHECK(encode_frame_json(f, buf, sizeof(buf)) > 0);
    CHECK(strstr(buf, "\"canId\":\"0x1ABCDEF0\"") != nullptr);
    CHECK(strstr(buf, "\"identifierFormat\":\"extended\"") != nullptr);
  }
  {  // Out-of-range IDs are rejected, not truncated.
    RawFrame f = example_frame();
    f.can_id = 0x800;
    CHECK(!frame_is_valid(f));
    CHECK(encode_frame_json(f, buf, sizeof(buf)) == 0);
    f.format = IdFormat::Extended;
    CHECK(frame_is_valid(f));
    f.can_id = 0x20000000;
    CHECK(!frame_is_valid(f));
  }
  {  // Remote frame: DLC kept, no data bytes.
    RawFrame f = example_frame();
    f.remote = true;
    f.dlc = 8;
    CHECK(payload_length(f) == 0);
    CHECK(encode_frame_json(f, buf, sizeof(buf)) > 0);
    CHECK(strstr(buf, "\"remote\":true,\"dlc\":8,\"data\":[]") != nullptr);
  }
  {  // Classical DLC 9..15 => 8 bytes.
    RawFrame f = example_frame();
    f.dlc = 12;
    CHECK(frame_is_valid(f));
    CHECK(payload_length(f) == 8);
    f.dlc = 16;
    CHECK(!frame_is_valid(f));
  }
  {  // Small buffer -> 0 and empty string, never a truncated JSON line.
    RawFrame f = example_frame();
    char tiny[20];
    CHECK(encode_frame_json(f, tiny, sizeof(tiny)) == 0);
    CHECK(tiny[0] == '\0');
  }
  {  // Bus-state derivation.
    CHECK(derive_bus_state(ControllerState::Running, 0, 0) == BusState::ErrorActive);
    CHECK(derive_bus_state(ControllerState::Running, 96, 0) == BusState::ErrorWarning);
    CHECK(derive_bus_state(ControllerState::Running, 0, 128) == BusState::ErrorPassive);
    CHECK(derive_bus_state(ControllerState::Running, 256, 0) == BusState::BusOff);
    CHECK(derive_bus_state(ControllerState::BusOff, 0, 0) == BusState::BusOff);
    CHECK(derive_bus_state(ControllerState::Stopped, 0, 0) == BusState::Stopped);
    CHECK(derive_bus_state(ControllerState::Unknown, 0, 0) == BusState::Unknown);
    CHECK_STR_EQ(bus_state_name(BusState::ErrorPassive), "error_passive");
  }
  {  // Unknown source node is labelled, not dropped.
    RawFrame f = example_frame();
    f.source_node = nullptr;
    CHECK(encode_frame_json(f, buf, sizeof(buf)) > 0);
    CHECK(strstr(buf, "\"sourceNode\":\"unknown\"") != nullptr);
  }
  TEST_MAIN_END();
}
