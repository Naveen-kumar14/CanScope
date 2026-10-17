#include "serial_link.h"

#include <string.h>

#include "json_writer.h"
#include "protocol_spec.h"

namespace canscope {

namespace {

bool is_id_char(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' ||
         c == '-';
}

bool is_space(char c) { return c == ' ' || c == '\t'; }

}  // namespace

LineAssembler::LineAssembler() { reset(); }

void LineAssembler::reset() {
  len_ = 0;
  overflow_ = false;
  ready_ = false;
  buf_[0] = '\0';
}

LineAssembler::Result LineAssembler::feed(char c) {
  if (ready_) {
    // The previous line was consumed by the caller; start a new one.
    len_ = 0;
    buf_[0] = '\0';
    ready_ = false;
  }
  if (c == '\r' || c == '\n') {
    if (overflow_) {
      overflow_ = false;
      len_ = 0;
      buf_[0] = '\0';
      return Result::Overflow;
    }
    if (len_ == 0) return Result::None;  // CRLF pairs and blank lines
    buf_[len_] = '\0';
    ready_ = true;
    return Result::Line;
  }
  if (overflow_) return Result::None;
  if (len_ >= kMaxCommandLine) {
    overflow_ = true;
    return Result::None;
  }
  buf_[len_++] = c;
  return Result::None;
}

CommandParse parse_command(const char* line, Command& out) {
  memset(&out, 0, sizeof(out));
  if (line == nullptr) return CommandParse::Empty;
  for (const char* p = line; *p; ++p) {
    const unsigned char c = static_cast<unsigned char>(*p);
    if ((c < 0x20 && c != '\t') || c > 0x7E) return CommandParse::BadCharacter;
  }

  const char* p = line;
  while (is_space(*p)) ++p;
  if (*p == '\0') return CommandParse::Empty;

  if (*p == '@') {
    ++p;
    size_t n = 0;
    while (*p && !is_space(*p)) {
      if (!is_id_char(*p) || n >= kMaxCommandId) return CommandParse::BadId;
      out.id[n++] = *p++;
    }
    if (n == 0) return CommandParse::BadId;
    out.id[n] = '\0';
    while (is_space(*p)) ++p;
    if (*p == '\0') return CommandParse::Empty;
  }

  size_t token = 0;  // 0 = verb, 1.. = args
  while (*p) {
    if (token > kMaxArgs) return CommandParse::TooManyArgs;
    char* dst = token == 0 ? out.verb : out.args[token - 1];
    size_t n = 0;
    while (*p && !is_space(*p)) {
      if (n >= kMaxToken) return CommandParse::TokenTooLong;
      dst[n++] = *p++;
    }
    dst[n] = '\0';
    ++token;
    while (is_space(*p)) ++p;
  }
  out.argc = static_cast<uint8_t>(token - 1);
  return CommandParse::Ok;
}

const char* command_parse_text(CommandParse result) {
  switch (result) {
    case CommandParse::Ok: return "ok";
    case CommandParse::Empty: return "empty line";
    case CommandParse::BadId: return "invalid command id (use @ + 1-16 of A-Z a-z 0-9 _ -)";
    case CommandParse::TokenTooLong: return "token longer than 23 characters";
    case CommandParse::TooManyArgs: return "more than 4 arguments";
    case CommandParse::BadCharacter: return "control or non-ASCII character in command";
  }
  return "invalid command";
}

void extract_command_id(const char* line, char* id_out, size_t id_len) {
  if (id_len == 0) return;
  id_out[0] = '\0';
  if (line == nullptr) return;
  while (is_space(*line)) ++line;
  if (*line != '@') return;
  ++line;
  size_t n = 0;
  while (line[n] && is_id_char(line[n])) {
    if (n >= kMaxCommandId || n + 1 >= id_len) {
      id_out[0] = '\0';
      return;
    }
    ++n;
  }
  if (line[n] != '\0' && !is_space(line[n])) return;  // invalid id: unmatched
  memcpy(id_out, line, n);
  id_out[n] = '\0';
}

size_t command_text(const Command& cmd, char* out, size_t out_len) {
  if (out_len == 0) return 0;
  size_t pos = 0;
  const char* parts[1 + kMaxArgs];
  parts[0] = cmd.verb;
  for (uint8_t i = 0; i < cmd.argc && i < kMaxArgs; ++i) parts[1 + i] = cmd.args[i];
  for (size_t i = 0; i < 1u + cmd.argc; ++i) {
    const size_t n = strlen(parts[i]);
    if (pos + (i ? 1 : 0) + n + 1 > out_len) break;
    if (i) out[pos++] = ' ';
    memcpy(out + pos, parts[i], n);
    pos += n;
  }
  out[pos] = '\0';
  return pos;
}

const char* ack_status_name(AckStatus status) {
  switch (status) {
    case AckStatus::Ok: return "ok";
    case AckStatus::Rejected: return "rejected";
    case AckStatus::Unsupported: return "unsupported";
  }
  return "rejected";
}

size_t encode_ack(const char* node, uint64_t device_time_us, const char* boot_id, const char* id,
                  const char* command, AckStatus status, const char* detail, char* out,
                  size_t out_len) {
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "ack");
  w.field_string("sourceNode", node ? node : "unknown");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_string("bootId", boot_id ? boot_id : "");
  w.field_string("id", id ? id : "");
  w.field_string("command", command ? command : "");
  w.field_string("status", ack_status_name(status));
  w.field_string("detail", detail ? detail : "");
  w.end_object();
  return w.finish();
}

size_t encode_hello(const HelloInfo& info, uint64_t device_time_us, char* out, size_t out_len) {
  JsonWriter w(out, out_len);
  w.begin_object();
  w.field_string("type", "hello");
  w.field_string("sourceNode", info.node ? info.node : "unknown");
  w.field_u64("deviceTimeUs", device_time_us);
  w.field_u64("nodeId", info.node_id);
  w.field_string("role", info.role ? info.role : "unknown");
  w.field_string("firmware", info.firmware ? info.firmware : "");
  w.field_string("bootId", info.boot_id ? info.boot_id : "");
  w.field_u64("protocolVersion", proto::kProtocolVersion);
  w.field_u64("serialProtocolVersion", proto::kSerialProtocolVersion);
  w.field_string("commands", info.commands ? info.commands : "");
  w.end_object();
  return w.finish();
}

void format_boot_id(uint32_t value, char* out) {
  static const char kHex[] = "0123456789abcdef";
  for (int i = 0; i < 8; ++i) out[i] = kHex[(value >> ((7 - i) * 4)) & 0xF];
  out[8] = '\0';
}

}  // namespace canscope
