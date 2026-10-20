#!/bin/sh
# Starts the runner. Rebuilds first whenever the source code differs from what was last built.
# The check compares file contents, not timestamps: unzipping an update restores the zip's own
# file dates, which can look older than the last build, so a date check could keep running a
# stale copy. Settings come from environment variables (see README).
set -e
cd "$(dirname "$0")"
sum=$(find src bin -type f 2>/dev/null | LC_ALL=C sort | xargs cat 2>/dev/null | cksum | cut -d' ' -f1)
if [ ! -f build/.stamp ] || [ "$(cat build/.stamp 2>/dev/null)" != "$sum" ]; then
  echo "[runner] source code changed since the last build; rebuilding"
  ./build.sh
fi
echo "[runner] running build $sum"
exec java -Xmx512m -cp build/classes codeviz.runner.Server
