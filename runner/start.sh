#!/bin/sh
# Starts the runner. Rebuilds first whenever any source file is newer than the last build,
# so updated code never runs as a stale copy. Settings come from environment variables (see README).
set -e
cd "$(dirname "$0")"
if [ ! -f build/.stamp ] || [ -n "$(find src bin -newer build/.stamp -type f 2>/dev/null | head -1)" ]; then
  echo "[runner] sources changed since the last build; rebuilding"
  ./build.sh
fi
exec java -Xmx512m -cp build/classes codeviz.runner.Server
