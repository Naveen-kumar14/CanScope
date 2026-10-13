// Minimal dependency-free test helper for host tests.
#pragma once

#include <stdio.h>
#include <string.h>

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond)                                                       \
  do {                                                                    \
    ++g_checks;                                                           \
    if (!(cond)) {                                                        \
      ++g_failures;                                                       \
      printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);              \
    }                                                                     \
  } while (0)

#define CHECK_STR_EQ(actual, expected)                                    \
  do {                                                                    \
    ++g_checks;                                                           \
    if (strcmp((actual), (expected)) != 0) {                              \
      ++g_failures;                                                       \
      printf("FAIL %s:%d:\n  actual:   %s\n  expected: %s\n", __FILE__,   \
             __LINE__, (actual), (expected));                             \
    }                                                                     \
  } while (0)

#define TEST_MAIN_END()                                                   \
  printf("%s: %d checks, %d failures\n", __FILE__, g_checks, g_failures); \
  return g_failures == 0 ? 0 : 1
