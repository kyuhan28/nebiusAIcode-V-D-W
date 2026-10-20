from e2e import *

def steps_of(j):
    return j["result"]["trace"]["steps"]

def heap_at(steps, k):
    """Heaps are omitted when unchanged; walk back to the latest one."""
    for i in range(k, -1, -1):
        if steps[i]["heap"] is not None: return steps[i]["heap"]
    return {}

def local(step, name, frame=0):
    return step["stack"][frame]["locals"].get(name)

section("bubble sort")
bubble = {"Sort.java": '''public class Sort {
  public static void main(String[] args) {
    int[] arr = {5, 1, 4, 2, 8};
    for (int i = 0; i < arr.length - 1; i++) {
      for (int j = 0; j < arr.length - 1 - i; j++) {
        if (arr[j] > arr[j + 1]) {
          int tmp = arr[j];
          arr[j] = arr[j + 1];
          arr[j + 1] = tmp;
        }
      }
    }
    System.out.println(java.util.Arrays.toString(arr));
  }
}
'''}
t0 = time.time(); s, j = execute(bubble, mode="trace")
r = j["result"]; st = steps_of(j)
print(f"   {len(st)} steps recorded in {time.time()-t0:.1f}s, trace {len(json.dumps(r['trace']))//1024} KB")
check("trace completes", j["status"] == "completed", (j["status"], r.get("error")))
check("first step is the first line of main", st[0]["line"] == 3 and st[0]["method"] == "main", st[0])
arr_id = None
for k, step in enumerate(st):
    v = local(step, "arr")
    if v and v["t"] == "ref": arr_id = v["id"]; break
check("array local is a heap reference", arr_id is not None)
first = [x["v"] for x in heap_at(st, k)[arr_id]["items"]]
last = [x["v"] for x in heap_at(st, len(st) - 1)[arr_id]["items"]]
check("array starts unsorted", first == [5, 1, 4, 2, 8], first)
check("array ends sorted", last == [1, 2, 4, 5, 8], last)
check("object identity is stable across steps", all(local(x, "arr") is None or local(x, "arr")["id"] == arr_id for x in st))
lines = [x["line"] for x in st]
check("swap lines 7, 8, 9 are all visited", all(n in lines for n in (7, 8, 9)), sorted(set(lines)))
check("JDK internals are skipped (only Sort's lines)", all(x["cls"] == "Sort" for x in st), {x["cls"] for x in st})
check("stdout matches and output offsets are monotonic", r["stdout"].strip() == "[1, 2, 4, 5, 8]" and all(st[i]["out"] <= st[i+1]["out"] for i in range(len(st)-1)), r["stdout"])
check("unchanged heaps are omitted to keep traces small", sum(1 for x in st if x["heap"] is None) > 0)

section("linked list, recursion, and user objects")
linked = {"List.java": '''public class List {
  static class Node {
    int value; Node next;
    Node(int value) { this.value = value; }
  }
  static int sum(Node n) {
    if (n == null) return 0;
    return n.value + sum(n.next);
  }
  public static void main(String[] args) {
    Node head = new Node(3);
    head.next = new Node(7);
    head.next.next = new Node(9);
    System.out.println(sum(head));
  }
}
'''}
s, j = execute(linked, mode="trace")
st = steps_of(j)
check("trace completes", j["status"] == "completed", j["status"])
deepest = max(len(x["stack"]) for x in st)
check("recursion shows a deepening call stack", deepest >= 4, deepest)
frames = max(st, key=lambda x: len(x["stack"]))["stack"]
check("each frame has its own locals", [f["method"] for f in frames][-1] == "main" and all("n" in f["locals"] for f in frames[:-1]), [f["method"] for f in frames])
h = heap_at(st, len(st) - 1)
nodes = [o for o in h.values() if o["t"] == "object" and o["cls"] == "List$Node"]
check("user objects captured with fields", sorted(o["fields"]["value"]["v"] for o in nodes) == [3, 7, 9], nodes)
check("next pointers are references between nodes", sum(1 for o in nodes if o["fields"]["next"]["t"] == "ref") == 2)

section("java collections")
coll = {"C.java": '''import java.util.*;
public class C {
  public static void main(String[] args) {
    List<Integer> list = new ArrayList<>(List.of(4, 2));
    list.add(9);
    Map<String, Integer> map = new HashMap<>();
    map.put("a", 1); map.put("b", 2);
    Deque<Integer> stack = new ArrayDeque<>();
    stack.push(1); stack.push(2);
    TreeMap<Integer, String> tree = new TreeMap<>(Map.of(3, "c", 1, "a", 2, "b"));
    System.out.println(list.size() + map.size() + stack.size() + tree.size());
  }
}
'''}
s, j = execute(coll, mode="trace")
st = steps_of(j); h = heap_at(st, len(st) - 1); last = st[-1]
def obj(name): return h[local(last, name)["id"]]
check("ArrayList read as a list", obj("list")["t"] == "list" and [x["v"] for x in obj("list")["items"]] == [4, 2, 9], obj("list"))
check("HashMap read as entries", obj("map")["t"] == "map" and sorted((e[0]["v"], e[1]["v"]) for e in obj("map")["entries"]) == [("a", 1), ("b", 2)], obj("map"))
check("ArrayDeque read in order", [x["v"] for x in obj("stack")["items"]] == [2, 1], obj("stack"))
check("TreeMap read in sorted order", [e[0]["v"] for e in obj("tree")["entries"]] == [1, 2, 3], obj("tree"))

section("call frames, returns, scopes, and declared types")
frames_src = {"Calls.java": """import java.util.*;
public class Calls {
  static int total = 100;
  static Map<String, List<Integer>> index = new HashMap<>();
  static int factorial(int n) {
    if (n <= 1) {
      return 1;
    }
    return n * factorial(n - 1);
  }
  static int add(int value) {
    total += value;
    return total;
  }
  static int twice(int x) {
    int y = x * 2;
    return y;
  }
  static int boom(int n) {
    if (n == 0) throw new IllegalStateException("bottom");
    return boom(n - 1);
  }
  public static void main(String[] args) {
    int x = 7;
    int r = factorial(4);
    add(5);
    add(10);
    int t = twice(x);
    try { boom(2); } catch (IllegalStateException e) { x = -1; }
    int again = twice(3);
    System.out.println(r + " " + total + " " + t + " " + again);
  }
}
"""}
s, j = execute(frames_src, mode="trace")
r = j["result"]; t = r["trace"]; st = t["steps"]
check("trace completes and reports version 2", j["status"] == "completed" and t["version"] == 2, (j["status"], t.get("version")))
fact = [x for x in st if x["stack"][0]["method"] == "factorial"]
ids = {}
for x in fact:
    f = x["stack"][0]; ids.setdefault(f["id"], set()).add(f["locals"]["n"]["v"])
check("each recursive call has its own frame id holding its own n", sorted(sorted(v) for v in ids.values()) == [[1], [2], [3], [4]], ids)
deep = max(fact, key=lambda x: x["stackDepth"])
check("frames carry call depth, innermost first", [f["depth"] for f in deep["stack"]] == [4, 3, 2, 1, 0] and deep["stackDepth"] == 5, [f["depth"] for f in deep["stack"]])
rets = [(x["stack"][0]["locals"]["n"]["v"], x["ret"]["v"]) for x in st if x["kind"] == "return" and x["method"] == "factorial"]
check("unwinding is recorded: each frame returns its real value, innermost first", rets == [(1, 1), (2, 2), (3, 6), (4, 24)], rets)
first = next(x["stack"][0] for x in st if x["method"] == "factorial")
check("parameter names are sent with a frame's first step", first.get("args") == ["n"], first.get("args"))
adds = [x["ret"]["v"] for x in st if x["kind"] == "return" and x["method"] == "add"]
totals = [x["statics"]["Calls.total"]["v"] for x in st if "Calls.total" in x.get("statics", {})]
check("static field changes are recorded as they happen", adds == [105, 115] and 100 in totals and totals[-1] == 115 and totals.index(105) < totals.index(115), (adds, sorted(set(totals))))
check("declared static types keep their generic arguments", t["classes"]["Calls"]["statics"] == {"total": "int", "index": "java.util.Map<java.lang.String, java.util.List<java.lang.Integer>>"}, t["classes"].get("Calls"))
types = {}
for x in st:
    for f in x["stack"]:
        if f["method"] == "main" and "types" in f: types.update(f["types"])
check("local declared types are recorded", types.get("args") == "java.lang.String[]" and types.get("x") == "int" and types.get("r") == "int", types)
tw = [x for x in st if x["stack"][0]["method"] == "twice"]
check("two calls of one method get different frames", len({x["stack"][0]["id"] for x in tw}) == 2, {x["stack"][0]["id"] for x in tw})
main_x = {x["stack"][-1]["locals"]["x"]["v"] for x in tw}
check("a callee's x never replaces the caller's x", main_x <= {7, -1} and all(x["stack"][0]["locals"]["x"]["v"] in (7, 3) for x in tw), main_x)
boom_ids = {x["stack"][0]["id"] for x in st if x["stack"][0]["method"] == "boom"}
check("frames unwound by an exception are not reused", not (boom_ids & {x["stack"][0]["id"] for x in tw}) and len(boom_ids) == 3, boom_ids)
void = [x for x in st if x["kind"] == "return" and x["method"] == "main"]
check("void returns are marked void", len(void) == 1 and void[0]["ret"] == {"t": "void"}, void[-1:] and void[-1].get("ret"))
check("program output is unchanged", r["stdout"].strip() == "24 115 14 6", r["stdout"])

section("exceptions and limits while tracing")
s, j = execute({"Boom.java": 'public class Boom {\n  public static void main(String[] a) {\n    int[] x = new int[2];\n    for (int i = 0; i <= 2; i++) x[i] = i;\n  }\n}\n'}, mode="trace")
ex = j["result"].get("exception") or {}
check("uncaught exception recorded with its line", j["status"] == "runtime_error" and ex.get("type") == "java.lang.ArrayIndexOutOfBoundsException" and ex.get("line") == 4, ex)
check("last step marks the exception", steps_of(j)[-1]["kind"] == "exception", steps_of(j)[-1]["kind"])
s, j = execute({"Loop.java": 'public class Loop {\n  public static void main(String[] a) {\n    long n = 0;\n    while (true) {\n      n++;\n    }\n  }\n}\n'}, mode="trace")
t = j["result"]["trace"]
check("runaway loop stops at the step limit", t["truncated"] and t["stopReason"] == "max_steps" and t["stepCount"] == 2000, (t["stopReason"], t["stepCount"]))
s, j = execute({"Tight.java": 'public class Tight {\n  public static void main(String[] a) {\n    long n = 0;\n    while (true) n++;\n  }\n}\n'}, mode="trace")
check("a one-line infinite loop is recorded and stopped by the step limit", j["result"]["trace"]["stopReason"] == "max_steps", j["result"].get("trace", {}).get("stopReason"))
s, j = execute({"Nap.java": 'public class Nap {\n  public static void main(String[] a) throws Exception {\n    Thread.sleep(Long.MAX_VALUE);\n  }\n}\n'}, mode="trace")
check("a program that blocks is stopped by the time limit", j["status"] == "timed_out" and j["result"]["trace"]["stopReason"] == "timeout", (j["status"], j["result"].get("trace", {}).get("stopReason")))
time.sleep(1)
check("no traced JVM survives the step limit", os.popen("ps -eo args | grep '[L]oop' | grep -v grep").read().strip() == "")

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
