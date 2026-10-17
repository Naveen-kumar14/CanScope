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

void JsonWriter::end_object() {
  put('}');
  first_field_ = false;  // a closed nested object counts as a field of its parent
}

void JsonWriter::field_object(const char* name) {
  key(name);
  begin_object();
}

void JsonWriter::i64(int64_t value) {
  if (value < 0) {
    put('-');
    u64(static_cast<uint64_t>(0) - static_cast<uint64_t>(value));
  } else {
    u64(static_cast<uint64_t>(value));
  }
}

void JsonWriter::field_i64(const char* name, int64_t value) {
  key(name);
  i64(value);
}

void JsonWriter::field_scaled(const char* name, int32_t raw, uint8_t decimals) {
  key(name);
  const bool negative = raw < 0;
  uint32_t v = negative ? 0u - static_cast<uint32_t>(raw) : static_cast<uint32_t>(raw);
  uint32_t div = 1;
  for (uint8_t i = 0; i < decimals; ++i) div *= 10;
  if (negative) put('-');
  u64(v / div);
  if (decimals) {
    put('.');
    uint32_t frac = v % div;
    for (uint32_t d = div / 10; d > 0; d /= 10) {
      put(static_cast<char>('0' + (frac / d) % 10));
    }
  }
}

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
