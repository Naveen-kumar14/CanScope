#include "json_writer.h"

namespace canscope {

JsonWriter::JsonWriter(char* out, size_t out_len)
    : out_(out), cap_(out_len), len_(0), overflow_(out == nullptr || out_len == 0), first_field_(true) {}

void JsonWriter::put(char c) {
  // Always keep one byte for the terminating NUL.
  if (overflow_ || len_ + 1 >= cap_) {
    overflow_ = true;
    return;
  }
  out_[len_++] = c;
}

void JsonWriter::raw(const char* text) {
  while (*text) put(*text++);
}

void JsonWriter::string(const char* s) {
  static const char kHex[] = "0123456789abcdef";
  put('"');
  for (; *s; ++s) {
    const unsigned char c = static_cast<unsigned char>(*s);
    if (c == '"' || c == '\\') {
      put('\\');
      put(static_cast<char>(c));
    } else if (c < 0x20) {
      raw("\\u00");
      put(kHex[c >> 4]);
      put(kHex[c & 0xF]);
    } else {
      put(static_cast<char>(c));
    }
  }
  put('"');
}

void JsonWriter::u64(uint64_t value) {
  char digits[21];
  size_t n = 0;
  do {
    digits[n++] = static_cast<char>('0' + value % 10);
    value /= 10;
  } while (value);
  while (n) put(digits[--n]);
}

void JsonWriter::begin_object() {
  put('{');
  first_field_ = true;
}

void JsonWriter::end_object() { put('}'); }

void JsonWriter::key(const char* name) {
  if (!first_field_) put(',');
  first_field_ = false;
  string(name);
  put(':');
}

void JsonWriter::field_string(const char* name, const char* value) {
  key(name);
  string(value);
}

void JsonWriter::field_u64(const char* name, uint64_t value) {
  key(name);
  u64(value);
}

void JsonWriter::field_bool(const char* name, bool value) {
  key(name);
  raw(value ? "true" : "false");
}

void JsonWriter::field_hex_id(const char* name, uint32_t id, bool extended) {
  static const char kHex[] = "0123456789ABCDEF";
  key(name);
  raw("\"0x");
  const int nibbles = extended ? 8 : 3;
  for (int i = nibbles - 1; i >= 0; --i) put(kHex[(id >> (i * 4)) & 0xF]);
  put('"');
}

size_t JsonWriter::finish() {
  if (overflow_) {
    if (cap_) out_[0] = '\0';
    return 0;
  }
  out_[len_] = '\0';
  return len_;
}

}  // namespace canscope
