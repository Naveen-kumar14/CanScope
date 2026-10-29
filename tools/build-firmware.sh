#!/usr/bin/env sh
# Builds every firmware target, including the unmodified legacy sketches.
# Requires PlatformIO Core (`pio`) on PATH. On Windows, if your user profile
# path contains spaces or is long, set a short core dir first, e.g.
#   export PLATFORMIO_CORE_DIR=C:/canscope-pio
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for target in "node1 node1" "node1 legacy_sketch" "node2 node2" "node2 legacy_sketch" "node3 node3" "monitor monitor"; do
  set -- $target
  echo "=== firmware/$1 env:$2"
  pio run -d "$ROOT/firmware/$1" -e "$2"
done
