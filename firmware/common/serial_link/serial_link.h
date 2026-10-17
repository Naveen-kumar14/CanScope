// CANScope USB-serial command link (host -> device) and the reply/identity
// lines (device -> host). Portable C++11, unit-tested on the host.
//
// Command line grammar (ASCII, one per line, CR and/or LF terminated):
//   [@<id> ]<verb> [<arg> ...]
//   <id>   1..16 chars of [A-Za-z0-9_-]; echoed in the ack so the dashboard
//          can match replies. Optional for hand-typed commands (ack id "").
//   <verb>, <arg>: tokens of printable ASCII without spaces, max 23 chars,
//          at most 4 args. Lines longer than proto::kSerialMaxCommandLine are
//          discarded whole and answered with an "overflow" rejection.
#pragma once

#include <stddef.h>
#include <stdint.h>

namespace canscope {

static const size_t kMaxCommandLine = 120;  // == proto::kSerialMaxCommandLine (checked in tests)
static const size_t kMaxCommandId = 16;
static const size_t kMaxToken = 23;
static const size_t kMaxArgs = 4;

// Accumulates bytes into lines with a hard length limit. No heap.
class LineAssembler {
 public:
  enum class Result : uint8_t { None, Line, Overflow };

  LineAssembler();
  // Feed one received byte. Line: line() holds the completed line until the
  // next feed. Overflow: an over-long line was dropped (reported once, at its end).
  Result feed(char c);
  const char* line() const { return buf_; }
  void reset();

 private:
  char buf_[kMaxCommandLine + 1];
  size_t len_;
  bool overflow_;
  bool ready_;
};

struct Command {
  char id[kMaxCommandId + 1];
  char verb[kMaxToken + 1];
  char args[kMaxArgs][kMaxToken + 1];
  uint8_t argc;
};

enum class CommandParse : uint8_t {
  Ok,
  Empty,          // blank line: ignore silently
  BadId,          // "@" with an empty/over-long/invalid id
  TokenTooLong,
  TooManyArgs,
  BadCharacter,   // control or non-ASCII byte
};

CommandParse parse_command(const char* line, Command& out);
const char* command_parse_text(CommandParse result);

// Best-effort id recovery from a line that failed to parse, so a rejection
// can still be matched by the dashboard. Writes "" when there is none.
void extract_command_id(const char* line, char* id_out, size_t id_len);

// Rebuilds "verb arg1 arg2" for the ack's "command" field.
size_t command_text(const Command& cmd, char* out, size_t out_len);

enum class AckStatus : uint8_t { Ok, Rejected, Unsupported };
const char* ack_status_name(AckStatus status);

// {"type":"ack","sourceNode":..,"deviceTimeUs":..,"bootId":..,"id":..,
//  "command":..,"status":"ok|rejected|unsupported","detail":..}
size_t encode_ack(const char* node, uint64_t device_time_us, const char* boot_id, const char* id,
                  const char* command, AckStatus status, const char* detail, char* out,
                  size_t out_len);

struct HelloInfo {
  const char* node;      // "node1" / "node2" / "monitor"
  uint8_t node_id;       // 1 / 2 / 3
  const char* role;      // "motor_ecu" / "battery_ecu" / "monitor"
  const char* firmware;  // "1.0.0"
  const char* boot_id;   // 8 hex chars, random per boot
  const char* commands;  // space-separated supported verbs, e.g. "hello status set fault"
};

// {"type":"hello",...,"protocolVersion":1,"serialProtocolVersion":1,...}
size_t encode_hello(const HelloInfo& info, uint64_t device_time_us, char* out, size_t out_len);

// Formats a 32-bit value as 8 lower-case hex digits (+NUL): needs 9 bytes.
void format_boot_id(uint32_t value, char* out);

}  // namespace canscope
