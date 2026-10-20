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
j = native({"main.cpp": "int main() { return 0; }\n"}, "cpp", mode="trace")
check("Visualize for C++ says plainly that recording is not available yet", j["result"].get("errorCode") == "unsupported" and "not available yet" in (j["result"].get("error") or ""), j["result"].get("error"))

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
