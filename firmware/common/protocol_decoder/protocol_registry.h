// CANScope protocol registry and decoder interface.
//
// The authoritative human-readable registry is docs/protocol/can-id-registry.md.
// Code registries must mirror it. NO production IDs are defined: none have
// evidence yet. Decoding never replaces raw capture; the raw frame is always
// kept by the caller.
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "raw_frame.h"

namespace canscope {

enum class ByteOrder : uint8_t { BigEndian, LittleEndian, Unverified };

enum class EntryStatus : uint8_t {
  Unverified,  // observed or proposed, no specification/capture evidence
  Verified,    // backed by a named specification, capture or bench test
};

struct FieldDef {
  const char* name;
  uint8_t start_byte;
  uint8_t length_bytes;  // 1..4
  bool is_signed;
  ByteOrder byte_order;
  bool scaling_known;    // false => only the raw integer is reported
  double factor;
  double offset;
  const char* unit;      // "" if unknown
};

struct RegistryEntry {
  uint32_t can_id;
  IdFormat format;
  const char* sender;
  const char* receivers;
  uint32_t period_ms;    // 0 = event-driven or unknown (see trigger)
  const char* trigger;
  uint8_t dlc;
  const FieldDef* fields;
  size_t field_count;
  const char* counter_checksum;
  const char* evidence;
  EntryStatus status;
};

struct Registry {
  const char* name;
  const RegistryEntry* entries;
  size_t count;
};

// Production registry: intentionally empty until IDs have evidence.
Registry production_registry();

// IDs observed in the existing sketch_node2_test.ino test sketch. They are
// test traffic with hard-coded constants and unknown units -> UNVERIFIED.
Registry legacy_test_sketch_registry();

const RegistryEntry* find_entry(const Registry& registry, uint32_t can_id, IdFormat format);

enum class DecodeStatus : uint8_t {
  Unknown,     // no registry entry: raw frame only
  Unverified,  // entry exists but is not verified: raw field values only
  Decoded,     // verified entry and frame matches its definition
  Mismatch,    // entry exists but DLC/RTR does not match: raw frame only
};

static const size_t kMaxDecodedFields = 8;

struct DecodedField {
  const char* name;
  int64_t raw;
  bool has_physical;  // only when entry verified AND scaling known
  double physical;
  const char* unit;
};

struct DecodeResult {
  DecodeStatus status;
  const RegistryEntry* entry;  // nullptr when Unknown
  DecodedField fields[kMaxDecodedFields];
  size_t field_count;
};

DecodeResult decode_frame(const Registry& registry, const RawFrame& frame);

// Extracts an integer field; returns false if it lies outside the payload.
bool extract_raw(const RawFrame& frame, const FieldDef& field, int64_t& out);

const char* decode_status_name(DecodeStatus status);

}  // namespace canscope
