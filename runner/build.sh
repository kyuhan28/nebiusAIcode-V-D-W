#!/bin/sh
# Builds the runner with the JDK's own compiler. No build tool or dependencies needed.
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
touch build/.stamp
echo "Runner built into runner/build/classes"
