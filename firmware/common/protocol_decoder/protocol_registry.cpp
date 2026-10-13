#include "protocol_registry.h"

namespace canscope {

namespace {

// Observed in sketch_node2_test.ino: values are big-endian (high byte first in
// the source) but they are hard-coded test constants and their units/scaling
// are not documented anywhere. Kept UNVERIFIED with scaling unknown.
const FieldDef kLegacy201[] = {
    {"voltage_raw", 0, 2, false, ByteOrder::BigEndian, false, 1.0, 0.0, ""}};
const FieldDef kLegacy202[] = {
    {"current_raw", 0, 2, true, ByteOrder::BigEndian, false, 1.0, 0.0, ""}};
const FieldDef kLegacy203[] = {
    {"soc_raw", 0, 1, false, ByteOrder::BigEndian, false, 1.0, 0.0, ""}};
const FieldDef kLegacy210[] = {
    {"heartbeat_raw", 0, 1, false, ByteOrder::BigEndian, false, 1.0, 0.0, ""}};

const char kLegacyEvidence[] =
    "sketch_node2_test.ino source only (test sketch, constant values, never captured)";

const RegistryEntry kLegacyEntries[] = {
    {0x201, IdFormat::Standard, "node2 (test sketch)", "unspecified", 1000, "periodic", 2,
     kLegacy201, 1, "none observed", kLegacyEvidence, EntryStatus::Unverified},
    {0x202, IdFormat::Standard, "node2 (test sketch)", "unspecified", 1000, "periodic", 2,
     kLegacy202, 1, "none observed", kLegacyEvidence, EntryStatus::Unverified},
    {0x203, IdFormat::Standard, "node2 (test sketch)", "unspecified", 1000, "periodic", 1,
     kLegacy203, 1, "none observed", kLegacyEvidence, EntryStatus::Unverified},
    {0x210, IdFormat::Standard, "node2 (test sketch)", "unspecified", 500, "periodic", 1,
     kLegacy210, 1, "none observed", kLegacyEvidence, EntryStatus::Unverified},
};

}  // namespace

Registry production_registry() {
  Registry r = {"production", nullptr, 0};
  return r;
}

Registry legacy_test_sketch_registry() {
  Registry r = {"legacy_test_sketch", kLegacyEntries,
                sizeof(kLegacyEntries) / sizeof(kLegacyEntries[0])};
  return r;
}

const RegistryEntry* find_entry(const Registry& registry, uint32_t can_id, IdFormat format) {
  for (size_t i = 0; i < registry.count; ++i) {
    const RegistryEntry& e = registry.entries[i];
    if (e.can_id == can_id && e.format == format) return &e;
  }
  return nullptr;
}

bool extract_raw(const RawFrame& frame, const FieldDef& field, int64_t& out) {
  const size_t len = payload_length(frame);
  if (field.length_bytes == 0 || field.length_bytes > 4) return false;
  if (static_cast<size_t>(field.start_byte) + field.length_bytes > len) return false;
  if (field.byte_order == ByteOrder::Unverified && field.length_bytes > 1) return false;

  uint32_t value = 0;
  for (uint8_t i = 0; i < field.length_bytes; ++i) {
    const uint8_t index = field.byte_order == ByteOrder::LittleEndian
                              ? static_cast<uint8_t>(field.start_byte + field.length_bytes - 1 - i)
                              : static_cast<uint8_t>(field.start_byte + i);
    value = (value << 8) | frame.data[index];
  }

  if (field.is_signed) {
    const unsigned bits = field.length_bytes * 8u;
    const uint32_t sign = 1u << (bits - 1);
    if (bits < 32 && (value & sign)) {
      out = static_cast<int64_t>(value) - (static_cast<int64_t>(1) << bits);
    } else if (bits == 32) {
      out = static_cast<int32_t>(value);
    } else {
      out = value;
    }
  } else {
    out = value;
  }
  return true;
}

DecodeResult decode_frame(const Registry& registry, const RawFrame& frame) {
  DecodeResult result;
  result.status = DecodeStatus::Unknown;
  result.entry = find_entry(registry, frame.can_id, frame.format);
  result.field_count = 0;
  if (result.entry == nullptr) return result;

  const RegistryEntry& e = *result.entry;
  if (frame.remote || frame.dlc != e.dlc) {
    result.status = DecodeStatus::Mismatch;
    return result;
  }

  const bool verified = e.status == EntryStatus::Verified;
  for (size_t i = 0; i < e.field_count && result.field_count < kMaxDecodedFields; ++i) {
    const FieldDef& f = e.fields[i];
    int64_t raw = 0;
    if (!extract_raw(frame, f, raw)) {
      result.status = DecodeStatus::Mismatch;
      result.field_count = 0;
      return result;
    }
    DecodedField& out = result.fields[result.field_count++];
    out.name = f.name;
    out.raw = raw;
    out.has_physical = verified && f.scaling_known;
    out.physical = out.has_physical ? static_cast<double>(raw) * f.factor + f.offset : 0.0;
    out.unit = f.unit;
  }
  result.status = verified ? DecodeStatus::Decoded : DecodeStatus::Unverified;
  return result;
}

const char* decode_status_name(DecodeStatus status) {
  switch (status) {
    case DecodeStatus::Unknown: return "unknown";
    case DecodeStatus::Unverified: return "unverified";
    case DecodeStatus::Decoded: return "decoded";
    case DecodeStatus::Mismatch: return "mismatch";
  }
  return "unknown";
}

}  // namespace canscope
