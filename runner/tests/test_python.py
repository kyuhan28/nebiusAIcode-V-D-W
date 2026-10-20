"""End-to-end tests for Python programs, against a running runner (python3 test_python.py)."""
from e2e import *


def py(files, mode="run", stdin="", main=None):
    body = {"mode": mode, "language": "python", "files": [{"path": p, "content": c} for p, c in files.items()], "stdin": stdin}
    if main: body["mainClass"] = main
    status, job = call("POST", "/v1/executions", body, client="tests")
    if status != 202: return status, job
    for _ in range(600):
        s, j = call("GET", "/v1/executions/" + job["id"])
        if "result" in j: return s, j
        time.sleep(0.1)
    raise RuntimeError("execution never finished")


def out(j): return (j["result"].get("stdout") or "")


section("running Python programs")
s, j = py({"main.py": "print('Hello, world')\nx = 6 * 7\nprint(x, type(x).__name__)\n"}, main="main.py")
check("print and arithmetic", j["status"] == "completed" and out(j) == "Hello, world\n42 int\n" and j["result"].get("language") == "python", out(j))
check("the result reports the real interpreter version", (j["result"].get("pythonVersion") or "").startswith("3."), j["result"].get("pythonVersion"))
code = '''def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)

squares = [k * k for k in range(5)]
ages = {"ann": 31, "bo": 22}
total = 0
for k in squares:
    if k % 2 == 0:
        total += k
while total > 10:
    total -= 3
print(fib(10), squares, sorted(ages.items()), total, squares[1:3], "abc"[::-1])
'''
s, j = py({"main.py": code}, main="main.py")
check("functions, recursion, loops, comprehensions, dicts, slicing", out(j) == "55 [0, 1, 4, 9, 16] [('ann', 31), ('bo', 22)] 8 [1, 4] cba\n", out(j))
oop = '''class Animal:
    def __init__(self, name):
        self.name = name
    def speak(self):
        return f"{self.name} says {self.sound()}"
    def sound(self):
        return "..."

class Dog(Animal):
    def sound(self):
        return "Woof"

class Puppy(Dog):
    def __init__(self, name):
        super().__init__(name + " Jr.")
        self.tiny = True

for a in [Animal("Generic"), Dog("Rex"), Puppy("Rex")]:
    print(a.speak())
'''
s, j = py({"zoo.py": oop}, main="zoo.py")
check("classes, inheritance, super(), polymorphism", out(j) == "Generic says ...\nRex says Woof\nRex Jr. says Woof\n", out(j))
H = {c["simpleName"]: c for c in j["result"].get("hierarchy", [])}
check("the run reports the real class model", H.get("Puppy", {}).get("superclass") == "__main__.Dog" and any(m["name"] == "sound" and m["overrides"] == "__main__.Animal#sound" for m in H.get("Dog", {}).get("methods", [])), list(H))

section("standard input")
greet = 'name = input("What is your name? ")\nage = int(input("How old are you? "))\nprint(f"Hello, {name}!")\nprint(f"Next year, you will be {age + 1}.")\n'
s, j = py({"greet.py": greet}, main="greet.py", stdin="Kyu\n19\n")
check("input() with prompts, int(), in order", out(j) == "What is your name? How old are you? Hello, Kyu!\nNext year, you will be 20.\n", out(j))
s, j = py({"sum.py": "a, b = map(int, input().split())\nnums = [float(x) for x in input().split()]\nprint(a + b, sum(nums))\n"}, main="sum.py", stdin="3 4\n1.5 2.5\n")
check("split() and map() over several lines", out(j) == "7 4.0\n", out(j))
s, j = py({"greet.py": greet}, main="greet.py", stdin="Kyu\n")
check("running out of input raises EOFError, reported with its line", j["status"] == "runtime_error" and j["result"]["exception"]["type"] == "EOFError" and j["result"]["exception"]["line"] == 2, j["result"].get("exception"))
s, j = py({"greet.py": greet}, main="greet.py", stdin="Kyu\nnineteen\n")
check("invalid numeric input is a ValueError with a traceback", j["status"] == "runtime_error" and j["result"]["exception"]["type"] == "ValueError" and "invalid literal for int()" in j["result"]["stderr"], j["result"].get("stderr"))
s, j = py({"lines.py": "import sys\nprint(len(sys.stdin.read().splitlines()))\n"}, main="lines.py", stdin="")
check("empty input is just empty", out(j) == "0\n", out(j))

section("errors and limits")
s, j = py({"bad.py": "def f(:\n    pass\n", "ok.py": "print(1)\n"}, mode="compile")
d = j["result"].get("diagnostics", [])
check("a syntax error fails the check with file and line", j["status"] == "compile_failed" and d and d[0]["file"] == "bad.py" and d[0]["line"] == 1 and "SyntaxError" in d[0]["message"], d)
s, j = py({"ok.py": "print(1)\n"}, mode="compile")
check("a clean project passes the check", j["status"] == "completed", j["status"])
s, j = py({"boom.py": "def f(x):\n    return 10 // x\nprint('before')\nprint(f(0))\n"}, main="boom.py")
tb = j["result"]["stderr"]
check("a runtime exception keeps the output so far and gives a clean traceback", j["status"] == "runtime_error" and out(j) == "before\n" and 'File "boom.py", line 2, in f' in tb and "ZeroDivisionError" in tb and "pyrun" not in tb, tb)
check("  and the result names the type and line", j["result"]["exception"] == {"type": "ZeroDivisionError", "message": "integer division or modulo by zero", "sourcePath": "boom.py", "line": 2, "method": "f"}, j["result"].get("exception"))
s, j = py({"forever.py": "while True:\n    pass\n"}, main="forever.py")
check("an endless loop is stopped by the timeout", j["status"] == "timed_out", j["status"])
s, j = py({"loud.py": "for i in range(10**6):\n    print('x' * 100)\n"}, main="loud.py")
check("excessive output is cut off at the limit", j["result"].get("stdoutTruncated") is True and len(out(j)) <= 300_000, (j["status"], len(out(j))))
s, j = py({"imp.py": "import notamodule\n"}, main="imp.py")
check("a missing module is a ModuleNotFoundError", j["result"].get("exception", {}).get("type") == "ModuleNotFoundError", j["result"].get("exception"))
s, j = py({"sysexit.py": "import sys\nprint('bye')\nsys.exit(3)\n"}, main="sysexit.py")
check("sys.exit(3) is exit code 3", j["result"]["exitCode"] == 3 and out(j) == "bye\n", j["result"].get("exitCode"))

section("multi-file projects")
s, j = py({"app/main.py": "from helpers import shout\nprint(shout('hi'))\n", "app/helpers.py": "def shout(s):\n    return s.upper() + '!'\n"}, main="app/main.py")
check("a sibling module imports from the entry's folder", out(j) == "HI!\n", out(j) or j["result"].get("stderr"))
pkg = {"geo/__init__.py": "", "geo/shapes.py": "def area(w, h):\n    return w * h\n", "geo/main.py": "from . import shapes\nfrom .shapes import area\nprint(shapes.area(2, 3), area(4, 5))\n", "run.py": "from geo.shapes import area\nprint(area(7, 8))\n"}
s, j = py(pkg, main="geo/main.py")
check("a file inside a package runs as part of it: relative imports work", out(j) == "6 20\n", out(j) or j["result"].get("stderr"))
s, j = py(pkg, main="run.py")
check("a package imports from the project root", out(j) == "56\n", out(j))
s, j = py({"a.py": "print('a')\n", "b.py": "print('b')\n"}, main="b.py")
check("the chosen entry file is the one that runs", out(j) == "b\n", out(j))
s, j = py({"a.py": "print('a')\n", "b.py": "print('b')\n"})
check("with several files and none chosen, it asks which", j["result"].get("errorCode") == "choose_main", j["result"].get("errorCode"))
s, j = py({"Main.java": "public class Main { public static void main(String[] a) { System.out.println(\"java\"); } }\n", "main.py": "print('python')\n"}, main="main.py")
check("a Python run in a mixed project runs Python, not javac", out(j) == "python\n", out(j))

section("recording Python for the visualizer")
rec = '''total = 100

def add(value):
    global total
    total += value
    return total

def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

add(5)
add(10)
items = [10, 20, 30]
items.append(40)
print(factorial(4), total)
'''
s, j = py({"rec.py": rec}, mode="trace", main="rec.py")
t = j["result"]["trace"]; st = t["steps"]
check("trace completes in the shared format", j["status"] == "completed" and t["version"] == 2 and t["language"] == "python" and t["sourceMap"] == {"rec.py": "rec.py"}, (j["status"], t.get("language")))
check("module globals change as they happen: 100, 105, 115", sorted({x["statics"]["__main__.total"]["v"] for x in st if "__main__.total" in x["statics"]}) == [100, 105, 115])
ids = {}
for x in st:
    if x["stack"] and x["stack"][0]["method"] == "factorial": ids.setdefault(x["stack"][0]["id"], set()).add(x["stack"][0]["locals"]["n"]["v"])
check("each recursive call is its own frame with its own n", sorted(sorted(v) for v in ids.values()) == [[1], [2], [3], [4]], ids)
check("returns are recorded innermost first with real values", [(x["stack"][0]["locals"]["n"]["v"], x["ret"]["v"]) for x in st if x["kind"] == "return" and x["method"] == "factorial"] == [(1, 1), (2, 2), (3, 6), (4, 24)])
heap = {}
for x in st:
    if x["heap"] is not None: heap = x["heap"]
check("a list is recorded with its real items, after append", [v["v"] for v in heap[st[-1]["statics"]["__main__.items"]["id"]]["items"]] == [10, 20, 30, 40])
check("types are the runtime types", any(x["stack"] and x["stack"][0].get("types") == {"value": "int"} for x in st))
s, j = py({"zoo.py": oop}, mode="trace", main="zoo.py")
st = j["result"]["trace"]["steps"]; heap = {}; seen = set()
for x in st:
    if x["heap"] is not None: heap = x["heap"]
    top = x["stack"][0] if x["stack"] else None
    if top and "self" in top["locals"]: seen.add((top["cls"], top["method"], heap.get(top["locals"]["self"]["id"], {}).get("cls")))
check("an inherited method runs in the parent's frame on the child's object", ("__main__.Animal", "speak", "__main__.Dog") in seen)
check("super().__init__ is the parent's constructor on the same object", ("__main__.Animal", "<init>", "__main__.Puppy") in seen and ("__main__.Puppy", "<init>", "__main__.Puppy") in seen)
check("the trace carries the class model too", any(c["simpleName"] == "Puppy" for c in j["result"].get("hierarchy", [])))
s, j = py({"forever.py": "i = 0\nwhile True:\n    i += 1\n"}, mode="trace", main="forever.py")
t = j["result"]["trace"]
check("an endless loop stops at the step limit", t["truncated"] and t["stopReason"] == "steps" and t["stepCount"] == 2000, (t["stepCount"], t["stopReason"]))
s, j = py({"greet.py": greet}, mode="trace", main="greet.py", stdin="Kyu\n19\n")
io = j["result"]["trace"]["io"]
check("input() calls are recorded with their prompt, value, and line", [(e["op"], e["result"], e["line"]) for e in io] == [("input", "Kyu", 1), ("input", "19", 2)] and out(j).endswith("Next year, you will be 20.\n"), io)
s, j = py({"boom.py": "def f(x):\n    return 10 // x\nprint(f(0))\n"}, mode="trace", main="boom.py")
last = j["result"]["trace"]["steps"][-1]
check("an uncaught exception ends the trace on the line that raised it", j["status"] == "runtime_error" and last["kind"] == "exception" and last["line"] == 2 and last["method"] == "f")

section("sandbox boundaries")
s, j = py({"net.py": "import socket\ntry:\n    socket.create_connection(('1.1.1.1', 80), timeout=3)\n    print('connected')\nexcept OSError as e:\n    print('blocked')\n"}, main="net.py")
check("no network access", out(j) == "blocked\n", out(j))
s, j = py({"env.py": "import os\nprint(sorted(k for k in os.environ if 'TOKEN' in k or 'KEY' in k or 'NVIDIA' in k))\n"}, main="env.py")
check("no runner secrets or API keys in the environment", out(j) == "[]\n", out(j))
s, j = py({"mem.py": "x = bytearray(2 * 1024 * 1024 * 1024)\nprint('allocated')\n"}, main="mem.py")
check("a 2 GB allocation is refused by the memory limit", j["status"] == "runtime_error" and j["result"].get("exception", {}).get("type") == "MemoryError", (j["status"], j["result"].get("exception")))

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
