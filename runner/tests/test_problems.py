"""Test mode: reference solutions pass every case; wrong ones fail for the right reasons."""
from e2e import *
import pathlib
TESTS = json.load(open(pathlib.Path(__file__).parent / "fixtures" / "problem_tests.json"))
SOL = pathlib.Path(__file__).parent / "solutions"

def norm(s):
    """The comparison rule: CRLF to LF, trailing spaces on each line and trailing blank lines ignored."""
    lines = [l.rstrip() for l in s.replace("\r\n", "\n").split("\n")]
    while lines and lines[-1] == "": lines.pop()
    return "\n".join(lines)

def evaluate(pid, code):
    cases = TESTS[pid]
    body = {"mode": "test", "files": [{"path": "Main.java", "content": code}], "tests": [{"id": c["id"], "stdin": c["input"]} for c in cases]}
    status, job = call("POST", "/v1/executions", body, client="problems")
    assert status == 202, (status, job)
    while True:
        s, j = call("GET", "/v1/executions/" + job["id"])
        if "result" in j: break
        time.sleep(0.15)
    r = j["result"]
    if r["status"] != "completed": return r, None
    verdicts = {}
    for c, t in zip(cases, r["tests"]):
        verdicts[c["id"]] = "passed" if t["status"] == "ok" and norm(t["stdout"]) == norm(c["expected"]) else ("wrong_answer" if t["status"] == "ok" else t["status"])
    return r, verdicts

section("reference solutions pass every test")
for pid in TESTS:
    t0 = time.time()
    r, v = evaluate(pid, (SOL / pid / "Main.java").read_text())
    check(f"{pid}: {len(TESTS[pid])} tests in {time.time() - t0:.1f}s", v is not None and all(x == "passed" for x in v.values()), (r.get("status"), v))

section("wrong solutions fail for the right reasons")
sum_code = (SOL / "sum-of-array" / "Main.java").read_text()
r, v = evaluate("sum-of-array", sum_code.replace("long sum = 0;", "int sum = 0;").replace("sum += scanner.nextInt();", "sum += scanner.nextInt() * 1;").replace("System.out.println(sum);", "System.out.println(sum + 1);"))
check("an off-by-one answer fails every test as wrong_answer", v and all(x == "wrong_answer" for x in v.values()), v)
max_code = (SOL / "max-element" / "Main.java").read_text().replace("int max = in.nextInt();\n        for (int i = 1;", "int max = 0;\n        for (int i = 0;")
r, v = evaluate("max-element", max_code)
check("starting max at 0 passes positive samples but fails the all-negative hidden test", v["max-element-1"] == "passed" and v["max-element-3"] == "wrong_answer", v)
r, v = evaluate("sum-of-array", "public class Main { public static void main(String[] a) { int x = ; } }\n")
check("a compile error stops evaluation with diagnostics", r["status"] == "compile_failed" and r["diagnostics"], r.get("status"))
r, v = evaluate("sum-of-array", "public class Main { public static void main(String[] a) { while (true) {} } }\n")
check("an infinite loop is reported per test as timed_out", v and all(x == "timed_out" for x in v.values()), v)
r, v = evaluate("sum-of-array", "public class Main { public static void main(String[] a) { int[] x = new int[1]; x[2] = 0; } }\n")
check("a crash is reported per test as runtime_error", v and all(x == "runtime_error" for x in v.values()), v)
r, v = evaluate("sum-of-array", sum_code.replace("System.out.println(sum);", 'System.out.print(sum + "   \\r\\n\\n");'))
check("trailing spaces, CRLF, and blank lines are ignored", v and all(x == "passed" for x in v.values()), v)
s, j = call("POST", "/v1/executions", {"mode": "test", "files": [{"path": "Main.java", "content": "class A{}"}], "tests": []})
check("test mode without tests is rejected", s == 400 and j["error"]["code"] == "bad_tests", (s, j))
print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
