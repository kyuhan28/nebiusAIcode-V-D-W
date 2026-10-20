from e2e import *

section("runtime")
s, rt = call("GET", "/v1/runtime")
check("runtime endpoint reports Java 21", s == 200 and rt["javaVersion"].startswith("21"), rt)
check("compiler is available", rt.get("compilerAvailable") is True, rt)
check("sandbox isolates network and limits resources", rt["sandbox"]["level"] == "full" and rt["sandbox"]["traceNetworkIsolated"], rt["sandbox"])
s, _ = call("GET", "/v1/runtime", token="wrong")
check("wrong token is rejected with 401", s == 401, s)

section("run")
hello = {"Hello.java": 'public class Hello {\n  public static void main(String[] args) {\n    System.out.println("hello, " + (20 + 22));\n    System.err.println("to stderr");\n  }\n}\n'}
s, j = execute(hello)
r = j["result"]
check("basic program completes", j["status"] == "completed", j)
check("stdout captured", r["stdout"] == "hello, 42\n", r.get("stdout"))
check("stderr captured separately", r["stderr"] == "to stderr\n", r.get("stderr"))
check("exit code 0 and duration reported", r["exitCode"] == 0 and r["durationMs"] > 0, r)
check("entry point detected automatically", r["entryPoint"] == "Hello", r.get("entryPoint"))

section("compile errors")
bad = {"Main.java": 'public class Main {\n  public static void main(String[] args) {\n    int x = "text";\n    System.out.println(y)\n  }\n}\n'}
s, j = execute(bad)
d = j["result"]["diagnostics"]
check("compile failure status", j["status"] == "compile_failed", j["status"])
check("missing semicolon reported with file, line, and column", any(x["line"] == 4 and x["file"] == "Main.java" and x["column"] == 26 and "';' expected" in x["message"] for x in d), d)
typed = {"Main.java": 'public class Main {\n  public static void main(String[] args) {\n    int x = "text";\n  }\n}\n'}
s, j = execute(typed)
check("type error reported on line 3", any(x["line"] == 3 and "incompatible types" in x["message"] for x in j["result"]["diagnostics"]), j["result"].get("diagnostics"))
wrong = {"Foo.java": 'public class Bar { public static void main(String[] a) {} }\n'}
s, j = execute(wrong)
check("public class / filename mismatch explained by javac", j["status"] == "compile_failed" and any("should be declared in a file named Bar.java" in x["message"] for x in j["result"]["diagnostics"]), j["result"].get("diagnostics"))

section("runtime exceptions")
boom = {"Main.java": 'public class Main {\n  public static void main(String[] args) {\n    int[] a = new int[3];\n    a[5] = 1;\n  }\n}\n'}
s, j = execute(boom)
ex = j["result"].get("exception") or {}
check("runtime error status", j["status"] == "runtime_error", j["status"])
check("exception type, message, and line", ex.get("type") == "java.lang.ArrayIndexOutOfBoundsException" and ex.get("line") == 4 and "Index 5" in (ex.get("message") or ""), ex)
check("non-zero exit code", j["result"]["exitCode"] == 1, j["result"].get("exitCode"))

section("multiple files and packages")
multi = {
  "src/com/demo/App.java": 'package com.demo;\nimport com.demo.util.MathUtil;\npublic class App {\n  public static void main(String[] args) { System.out.println(MathUtil.square(7)); }\n}\n',
  "src/com/demo/util/MathUtil.java": 'package com.demo.util;\npublic class MathUtil { public static int square(int x) { return x * x; } }\n',
}
s, j = execute(multi)
check("multi-file package project runs", j["status"] == "completed" and j["result"]["stdout"].strip() == "49", j)
check("packaged entry point detected", j["result"]["entryPoint"] == "com.demo.App", j["result"].get("entryPoint"))

two = {"A.java": 'public class A { public static void main(String[] a) { System.out.println("A"); } }\n',
       "B.java": 'public class B { public static void main(String[] a) { System.out.println("B"); } }\n'}
s, j = execute(two)
check("two mains without a choice asks the user to choose", j["status"] == "failed" and j["result"]["errorCode"] == "choose_main" and len(j["result"]["entryPoints"]) == 2, j["result"])
s, j = execute(two, main="B")
check("selected entry point is respected", j["result"]["stdout"].strip() == "B", j["result"].get("stdout"))

section("stdin")
echo = {"Echo.java": 'import java.util.Scanner;\npublic class Echo {\n  public static void main(String[] args) {\n    Scanner in = new Scanner(System.in);\n    int a = in.nextInt(), b = in.nextInt();\n    System.out.println(a + b);\n    System.out.println(in.hasNextLine() ? "more" : "eof");\n  }\n}\n'}
s, j = execute(echo, stdin="19 23\n")
check("stdin is delivered", j["result"]["stdout"].split("\n")[0] == "42", j["result"])
s, j = execute(echo, stdin="")
check("missing input ends with an exception, not a hang", j["status"] == "runtime_error" and "NoSuchElementException" in j["result"]["exception"]["type"], j["status"])

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
