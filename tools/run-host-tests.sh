#!/usr/bin/env sh
# Builds and runs the host-side (PC) unit tests for the portable firmware code.
# Requires CMake + a C++11 compiler (+ Ninja, or drop "-G Ninja").
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Generated protocol files must match protocol/canscope_protocol.json.
python "$ROOT/tools/protocol/gen_protocol.py" --check
cmake -S "$ROOT/test" -B "$ROOT/build/host-tests" -G Ninja
cmake --build "$ROOT/build/host-tests"
ctest --test-dir "$ROOT/build/host-tests" --output-on-failure
