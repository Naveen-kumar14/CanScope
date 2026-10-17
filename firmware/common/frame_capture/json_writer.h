// Minimal bounded JSON writer for serial event lines. No heap, no printf
// dependency for 64-bit integers (newlib-nano may lack %llu).
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace canscope {

class JsonWriter {
 public:
  JsonWriter(char* out, size_t out_len);

  void begin_object();
  void end_object();
  void key(const char* name);  // writes separator + "name":
  void field_string(const char* name, const char* value);
  void field_u64(const char* name, uint64_t value);
  void field_bool(const char* name, bool value);
  void field_i64(const char* name, int64_t value);
  // Raw integer with implied decimals as a JSON number: (652, 1) -> 65.2
  void field_scaled(const char* name, int32_t raw, uint8_t decimals);
  // Writes "name":{ ; close with end_object().
  void field_object(const char* name);
  void field_hex_id(const char* name, uint32_t id, bool extended);  // "0x201" / "0x18FF0001"
  void raw(const char* text);
  void u64(uint64_t value);
  void i64(int64_t value);
  void string(const char* s);  // quoted, escaped

  // NUL-terminates; returns length, or 0 if anything overflowed.
  size_t finish();

 private:
  void put(char c);

  char* out_;
  size_t cap_;
  size_t len_;
  bool overflow_;
  bool first_field_;
};

}  // namespace canscope
