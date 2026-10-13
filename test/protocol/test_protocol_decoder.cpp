// Protocol registry/decoder tests.
//
// The "EXAMPLE" registry below is MOCK DATA for testing the decoder only. Its
// IDs (0x7Ex range), fields, scaling and units are NOT project protocol values.
#include <math.h>
#include <string.h>

#include "mini_test.h"
#include "protocol_registry.h"

using namespace canscope;

static const FieldDef kExampleFields[] = {
    {"example_u16_be", 0, 2, false, ByteOrder::BigEndian, true, 0.1, 0.0, "example_unit"},
    {"example_s16_le", 2, 2, true, ByteOrder::LittleEndian, true, 1.0, -40.0, "example_unit"},
    {"example_u8_unscaled", 4, 1, false, ByteOrder::BigEndian, false, 1.0, 0.0, ""},
};

static const RegistryEntry kExampleEntries[] = {
    {0x7E0, IdFormat::Standard, "EXAMPLE", "EXAMPLE", 100, "periodic", 5, kExampleFields, 3,
     "none", "EXAMPLE test data only", EntryStatus::Verified},
    {0x7E1, IdFormat::Standard, "EXAMPLE", "EXAMPLE", 0, "event", 5, kExampleFields, 3, "none",
     "EXAMPLE test data only", EntryStatus::Unverified},
};

static const Registry kExample = {"EXAMPLE", kExampleEntries, 2};

static RawFrame frame(uint32_t id, uint8_t dlc) {
  RawFrame f;
  memset(&f, 0, sizeof(f));
  f.can_id = id;
  f.dlc = dlc;
  // 0x01F4 BE = 500 ; 0xFFF6 LE (bytes F6 FF) = -10 ; 0x2A = 42
  const uint8_t payload[8] = {0x01, 0xF4, 0xF6, 0xFF, 0x2A, 0, 0, 0};
  memcpy(f.data, payload, 8);
  return f;
}

int main() {
  {  // Production registry is intentionally empty -> every frame is unknown but kept.
    Registry prod = production_registry();
    CHECK(prod.count == 0);
    DecodeResult r = decode_frame(prod, frame(0x123, 8));
    CHECK(r.status == DecodeStatus::Unknown);
    CHECK(r.entry == nullptr);
  }
  {  // Verified EXAMPLE entry decodes with scaling.
    DecodeResult r = decode_frame(kExample, frame(0x7E0, 5));
    CHECK(r.status == DecodeStatus::Decoded);
    CHECK(r.field_count == 3);
    CHECK(r.fields[0].raw == 500);
    CHECK(r.fields[0].has_physical && fabs(r.fields[0].physical - 50.0) < 1e-9);
    CHECK(r.fields[1].raw == -10);
    CHECK(r.fields[1].has_physical && fabs(r.fields[1].physical - (-50.0)) < 1e-9);
    CHECK(r.fields[2].raw == 42);
    CHECK(!r.fields[2].has_physical);  // scaling unknown -> raw only
  }
  {  // Unverified entry: raw values only, never physical values.
    DecodeResult r = decode_frame(kExample, frame(0x7E1, 5));
    CHECK(r.status == DecodeStatus::Unverified);
    CHECK(r.field_count == 3);
    CHECK(r.fields[0].raw == 500);
    CHECK(!r.fields[0].has_physical);
    CHECK(!r.fields[1].has_physical);
  }
  {  // DLC mismatch or RTR -> mismatch, no field values.
    DecodeResult r = decode_frame(kExample, frame(0x7E0, 4));
    CHECK(r.status == DecodeStatus::Mismatch);
    CHECK(r.field_count == 0);
    RawFrame rtr = frame(0x7E0, 5);
    rtr.remote = true;
    CHECK(decode_frame(kExample, rtr).status == DecodeStatus::Mismatch);
  }
  {  // Same numeric ID but extended format is a different identifier.
    RawFrame f = frame(0x7E0, 5);
    f.format = IdFormat::Extended;
    CHECK(decode_frame(kExample, f).status == DecodeStatus::Unknown);
  }
  {  // Field outside payload / unverified multi-byte order is refused.
    FieldDef outside = {"x", 7, 2, false, ByteOrder::BigEndian, false, 1, 0, ""};
    int64_t v = 0;
    CHECK(!extract_raw(frame(0x7E0, 8), outside, v));
    FieldDef unknown_order = {"x", 0, 2, false, ByteOrder::Unverified, false, 1, 0, ""};
    CHECK(!extract_raw(frame(0x7E0, 8), unknown_order, v));
    FieldDef s32 = {"x", 0, 4, true, ByteOrder::LittleEndian, false, 1, 0, ""};
    CHECK(extract_raw(frame(0x7E0, 8), s32, v));
    CHECK(v == static_cast<int32_t>(0xFFF6F401u));
  }
  {  // Legacy test-sketch registry mirrors sketch_node2_test.ino and stays UNVERIFIED.
    Registry legacy = legacy_test_sketch_registry();
    CHECK(legacy.count == 4);
    for (size_t i = 0; i < legacy.count; ++i) {
      CHECK(legacy.entries[i].status == EntryStatus::Unverified);
      CHECK(legacy.entries[i].format == IdFormat::Standard);
    }
    RawFrame f = frame(0x201, 2);
    f.data[0] = 0x01;  // 480 = 0x01E0, as the sketch sends it
    f.data[1] = 0xE0;
    DecodeResult r = decode_frame(legacy, f);
    CHECK(r.status == DecodeStatus::Unverified);
    CHECK(r.fields[0].raw == 480);
    CHECK(!r.fields[0].has_physical);
    CHECK(decode_frame(legacy, frame(0x210, 1)).status == DecodeStatus::Unverified);
    CHECK(decode_frame(legacy, frame(0x211, 1)).status == DecodeStatus::Unknown);
  }
  CHECK_STR_EQ(decode_status_name(DecodeStatus::Mismatch), "mismatch");
  TEST_MAIN_END();
}
