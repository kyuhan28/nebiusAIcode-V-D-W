#!/bin/sh
# Builds the runner with the JDK's own compiler. No build tool or dependencies needed.
# Records a checksum of the sources in build/.stamp, which start.sh compares to decide on a rebuild.
set -e
cd "$(dirname "$0")"
if command -v javac >/dev/null 2>&1; then
  JAVAC="javac"
else
  JAVAC="java -m jdk.compiler/com.sun.tools.javac.Main"
fi
rm -rf build/classes
mkdir -p build/classes
$JAVAC -Xlint:all,-serial -d build/classes $(find src -name '*.java')
find src bin -type f 2>/dev/null | LC_ALL=C sort | xargs cat 2>/dev/null | cksum | cut -d' ' -f1 > build/.stamp
echo "Runner built into runner/build/classes"
