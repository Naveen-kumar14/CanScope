// CANScope protocol v1 codec tests: golden vectors (shared with the dashboard),
// validation of malformed frames, and exact decimal parsing/formatting.
#include <string.h>

#include "can_protocol.h"
#include "mini_test.h"
#include "protocol_vectors.generated.h"
#include "serial_link.h"

using namespace canscope;
using namespace canscope::proto;

static void values_for(const ProtocolVector& v, int32_t* values) {
  memset(values, 0, sizeof(int32_t) * kFieldCount);
  if (v.can_id == kMotorTelemetryId) {
    values[static_cast<size_t>(FieldId::Rpm)] = v.values[0];
    values[static_cast<size_t>(FieldId::MotorTempC)] = v.values[1];
  } else if (v.can_id == kBatteryTelemetryId) {
    values[static_cast<size_t>(FieldId::PackVoltageV)] = v.values[0];
    values[static_cast<size_t>(FieldId::PackCurrentA)] = v.values[1];
    values[static_cast<size_t>(FieldId::SocPct)] = v.values[2];
  }
}

static RawFrame good_motor(int32_t rpm, int32_t temp, uint8_t counter) {
  int32_t values[kFieldCount] = {0};
  values[static_cast<size_t>(FieldId::Rpm)] = rpm;
  values[static_cast<size_t>(FieldId::MotorTempC)] = temp;
  RawFrame f;
  encode_motor(values, counter, f);
  return f;
}

static void test_vectors() {
  CHECK(kProtocolVectorCount >= 10);
  for (unsigned i = 0; i < kProtocolVectorCount; ++i) {
    const ProtocolVector& v = kProtocolVectors[i];
    RawFrame f;
    if (v.can_id == kMotorTelemetryId || v.can_id == kBatteryTelemetryId) {
      int32_t values[kFieldCount];
      values_for(v, values);
      if (v.can_id == kMotorTelemetryId) {
        encode_motor(values, v.counter, f);
      } else {
        encode_battery(values, v.counter, f);
      }
    } else {
      Heartbeat hb = {static_cast<uint8_t>(v.values[0]), static_cast<uint8_t>(v.values[1]),
                      static_cast<uint8_t>(v.values[2]), static_cast<uint8_t>(v.values[3]),
                      static_cast<uint8_t>(v.values[4]), static_cast<uint8_t>(v.values[5])};
      encode_heartbeat(hb, v.counter, f);
    }
    CHECK(f.can_id == v.can_id);
    CHECK(f.dlc == 8);
    CHECK(f.format == IdFormat::Standard);
    const bool same = memcmp(f.data, v.bytes, 8) == 0;
    if (!same) printf("  vector mismatch: %s\n", v.label);
    CHECK(same);

    // Decoding the golden bytes must give back the inputs.
    RawFrame rx;
    memset(&rx, 0, sizeof(rx));
    rx.can_id = v.can_id;
    rx.dlc = 8;
    memcpy(rx.data, v.bytes, 8);
    const DecodedFrame d = decode(rx);
    CHECK(d.check == FrameCheck::Ok);
    CHECK(d.counter == v.counter);
    if (d.kind == FrameKind::MotorTelemetry) {
      CHECK(d.node_id == kNodeIdNode1);
      CHECK(d.values[static_cast<size_t>(FieldId::Rpm)] == v.values[0]);
      CHECK(d.values[static_cast<size_t>(FieldId::MotorTempC)] == v.values[1]);
    } else if (d.kind == FrameKind::BatteryTelemetry) {
      CHECK(d.node_id == kNodeIdNode2);
      CHECK(d.values[static_cast<size_t>(FieldId::PackVoltageV)] == v.values[0]);
      CHECK(d.values[static_cast<size_t>(FieldId::PackCurrentA)] == v.values[1]);
      CHECK(d.values[static_cast<size_t>(FieldId::SocPct)] == v.values[2]);
    } else {
      CHECK(d.kind == FrameKind::Heartbeat);
      CHECK(d.heartbeat.node_id == v.values[1]);
      CHECK(d.heartbeat.protocol_version == kProtocolVersion);
    }
  }
}

static void test_known_bytes() {
  // Hand-checked: rpm 1500 = 0x05DC, temp 65.0 = 650 = 0x028A, counter 0.
  RawFrame f = good_motor(1500, 650, 0);
  CHECK(f.can_id == 0x120);
  CHECK(f.data[0] == 0x05 && f.data[1] == 0xDC && f.data[2] == 0x02 && f.data[3] == 0x8A);
  CHECK(f.data[4] == 0 && f.data[5] == 0 && f.data[6] == 0);
  // ~(0x01 + 0x20 + 0x05 + 0xDC + 0x02 + 0x8A) & 0xFF = ~0x18E & 0xFF = 0x71
  CHECK(f.data[7] == 0x71);
  // Negative temperature: -12.3 C = -123 = 0xFF85.
  f = good_motor(0, -123, 5);
  CHECK(f.data[2] == 0xFF && f.data[3] == 0x85);
  CHECK(decode(f).values[static_cast<size_t>(FieldId::MotorTempC)] == -123);
}

static void test_rejections() {
  RawFrame f = good_motor(1500, 650, 3);
  CHECK(decode(f).check == FrameCheck::Ok);

  RawFrame bad = f;
  bad.dlc = 4;
  CHECK(decode(bad).check == FrameCheck::BadDlc);
  bad = f;
  bad.dlc = 15;  // CAN DLC codes 9..15 still mean 8 bytes on classical CAN
  CHECK(decode(bad).check == FrameCheck::BadDlc);
  bad = f;
  bad.remote = true;
  CHECK(decode(bad).check == FrameCheck::Remote);
  bad = f;
  bad.data[7] ^= 0x01;
  CHECK(decode(bad).check == FrameCheck::BadChecksum);
  bad = f;
  bad.data[0] ^= 0x01;  // payload corrupted, checksum stale
  CHECK(decode(bad).check == FrameCheck::BadChecksum);
  bad = f;
  bad.format = IdFormat::Extended;
  CHECK(decode(bad).check == FrameCheck::ExtendedId);
  CHECK(decode(bad).kind == FrameKind::Unknown);

  RawFrame unknown = f;
  unknown.can_id = 0x201;  // legacy test-sketch ID, not part of v1
  CHECK(decode(unknown).check == FrameCheck::UnsupportedId);
  unknown.can_id = 0x7FF;
  CHECK(decode(unknown).check == FrameCheck::UnsupportedId);

  // Out-of-range value with a correct checksum (what demo fault invalid_value sends).
  RawFrame range = good_motor(0xFFFF, 650, 1);
  DecodedFrame d = decode(range);
  CHECK(d.check == FrameCheck::ValueOutOfRange);
  CHECK(d.bad_field == FieldId::Rpm);
  range = good_motor(8001, 650, 1);
  CHECK(decode(range).check == FrameCheck::ValueOutOfRange);
  range = good_motor(8000, 1500, 1);
  CHECK(decode(range).check == FrameCheck::Ok);
  range = good_motor(0, -401, 1);
  CHECK(decode(range).check == FrameCheck::ValueOutOfRange);
  CHECK(decode(range).bad_field == FieldId::MotorTempC);

  int32_t bv[kFieldCount] = {0};
  bv[static_cast<size_t>(FieldId::PackVoltageV)] = 4800;
  bv[static_cast<size_t>(FieldId::PackCurrentA)] = -1501;
  bv[static_cast<size_t>(FieldId::SocPct)] = 50;
  RawFrame batt;
  encode_battery(bv, 0, batt);
  CHECK(decode(batt).check == FrameCheck::ValueOutOfRange);
  CHECK(decode(batt).bad_field == FieldId::PackCurrentA);
  bv[static_cast<size_t>(FieldId::PackCurrentA)] = 0;
  bv[static_cast<size_t>(FieldId::SocPct)] = 101;
  encode_battery(bv, 0, batt);
  CHECK(decode(batt).bad_field == FieldId::SocPct);

  // Heartbeats.
  Heartbeat hb = {kProtocolVersion, kNodeIdNode1, 1, 0, 0, 0};
  RawFrame h;
  encode_heartbeat(hb, 0, h);
  CHECK(h.can_id == 0x701);
  CHECK(decode(h).check == FrameCheck::Ok);
  hb.protocol_version = kBadProtocolVersion;
  encode_heartbeat(hb, 0, h);
  CHECK(decode(h).check == FrameCheck::UnsupportedVersion);
  CHECK(decode(h).heartbeat.protocol_version == 99);
  hb.protocol_version = kProtocolVersion;
  hb.can_state = 3;
  encode_heartbeat(hb, 0, h);
  CHECK(decode(h).check == FrameCheck::ValueOutOfRange);
  hb.can_state = 0;
  encode_heartbeat(hb, 0, h);
  h.data[kHbNodeIdByte] = 2;  // node 2 id on node 1's heartbeat ID
  h.data[kChecksumByte] = compute_checksum(h.can_id, h.data);
  CHECK(decode(h).check == FrameCheck::BadNodeId);
}

static void test_numbers() {
  int32_t raw = 0;
  CHECK(parse_scaled("65.2", 1, raw) == NumberParse::Ok && raw == 652);
  CHECK(parse_scaled("65", 1, raw) == NumberParse::Ok && raw == 650);
  CHECK(parse_scaled("-40.0", 1, raw) == NumberParse::Ok && raw == -400);
  CHECK(parse_scaled("+3", 0, raw) == NumberParse::Ok && raw == 3);
  CHECK(parse_scaled("48.05", 2, raw) == NumberParse::Ok && raw == 4805);
  CHECK(parse_scaled("0", 2, raw) == NumberParse::Ok && raw == 0);
  CHECK(parse_scaled("65.25", 1, raw) == NumberParse::TooManyDecimals);
  CHECK(parse_scaled("1.5", 0, raw) == NumberParse::TooManyDecimals);
  CHECK(parse_scaled("", 0, raw) == NumberParse::Empty);
  CHECK(parse_scaled("abc", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("1e3", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("0x10", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("12 ", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("1.", 1, raw) == NumberParse::Syntax);
  CHECK(parse_scaled(".5", 1, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("-", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("1.2.3", 2, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("nan", 0, raw) == NumberParse::Syntax);
  CHECK(parse_scaled("99999999999", 0, raw) == NumberParse::Overflow);
  CHECK(parse_scaled("21474837", 2, raw) == NumberParse::Overflow);

  char buf[16];
  CHECK(format_scaled(652, 1, buf, sizeof(buf)) == 4);
  CHECK_STR_EQ(buf, "65.2");
  format_scaled(-123, 1, buf, sizeof(buf));
  CHECK_STR_EQ(buf, "-12.3");
  format_scaled(5, 2, buf, sizeof(buf));
  CHECK_STR_EQ(buf, "0.05");
  format_scaled(-5, 2, buf, sizeof(buf));
  CHECK_STR_EQ(buf, "-0.05");
  format_scaled(1500, 0, buf, sizeof(buf));
  CHECK_STR_EQ(buf, "1500");
  format_scaled(0, 0, buf, sizeof(buf));
  CHECK_STR_EQ(buf, "0");
  CHECK(format_scaled(123456, 2, buf, 4) == 0);  // too small: empty string, not truncated digits
  CHECK_STR_EQ(buf, "");
}

static void test_names_and_tables() {
  CHECK(kFaultCount == static_cast<size_t>(FaultCode::Count));
  for (size_t i = 0; i < kFaultCount; ++i) CHECK(kFaults[i].code == static_cast<FaultCode>(i));
  for (size_t i = 0; i < kFieldCount; ++i) CHECK(kFields[i].id == static_cast<FieldId>(i));
  CHECK_STR_EQ(fault_name(FaultCode::HeartbeatLost), "HEARTBEAT_LOST");
  CHECK_STR_EQ(node_name(1), "node1");
  CHECK_STR_EQ(node_name(3), "monitor");
  CHECK_STR_EQ(node_name(9), "unknown");
  DemoFault f;
  CHECK(parse_demo_fault("bad_dlc", f) && f == DemoFault::BadDlc);
  CHECK(!parse_demo_fault("explode", f));
  CHECK(find_field("motorTempC") != nullptr);
  CHECK(find_field("nope") == nullptr);
  CHECK(kMaxCommandLine == kSerialMaxCommandLine);
  CHECK(heartbeat_id(3) == 0 && telemetry_id(3) == 0);
}

int main() {
  test_vectors();
  test_known_bytes();
  test_rejections();
  test_numbers();
  test_names_and_tables();
  TEST_MAIN_END();
}
