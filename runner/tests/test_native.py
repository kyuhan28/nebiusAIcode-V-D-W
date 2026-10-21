"""C and C++ through the real runner: gcc/g++ in the sandbox, sanitizers on every run (python3 test_native.py)."""
from e2e import *


def native(files, lang, mode="run", main=None, stdin=""):
    body = {"mode": mode, "language": lang, "files": [{"path": p, "content": c} for p, c in files.items()], "stdin": stdin}
    if main: body["mainClass"] = main
    s, j = call("POST", "/v1/executions", body, client="native")
    if s != 202: return {"status": f"http {s}", "result": j}
    for _ in range(900):
        s, r = call("GET", "/v1/executions/" + j["id"])
        if "result" in r: return r
        time.sleep(0.1)
    raise RuntimeError("never finished")


out = lambda j: j["result"].get("stdout", "")
issues = lambda j: j["result"].get("memoryIssues", [])
kinds = lambda j: [i["kind"] for i in issues(j)]

section("C: compile and run")
j = native({"main.c": '#include <stdio.h>\n#include <math.h>\nint main(void) {\n    int n;\n    char name[32];\n    if (scanf("%d %31s", &n, name) != 2) return 1;\n    printf("%s %d %.2f\\n", name, n * 2, sqrt(2.0));\n    return 0;\n}\n'}, "c", stdin="21 Ada\n")
check("scanf reads the input; printf and math.h work", j["status"] == "completed" and out(j) == "Ada 42 1.41\n" and not issues(j), (j["status"], out(j), j["result"].get("stderr", "")[-300:], j["result"].get("error")))
check("  the result names the compiler", "gcc" in (j["result"].get("compiler") or ""), j["result"].get("compiler"))
j = native({"main.c": "#include <stdio.h>\nint main(void) {\n    int x = 3\n    printf(\"%d\\n\", x);\n}\n"}, "c")
d = j["result"].get("diagnostics", [])
check("a syntax error fails the build with its file and line", j["status"] == "compile_failed" and any(x["severity"] == "error" and x["file"] == "main.c" and x["line"] in (3, 4) for x in d), d[:2])
j = native({"main.c": "#include <notreal.h>\nint main(void) { return 0; }\n"}, "c")
check("a missing header is a clear compile error", j["status"] == "compile_failed" and any("notreal.h" in x["message"] for x in j["result"].get("diagnostics", [])), j["result"].get("diagnostics"))
two = {"stack/main.c": '#include <stdio.h>\n#include "stack.h"\nint main(void) {\n    struct Stack s = {0};\n    push(&s, 4); push(&s, 9);\n    printf("%d %d\\n", pop(&s), pop(&s));\n    return 0;\n}\n',
       "stack/stack.h": "#ifndef STACK_H\n#define STACK_H\nstruct Stack { int items[16]; int top; };\nvoid push(struct Stack *s, int v);\nint pop(struct Stack *s);\n#endif\n",
       "stack/stack.c": '#include "stack.h"\nvoid push(struct Stack *s, int v) { s->items[s->top++] = v; }\nint pop(struct Stack *s) { return s->items[--s->top]; }\n',
       "other/main.c": '#include <stdio.h>\nint main(void) { puts("other program"); return 0; }\n'}
j = native(two, "c", main="stack/main.c")
check("multiple .c files and a header build together; the other program's main is left out", j["status"] == "completed" and out(j) in ("9 4\n", "4 9\n") and sorted(j["result"].get("units", [])) == ["stack/main.c", "stack/stack.c"], (j["status"], out(j), j["result"].get("units"), j["result"].get("diagnostics")))
j = native(two, "c", main="other/main.c")
check("  and the other program runs on its own", out(j) == "other program\n", out(j))
j = native({"main.c": '#include <stdio.h>\nint main(void) {\n    FILE *f = fopen("notes.txt", "w");\n    fprintf(f, "saved\\n");\n    fclose(f);\n    char buf[16];\n    f = fopen("notes.txt", "r");\n    fgets(buf, sizeof buf, f);\n    fclose(f);\n    printf("%s", buf);\n    return 0;\n}\n'}, "c")
check("file I/O in the program's folder works", out(j) == "saved\n", (out(j), j["result"].get("stderr", "")[-200:]))
j = native({"main.c": "int main(void) { volatile unsigned x = 0; while (1) x++; }\n"}, "c")
check("an endless loop is stopped by the timeout", j["status"] == "timed_out", j["status"])

section("C: memory errors, found by the sanitizers")
cases = [
    ("use after free", "#include <stdlib.h>\nint main(void) {\n    int *p = malloc(sizeof *p);\n    *p = 1;\n    free(p);\n    return *p;\n}\n", "heap-use-after-free", 6),
    ("heap buffer overflow", "#include <stdlib.h>\nint main(void) {\n    int *a = malloc(4 * sizeof *a);\n    for (int i = 0; i <= 4; i++) a[i] = i;\n    free(a);\n    return 0;\n}\n", "heap-buffer-overflow", 4),
    ("double free", "#include <stdlib.h>\nint main(void) {\n    char *s = malloc(8);\n    free(s);\n    free(s);\n    return 0;\n}\n", "double-free", 5),
    ("invalid free", "#include <stdlib.h>\nint main(void) {\n    int x = 5;\n    int *p = &x;\n    free(p);\n    return 0;\n}\n", "invalid-free", 5),
    ("null pointer dereference (UBSan catches the load before the crash)", "#include <stdio.h>\nint main(void) {\n    int *p = NULL;\n    printf(\"%d\\n\", *p);\n    return 0;\n}\n", "undefined-behavior", 4),
    ("array index out of bounds (UBSan's bounds check)", "int main(void) {\n    int a[3];\n    volatile int i = 3;\n    a[i] = 7;\n    return a[0];\n}\n", "undefined-behavior", 4),
    ("stack buffer overflow through a pointer (ASan)", "#include <string.h>\nint main(void) {\n    char buf[8];\n    char *p = buf;\n    memset(p, 'x', 12);\n    return buf[0];\n}\n", "stack-buffer-overflow", 5),
    ("signed integer overflow (undefined behavior)", "#include <limits.h>\n#include <stdio.h>\nint main(void) {\n    volatile int x = INT_MAX;\n    printf(\"%d\\n\", x + 1);\n    return 0;\n}\n", "undefined-behavior", 5),
]
for name, code, kind, line in cases:
    j = native({"main.c": code}, "c")
    found = next((i for i in issues(j) if i["kind"] == kind), None)
    at = (found or {}).get("at") or found or {}
    check(f"{name}: reported as {kind} on line {line}", j["status"] == "runtime_error" and found is not None and at.get("file") == "main.c" and at.get("line") == line, (j["status"], issues(j)[:1]))
j = native({"main.c": "#include <stdlib.h>\n#include <string.h>\nint main(void) {\n    char *s = malloc(32);\n    strcpy(s, \"never freed\");\n    s = NULL;\n    return 0;\n}\n"}, "c")
leak = next((i for i in issues(j) if i["kind"] == "leak"), None)
check("a leak is reported with its size and where it was allocated, and the run still completes", j["status"] == "completed" and leak and leak.get("bytes") == 32 and leak.get("file") == "main.c" and leak.get("line") == 4, (j["status"], issues(j)))
j = native({"main.c": "#include <stdio.h>\n#include <stdlib.h>\nint main(void) {\n    printf(\"step 1\\n\");\n    int *p = malloc(4);\n    free(p);\n    printf(\"step 2\\n\");\n    return *p;\n}\n"}, "c")
check("output printed before a memory error is kept (stdout is not lost when the sanitizer stops the program)", out(j) == "step 1\nstep 2\n" and "heap-use-after-free" in kinds(j), (out(j), kinds(j)))
j = native({"main.c": "#include <stdio.h>\n#include <stdlib.h>\nint main(void) {\n    printf(\"done\\n\");\n    malloc(8);\n    return 0;\n}\n"}, "c")
check("  and so is output from a program that leaks", out(j) == "done\n" and "leak" in kinds(j), (out(j), kinds(j)))
j = native({"main.c": "#include <assert.h>\nint main(void) {\n    int n = 2;\n    assert(n == 3);\n    return 0;\n}\n"}, "c")
check("a failed assert stops the program and says why", j["status"] == "runtime_error" and "Assertion" in j["result"].get("stderr", "") and "SIGABRT" in j["result"].get("exception", {}).get("type", ""), (j["status"], j["result"].get("exception")))

section("C++")
cpp = '''#include <iostream>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include <algorithm>

struct Shape {
    virtual ~Shape() = default;
    virtual double area() const = 0;
    virtual std::string name() const { return "shape"; }
};
struct Rect : Shape {
    double w, h;
    Rect(double w, double h) : w(w), h(h) {}
    double area() const override { return w * h; }
    std::string name() const override { return "rect"; }
};
template <typename T> T biggest(const std::vector<T>& v) { return *std::max_element(v.begin(), v.end()); }

int main() {
    std::vector<std::unique_ptr<Shape>> shapes;
    shapes.push_back(std::make_unique<Rect>(2, 3));
    std::shared_ptr<int> a = std::make_shared<int>(7), b = a;
    std::map<std::string, int> counts{{"x", 1}};
    counts["y"] += 2;
    std::vector<int> v{3, 9, 4};
    std::sort(v.begin(), v.end());
    std::cout << shapes[0]->name() << " " << shapes[0]->area() << " " << a.use_count() << " " << counts["y"] << " " << biggest(v) << " " << v[0] << "\\n";
}
'''
j = native({"main.cpp": cpp}, "cpp")
check("classes, virtual dispatch, templates, unique_ptr, shared_ptr, map, vector, algorithms", j["status"] == "completed" and out(j) == "rect 6 2 2 9 3\n" and not issues(j), (j["status"], out(j), j["result"].get("diagnostics"), j["result"].get("stderr", "")[-300:]))
j = native({"main.cpp": '#include <vector>\n#include <iostream>\nint main() {\n    std::vector<int> v{1, 2};\n    std::cout << v.at(5) << "\\n";\n}\n'}, "cpp")
check("an uncaught exception is reported with its type and message", j["status"] == "runtime_error" and j["result"].get("exception", {}).get("type") == "std::out_of_range", j["result"].get("exception"))
j = native({"main.cpp": "int main() {\n    int *a = new int[4];\n    delete a;\n    return 0;\n}\n"}, "cpp")
check("new[] with delete (not delete[]) is reported as a mismatch", "alloc-dealloc-mismatch" in kinds(j), (j["status"], kinds(j)))
j = native({"main.cpp": "struct Node { int v; Node *next; };\nint main() {\n    Node *n = new Node{1, nullptr};\n    n->next = new Node{2, nullptr};\n    return 0;\n}\n"}, "cpp")
check("leaked objects from new are reported (direct and indirect)", sum(i.get("bytes", 0) for i in issues(j) if i["kind"] == "leak") == 32, issues(j))
j = native({"main.cpp": "#include <iostream>\nint main() {\n    std::cout << undefined_name;\n}\n"}, "cpp")
check("a C++ compile error has its file and line", j["status"] == "compile_failed" and any(x["line"] == 3 and x["severity"] == "error" for x in j["result"].get("diagnostics", [])), j["result"].get("diagnostics"))

section("recording C step by step (Visualize)")


def rec(files, lang="c", stdin=""):
    j = native(files, lang, mode="trace", stdin=stdin)
    t = j["result"].get("trace") or {}
    return j, t.get("steps", []), t


def at_line(steps, line, last=False):
    hits = [s for s in steps if s["line"] == line]
    return (hits[-1] if last else hits[0]) if hits else None


SWAP = """#include <stdio.h>
void swap(int *a, int *b) {
    int t = *a;
    *a = *b;
    *b = t;
}
int square(int x) {
    return x * x;
}
int main(void) {
    int x = 3, y = 8;
    swap(&x, &y);
    int s = square(x);
    printf("%d %d %d\\n", x, y, s);
    return 0;
}
"""
j, st, t = rec({"main.c": SWAP})
check("a recorded C program prints the same output", j["status"] == "completed" and j["result"].get("stdout") == "8 3 64\n", (j["status"], j["result"].get("stdout"), j["result"].get("error")))
inside = at_line(st, 4)
a, b = (inside or {}).get("stack", [{}])[0].get("locals", {}).get("a", {}), (inside or {}).get("stack", [{}])[0].get("locals", {}).get("b", {})
check("in swap, a and b point at main's x and y on the stack", a.get("state") == "stack" and a.get("var") == "x" and b.get("var") == "y" and [f["method"] for f in inside["stack"]] == ["swap", "main"], (a, b))
check("  each call is its own frame, innermost first", inside["memory"]["frames"][0]["function"] == "swap" and inside["memory"]["frames"][1]["function"] == "main")
check("square(8) returns 64, read from the register at its closing brace", [(s["method"], s.get("ret", {}).get("v")) for s in st if s["kind"] == "return" and s["method"] == "square"] == [("square", 64)])
after = at_line(st, 14)
check("after swap, x is 8 and y is 3", after["stack"][0]["locals"]["x"]["v"] == 8 and after["stack"][0]["locals"]["y"]["v"] == 3)

HEAP = """#include <stdio.h>
#include <stdlib.h>
int main(void) {
    int *a = malloc(3 * sizeof(int));
    a[0] = 5;
    int *z = calloc(2, sizeof(int));
    int *end = a + 3;
    int *mid = a + 1;
    a = realloc(a, 1000 * sizeof(int));
    a[1] = 6;
    free(z);
    printf("%d %d\\n", a[0], a[1]);
    free(a);
    return 0;
}
"""
j, st, t = rec({"main.c": HEAP})
check("the heap program prints 5 6", j["result"].get("stdout") == "5 6\n", j["result"].get("stdout"))
s6 = at_line(st, 6)
items = s6["heap"]["b1"]["items"]
check("after malloc, a[0] = 5 and the never-written a[1], a[2] are uninitialized", items[0] == {"t": "int", "v": 5} and items[1]["t"] == "uninit" and items[2]["t"] == "uninit", items)
s7 = at_line(st, 7)
check("calloc's block holds zeros", [x.get("v") for x in s7["heap"]["b2"]["items"]] == [0, 0], s7["heap"].get("b2"))
s9 = at_line(st, 9)
L = s9["stack"][0]["locals"]
check("a + 3 is past the end of the 12-byte block; a + 1 is element [1]", L["end"].get("state") == "past-end" and L["end"].get("offset") == 12 and L["mid"].get("index") == 1 and L["mid"].get("offset") == 4, (L["end"], L["mid"]))
s10 = at_line(st, 10)
ev = next((e for s in st for e in s["memory"]["events"] if e["op"] == "realloc"), None)
L = s10["stack"][0]["locals"]
if ev and ev.get("moved"):
    check("realloc moved the block: the old block is freed, and end and mid now dangle", s10["memory"]["blocks"][0]["state"] == "freed" and L["end"].get("state") == "dangling" and L["mid"].get("state") == "dangling" and L["a"].get("block") == ev["block"], (ev, L["end"]))
else:
    check("realloc resized in place: end and mid still point into the live block", ev is not None and L["mid"].get("state") == "live", ev)
s12 = at_line(st, 12)
check("after free(z), z still holds the old address: it dangles", s12["stack"][0]["locals"]["z"].get("state") == "dangling", s12["stack"][0]["locals"]["z"])
check("everything was freed: nothing leaked at exit", t.get("memorySummary", {}).get("leakedAtExit") == [], t.get("memorySummary"))

j, st, t = rec({"main.c": "#include <stdlib.h>\n#include <string.h>\nint main(void) {\n    char *s = malloc(32);\n    strcpy(s, \"kept\");\n    return 0;\n}\n"})
leak = (t.get("memorySummary") or {}).get("leakedAtExit") or []
check("a block never freed is listed as leaked at exit, with its line", leak == [{"id": 1, "size": 32, "file": "main.c", "line": 4}], leak)

j, st, t = rec({"main.c": "#include <stdio.h>\nint main(void) {\n    int *p = NULL;\n    printf(\"before\\n\");\n    *p = 3;\n    return 0;\n}\n"})
check("a crash ends the recording on its line, with the output so far", j["status"] == "runtime_error" and st[-1]["kind"] == "exception" and st[-1]["line"] == 5 and j["result"].get("stdout") == "before\n" and j["result"].get("exception", {}).get("type") == "SIGSEGV", (j["status"], st[-1]["kind"] if st else None, j["result"].get("exception")))

LIST = """#include <stdlib.h>
struct Node { int value; struct Node *next; };
void push(struct Node **head, int v) {
    struct Node *n = malloc(sizeof *n);
    n->value = v;
    n->next = *head;
    *head = n;
}
int main(void) {
    struct Node *head = NULL;
    push(&head, 1);
    push(&head, 2);
    int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
    return grid[1][2] + head->value;
}
"""
j, st, t = rec({"main.c": LIST})
inpush = at_line(st, 7, last=True)
hp = inpush["stack"][0]["locals"]["head"]
check("pointer to pointer: push's head points at main's head variable", hp.get("state") == "stack" and hp.get("var") == "head", hp)
end = at_line(st, 14)
H = end["heap"]
head = end["stack"][0]["locals"]["head"]
first = H[head["id"]]
second = H[first["fields"]["next"]["id"]]
check("the list is decoded from the heap: 2 -> 1 -> NULL", first["fields"]["value"]["v"] == 2 and second["fields"]["value"]["v"] == 1 and second["fields"]["next"]["t"] == "null", (first, second))
g = H[end["stack"][0]["locals"]["grid"]["id"]]
check("a local 2D array decodes as rows", [[x["v"] for x in H[r["id"]]["items"]] for r in g["items"]] == [[1, 2, 3], [4, 5, 6]], g)

j, st, t = rec({"main.cpp": "struct P { int x; int y; };\nint main() {\n    P *p = new P{3, 4};\n    int sum = p->x + p->y;\n    delete p;\n    return sum - 7;\n}\n"}, lang="cpp")
ops = [e["op"] for s in st for e in s["memory"]["events"]]
s4 = at_line(st, 4)
check("C++: new and delete are in the lifecycle, and the object decodes", j["status"] == "completed" and ops == ["new", "delete"] and s4["heap"][s4["stack"][0]["locals"]["p"]["id"]]["fields"]["y"]["v"] == 4, (j["status"], ops))


section("recording C++ object lifetime (Visualize)")
LIFE = """#include <memory>
#include <string>
#include <vector>
#include <iostream>

struct Res {
    int id;
    Res(int i) : id(i) { std::cout << "make " << id << "\\n"; }
    Res(const Res& o) : id(o.id + 100) {}
    Res(Res&& o) noexcept : id(o.id) { o.id = -1; }
    ~Res() { std::cout << "drop " << id << "\\n"; }
};

int main() {
    Res a(1);
    Res b = a;
    Res c = std::move(a);
    std::vector<int> v{10, 20, 30};
    v.push_back(40);
    std::string s = "hello";
    std::unique_ptr<Res> u = std::make_unique<Res>(7);
    std::shared_ptr<Res> p = std::make_shared<Res>(8);
    std::shared_ptr<Res> q = p;
    std::weak_ptr<Res> w = p;
    std::cout << v.size() << " " << s << " " << p.use_count() << "\\n";
    return 0;
}
"""
j, st, t = rec({"main.cpp": LIFE}, lang="cpp")
check("the C++ lifetime program records and prints what it prints when run", j["status"] == "completed" and j["result"].get("stdout", "").startswith("make 1\nmake 7\nmake 8\n4 hello 2\n"), (j["status"], j["result"].get("stdout"), j["result"].get("error")))
life = [(e["op"], e["kind"], e["storage"]) for s in st for e in s["memory"]["events"] if e["op"] in ("construct", "destroy", "assign")]
check("construction is classified by the constructor that ran: plain, copy, move (stack), then two on the heap", life[:5] == [("construct", "constructor", "stack"), ("construct", "copy constructor", "stack"), ("construct", "move constructor", "stack"), ("construct", "constructor", "heap"), ("construct", "constructor", "heap")], life[:5])
check("  and all five objects are destroyed (the three stack destructors back to back are three events)", [x for x in life if x[0] == "destroy"].__len__() == 5, life)
check("only the program's own functions are shown as frames (library templates are walked through)", {f["method"] for s in st for f in s["stack"]} == {"main", "Res::Res", "Res::~Res"}, {f["method"] for s in st for f in s["stack"]})
last = [s for s in st if s["method"] == "main"][-1]
L, H = last["stack"][0]["locals"], last["heap"]
v = H[L["v"]["id"]]
check("std::vector: its elements, size 4, capacity 6, and its heap buffer", [x["v"] for x in v["items"]] == [10, 20, 30, 40] and v["len"] == 4 and v["capacity"] == 6 and v.get("buffer"), v)
check("std::string: its text", L["s"] == {"t": "String", "v": "hello", "len": 5, "type": "std::string"}, L["s"])
check("unique_ptr: owns a live heap block holding a Res", L["u"]["kind"] == "unique_ptr" and L["u"]["target"]["state"] == "live" and H[L["u"]["target"]["id"]]["cls"] == "Res", L["u"])
check("shared_ptr: 2 owners and 1 weak, read from the control block", L["p"]["useCount"] == 2 and L["p"]["weakCount"] == 1 and L["q"]["useCount"] == 2, (L["p"], L["q"]))
check("weak_ptr: watching a live object (not expired)", L["w"]["kind"] == "weak_ptr" and L["w"]["expired"] is False, L["w"])
obj = H[L["p"]["target"]["id"]]
check("make_shared: the object is decoded inside the control block's allocation, at its real offset", obj.get("inplace") == 16 and obj["fields"]["id"]["v"] == 8, obj)
check("a moved-from object is shown as the move left it (a.id = -1)", H[L["a"]["id"]]["fields"]["id"]["v"] == -1)
check("a variable is not shown before its declaration first runs", "a" not in st[0]["stack"][0]["locals"], list(st[0]["stack"][0]["locals"]))

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
