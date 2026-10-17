// USB-serial command link tests: line assembly limits, strict command parsing,
// and the exact ack/hello JSON contract parsed by the dashboard.
#include <string.h>

#include "mini_test.h"
#include "serial_link.h"

using namespace canscope;

static char g_last_line[kMaxCommandLine + 1];

// Feeds a string; the last completed line is copied out when it completes
// (the assembler only guarantees line() until the next feed).
static LineAssembler::Result feed_all(LineAssembler& la, const char* s, int* lines, int* overflows) {
  LineAssembler::Result last = LineAssembler::Result::None;
  for (; *s; ++s) {
    last = la.feed(*s);
    if (last == LineAssembler::Result::Line) {
      strcpy(g_last_line, la.line());
      if (lines) ++*lines;
    }
    if (last == LineAssembler::Result::Overflow && overflows) ++*overflows;
  }
  return last;
}

static void test_line_assembler() {
  LineAssembler la;
  int lines = 0;
  int overflows = 0;
  CHECK(feed_all(la, "hello\r\n", &lines, &overflows) == LineAssembler::Result::None);  // LF after CR is ignored
  CHECK(lines == 1);
  CHECK_STR_EQ(g_last_line, "hello");

  // Partial input: nothing until the terminator arrives.
  lines = 0;
  CHECK(feed_all(la, "set rp", &lines, nullptr) == LineAssembler::Result::None);
  CHECK(lines == 0);
  CHECK(feed_all(la, "m 1500\n", &lines, nullptr) == LineAssembler::Result::Line);
  CHECK_STR_EQ(g_last_line, "set rpm 1500");

  // Blank lines produce nothing.
  lines = 0;
  feed_all(la, "\n\r\n\n", &lines, nullptr);
  CHECK(lines == 0);

  // Exactly the maximum length is accepted; one more is dropped whole.
  char longest[kMaxCommandLine + 2];
  memset(longest, 'a', kMaxCommandLine);
  longest[kMaxCommandLine] = '\n';
  longest[kMaxCommandLine + 1] = '\0';
  lines = 0;
  feed_all(la, longest, &lines, &overflows);
  CHECK(lines == 1);
  CHECK(strlen(g_last_line) == kMaxCommandLine);

  char too_long[kMaxCommandLine + 40];
  memset(too_long, 'b', sizeof(too_long) - 2);
  too_long[sizeof(too_long) - 2] = '\n';
  too_long[sizeof(too_long) - 1] = '\0';
  lines = 0;
  overflows = 0;
  feed_all(la, too_long, &lines, &overflows);
  CHECK(lines == 0);
  CHECK(overflows == 1);
  // The next line after an overflow is clean.
  feed_all(la, "status\n", &lines, &overflows);
  CHECK(lines == 1);
  CHECK_STR_EQ(g_last_line, "status");
}

static void test_parse() {
  Command c;
  CHECK(parse_command("@c12 set rpm 1500", c) == CommandParse::Ok);
  CHECK_STR_EQ(c.id, "c12");
  CHECK_STR_EQ(c.verb, "set");
  CHECK(c.argc == 2);
  CHECK_STR_EQ(c.args[0], "rpm");
  CHECK_STR_EQ(c.args[1], "1500");

  CHECK(parse_command("  status  ", c) == CommandParse::Ok);
  CHECK_STR_EQ(c.id, "");
  CHECK_STR_EQ(c.verb, "status");
  CHECK(c.argc == 0);

  CHECK(parse_command("set\ttemp\t65.0", c) == CommandParse::Ok);
  CHECK(c.argc == 2);

  CHECK(parse_command("", c) == CommandParse::Empty);
  CHECK(parse_command("   ", c) == CommandParse::Empty);
  CHECK(parse_command("@abc", c) == CommandParse::Empty);
  CHECK(parse_command("@ set rpm 1", c) == CommandParse::BadId);
  CHECK(parse_command("@a$b set", c) == CommandParse::BadId);
  CHECK(parse_command("@12345678901234567 status", c) == CommandParse::BadId);  // 17 chars
  CHECK(parse_command("@1234567890123456 status", c) == CommandParse::Ok);      // 16 chars
  CHECK(parse_command("a b c d e", c) == CommandParse::Ok);                    // 4 args
  CHECK(parse_command("a b c d e f", c) == CommandParse::TooManyArgs);
  CHECK(parse_command("set aaaaaaaaaaaaaaaaaaaaaaaa 1", c) == CommandParse::TokenTooLong);  // 24 chars
  CHECK(parse_command("set rpm \x01", c) == CommandParse::BadCharacter);
  CHECK(parse_command("set rpm \xC3\xA9", c) == CommandParse::BadCharacter);

  char id[kMaxCommandId + 1];
  extract_command_id("@x9 a b c d e f", id, sizeof(id));
  CHECK_STR_EQ(id, "x9");
  extract_command_id("@bad$id set", id, sizeof(id));
  CHECK_STR_EQ(id, "");
  extract_command_id("set rpm", id, sizeof(id));
  CHECK_STR_EQ(id, "");

  parse_command("@q fault bad_dlc", c);
  char text[64];
  command_text(c, text, sizeof(text));
  CHECK_STR_EQ(text, "fault bad_dlc");
}

static void test_json() {
  char buf[512];
  const size_t n = encode_ack("node1", 42, "0a1b2c3d", "c12", "set rpm 1500", AckStatus::Ok, "rpm=1500", buf,
                              sizeof(buf));
  CHECK(n > 0);
  CHECK_STR_EQ(buf,
               "{\"type\":\"ack\",\"sourceNode\":\"node1\",\"deviceTimeUs\":42,\"bootId\":\"0a1b2c3d\","
               "\"id\":\"c12\",\"command\":\"set rpm 1500\",\"status\":\"ok\",\"detail\":\"rpm=1500\"}");
  encode_ack("node2", 1, "", "", "frobnicate", AckStatus::Unsupported, "say \"help\"", buf, sizeof(buf));
  CHECK(strstr(buf, "\"status\":\"unsupported\"") != nullptr);
  CHECK(strstr(buf, "say \\\"help\\\"") != nullptr);  // escaped
  CHECK(encode_ack("node1", 0, "", "", "x", AckStatus::Rejected, "", buf, 20) == 0);  // too small

  HelloInfo h = {"node1", 1, "motor_ecu", "1.0.0", "deadbeef", "hello status"};
  encode_hello(h, 7, buf, sizeof(buf));
  CHECK_STR_EQ(buf,
               "{\"type\":\"hello\",\"sourceNode\":\"node1\",\"deviceTimeUs\":7,\"nodeId\":1,\"role\":\"motor_ecu\","
               "\"firmware\":\"1.0.0\",\"bootId\":\"deadbeef\",\"protocolVersion\":1,\"serialProtocolVersion\":1,"
               "\"commands\":\"hello status\"}");

  char boot[9];
  format_boot_id(0x0A1B2C3D, boot);
  CHECK_STR_EQ(boot, "0a1b2c3d");
}

int main() {
  test_line_assembler();
  test_parse();
  test_json();
  TEST_MAIN_END();
}
