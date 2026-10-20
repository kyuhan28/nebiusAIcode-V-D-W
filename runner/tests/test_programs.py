"""
Java and Python programs with known answers, run through the real runner (python3 test_programs.py).

Each program is run (output compared exactly) and recorded (the recording is checked against facts
known independently: one frame per call, parameters, return values, heap contents, input consumed,
the line of an exception). Recordings are saved to tests/out/visual/ for web/tests/visual-check.ts,
which checks what the visualizer shows for them. Nothing here touches a user's workspace.
"""
import json
import pathlib
from e2e import *

OUT = pathlib.Path(__file__).parent / "out" / "visual"
OUT.mkdir(parents=True, exist_ok=True)
EXAMPLES = pathlib.Path(__file__).resolve().parents[2] / "web" / "public" / "examples"


def job(files, mode, main=None, stdin="", language=None):
    body = {"mode": mode, "files": [{"path": p, "content": c} for p, c in files.items()], "stdin": stdin}
    if main: body["mainClass"] = main
    if language: body["language"] = language
    status, j = call("POST", "/v1/executions", body, client="programs")
    if status != 202: return {"status": f"http {status}", "result": j}
    for _ in range(1200):
        s, r = call("GET", "/v1/executions/" + j["id"])
        if "result" in r: return r
        time.sleep(0.1)
    raise RuntimeError("never finished")


def line_of(src, text):
    return next(i + 1 for i, l in enumerate(src.splitlines()) if text in l)


class Rec:
    """A recording with the heap carried forward, as the visualizer sees it."""
    def __init__(self, result):
        self.result, self.trace = result, result.get("trace") or {}
        self.steps = self.trace.get("steps", [])
        self.heaps, heap = [], {}
        for s in self.steps:
            if s.get("heap") is not None: heap = s["heap"]
            self.heaps.append(heap)

    def obj(self, v, k=-1):
        return self.heaps[k].get(v["id"]) if v and v.get("t") == "ref" else None

    def local(self, name, k=-1, frame=0):
        st = self.steps[k]["stack"]
        return st[frame]["locals"].get(name) if len(st) > frame else None

    def glob(self, name, k=-1):
        return next((v for q, v in self.steps[k].get("statics", {}).items() if q.endswith("." + name)), None)

    def frames(self, method):
        out = {}
        for s in self.steps:
            for f in s["stack"]:
                if f["method"] == method and f.get("id") is not None: out.setdefault(f["id"], f)
        return out

    def returns(self, method, arg):
        return [(s["stack"][0]["locals"][arg]["v"], s["ret"]["v"]) for s in self.steps if s["kind"] == "return" and s["method"] == method]

    def items(self, v, k=-1):
        o = self.obj(v, k)
        return [x.get("v") for x in o["items"]] if o and "items" in o else None


TESTS = []


def program(id, lang, files, main, stdout, stdin="", status="completed", record=True, exc=None):
    def wrap(fn):
        TESTS.append(dict(id=id, lang=lang, files=files, main=main, stdout=stdout, stdin=stdin, status=status, record=record, exc=exc, check=fn))
        return fn
    return wrap


# ============================================================== Java

J_PRIM = '''public class Primitives {
    public static void main(String[] args) {
        int count = 7;
        boolean ready = false;
        double ratio = 2.5;
        float scale = 1.25f;
        char grade = 'B';
        String name = "Ada";
        long big = 9_000_000_000L;
        count += 3;
        ready = !ready;
        ratio = ratio * 2;
        grade++;
        name = name + " Lovelace";
        System.out.println(count + " " + ready + " " + ratio + " " + scale + " " + grade + " " + name + " " + big);
    }
}
'''
@program("java-primitives", "java", {"Primitives.java": J_PRIM}, "Primitives", "10 true 5.0 1.25 C Ada Lovelace 9000000000\n")
def _(r):
    last = {n: (v["t"], v.get("v")) for n, v in r.steps[-1]["stack"][0]["locals"].items()}
    return [("each primitive holds its final value with its Java type", {k: last.get(k) for k in ["count", "ready", "ratio", "scale", "grade", "name", "big"]} == {
        "count": ("int", 10), "ready": ("boolean", True), "ratio": ("double", 5.0), "scale": ("float", 1.25), "grade": ("char", "C"), "name": ("String", "Ada Lovelace"), "big": ("long", 9000000000)}, last),
        ("count is 7 before it becomes 10", any(r.local("count", k) and r.local("count", k)["v"] == 7 for k in range(len(r.steps))))]

J_ARR = '''public class Arrays1 {
    public static void main(String[] args) {
        int[] nums = {4, 8, 15, 16, 23};
        nums[2] = 42;
        int sum = 0;
        for (int i = 0; i < nums.length; i++) {
            sum += nums[i];
        }
        int[] copy = new int[3];
        copy[0] = nums[4];
        System.out.println(sum + " " + nums[2] + " " + copy[0] + " " + copy.length);
    }
}
'''
@program("java-arrays", "java", {"Arrays1.java": J_ARR}, "Arrays1", "93 42 23 3\n")
def _(r):
    before = r.items(r.local("nums", 1), 1)
    return [("nums starts as {4, 8, 15, 16, 23}", before == [4, 8, 15, 16, 23], before),
            ("nums[2] = 42 is recorded as a change at index 2 only", r.items(r.local("nums")) == [4, 8, 42, 16, 23]),
            ("copy has length 3 with copy[0] = 23", r.items(r.local("copy")) == [23, 0, 0]),
            ("sum grows through the loop to 93", [r.local("sum", k)["v"] for k in range(len(r.steps)) if r.local("sum", k)][-1] == 93)]

J_OOB = '''public class OutOfBounds {
    public static void main(String[] args) {
        int[] a = new int[3];
        a[0] = 1;
        System.out.println("before");
        a[3] = 5;
        System.out.println("after");
    }
}
'''
@program("java-array-out-of-bounds", "java", {"OutOfBounds.java": J_OOB}, "OutOfBounds", "before\n", status="runtime_error",
         exc=("java.lang.ArrayIndexOutOfBoundsException", line_of(J_OOB, "a[3] = 5")))
def _(r):
    last = r.steps[-1]
    return [("the recording ends on the failing line with the exception", last["kind"] == "exception" and last["line"] == line_of(J_OOB, "a[3] = 5"), (last["kind"], last["line"]))]

J_GRID = '''public class Grid {
    public static void main(String[] args) {
        int[][] grid = new int[3][4];
        for (int r = 0; r < 3; r++) {
            for (int c = 0; c < 4; c++) {
                grid[r][c] = r * 4 + c;
            }
        }
        System.out.println(grid.length + "x" + grid[0].length + " last=" + grid[2][3]);
    }
}
'''
@program("java-2d-array", "java", {"Grid.java": J_GRID}, "Grid", "3x4 last=11\n")
def _(r):
    rows = [r.items({"t": "ref", "id": x["id"]}) for x in r.obj(r.local("grid"))["items"]]
    return [("new int[3][4] is 3 rows of 4: 12 cells, filled 0..11", len(rows) == 3 and all(len(x) == 4 for x in rows) and sum(rows, []) == list(range(12)), rows)]

J_COLL = '''import java.util.*;

public class Collections1 {
    public static void main(String[] args) {
        List<Integer> list = new ArrayList<>();
        list.add(5);
        list.add(7);
        list.add(9);
        list.set(1, 70);
        list.remove(Integer.valueOf(5));
        LinkedList<String> deque = new LinkedList<>();
        deque.add("b");
        deque.addFirst("a");
        deque.addLast("c");
        String last = deque.removeLast();
        Map<String, Integer> ages = new HashMap<>();
        ages.put("ann", 31);
        ages.put("bo", 22);
        ages.put("ann", 32);
        ages.remove("bo");
        Set<Integer> seen = new HashSet<>();
        seen.add(3);
        seen.add(3);
        seen.add(4);
        boolean has = seen.contains(4);
        seen.remove(3);
        System.out.println(list + " " + deque + " " + last + " " + ages + " " + seen + " " + has);
    }
}
'''
@program("java-collections", "java", {"Collections1.java": J_COLL}, "Collections1", "[70, 9] [a, b] c {ann=32} [4] true\n")
def _(r):
    m = r.obj(r.local("ages"))
    mid = next(k for k in range(len(r.steps)) if r.steps[k]["line"] == line_of(J_COLL, "list.remove("))
    return [("ArrayList: [5, 70, 9] before the removal, [70, 9] after", r.items(r.local("list", mid), mid) == [5, 70, 9] and r.items(r.local("list")) == [70, 9]),
            ("LinkedList: [a, b] after removeLast", r.items(r.local("deque")) == ["a", "b"] and r.obj(r.local("deque"))["cls"] == "java.util.LinkedList"),
            ("HashMap: only ann = 32 remains", [(k.get("v"), v.get("v")) for k, v in m["entries"]] == [("ann", 32)], m),
            ("HashSet: only 4 remains", r.items(r.local("seen")) == [4])]

J_LOOPS = '''public class Loops {
    public static void main(String[] args) {
        StringBuilder out = new StringBuilder();
        for (int i = 1; i <= 4; i++) {
            if (i == 3) continue;
            for (int j = 1; j <= 4; j++) {
                if (j > i) break;
                out.append(i * j).append(' ');
            }
        }
        int n = 10, steps = 0;
        while (n != 1) {
            n = (n % 2 == 0) ? n / 2 : 3 * n + 1;
            steps++;
        }
        System.out.println(out.toString().trim() + " | " + steps);
    }
}
'''
@program("java-loops", "java", {"Loops.java": J_LOOPS}, "Loops", "1 2 4 4 8 12 16 | 6\n")
def _(r):
    inner = line_of(J_LOOPS, "out.append(i * j)")
    pairs = [(r.local("i", k)["v"], r.local("j", k)["v"]) for k in range(len(r.steps)) if r.steps[k]["line"] == inner]
    ns = [r.local("n", k)["v"] for k in range(len(r.steps)) if r.local("n", k)]
    return [("the inner body runs exactly for (i, j) = (1,1) (2,1) (2,2) (4,1)..(4,4): continue skips 3, break stops j > i", pairs == [(1, 1), (2, 1), (2, 2), (4, 1), (4, 2), (4, 3), (4, 4)], pairs),
            ("n follows 10 5 16 8 4 2 1", list(dict.fromkeys(ns)) == [10, 5, 16, 8, 4, 2, 1], ns)]

J_REC = '''public class Recursion {
    static int factorial(int n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
    }

    static int fib(int n) {
        return n < 2 ? n : fib(n - 1) + fib(n - 2);
    }

    public static void main(String[] args) {
        System.out.println(factorial(5) + " " + fib(6));
    }
}
'''
@program("java-recursion", "java", {"Recursion.java": J_REC}, "Recursion", "120 8\n")
def _(r):
    fr = r.frames("factorial")
    deepest = max(r.steps, key=lambda s: sum(f["method"] == "factorial" for f in s["stack"]))
    return [("five factorial frames, each with its own n", sorted(f["locals"]["n"]["v"] for f in fr.values()) == [1, 2, 3, 4, 5]),
            ("returns unwind innermost first: 1, 2, 6, 24, 120", r.returns("factorial", "n") == [(1, 1), (2, 2), (3, 6), (4, 24), (5, 120)]),
            ("at the deepest point the stack is factorial(1) .. factorial(5), main", [f["locals"].get("n", {}).get("v", f["method"]) for f in deepest["stack"]] == [1, 2, 3, 4, 5, "main"]),
            ("fib(6) makes 25 calls", len(r.frames("fib")) == 25, len(r.frames("fib")))]

J_SCAN = '''import java.util.*;

public class ScannerInput {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        int n = in.nextInt();
        int total = 0;
        for (int i = 0; i < n; i++) total += in.nextInt();
        in.nextLine();
        String name = in.nextLine();
        System.out.println(name + ": " + total);
        try {
            int extra = in.nextInt();
            System.out.println("extra " + extra);
        } catch (NoSuchElementException e) {
            System.out.println("end of input: " + e.getClass().getSimpleName());
        }
    }
}
'''
@program("java-scanner", "java", {"ScannerInput.java": J_SCAN}, "ScannerInput", "Ada Lovelace: 60\nend of input: NoSuchElementException\n", stdin="3\n10 20 30\nAda Lovelace\n")
def _(r):
    io = r.trace["io"]
    return [("every Scanner call is recorded with its real result", [(e["op"], e.get("result") if e["ok"] else e["error"]["type"]) for e in io] == [
        ("nextInt", "3"), ("nextInt", "10"), ("nextInt", "20"), ("nextInt", "30"), ("nextLine", ""), ("nextLine", "Ada Lovelace"), ("nextInt", "java.util.NoSuchElementException")],
        [(e["op"], e.get("result"), e.get("error")) for e in io])]

@program("java-scanner-invalid", "java", {"ScannerInput.java": J_SCAN}, "ScannerInput", "", stdin="x\n", status="runtime_error",
         exc=("java.util.InputMismatchException", line_of(J_SCAN, "int n = in.nextInt()")), record=False)
def _(r):
    return []

J_READER = '''import java.io.*;

public class ReaderInput {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String[] parts = br.readLine().split(" ");
        int a = Integer.parseInt(parts[0]), b = Integer.parseInt(parts[1]);
        String line;
        int lines = 0;
        while ((line = br.readLine()) != null) lines++;
        System.out.println((a + b) + " " + lines);
        try {
            Integer.parseInt("12x");
        } catch (NumberFormatException e) {
            System.out.println("bad number");
        }
    }
}
'''
@program("java-bufferedreader", "java", {"ReaderInput.java": J_READER}, "ReaderInput", "9 2\nbad number\n", stdin="4 5\nx\ny\n")
def _(r):
    reads = [(e["op"], e.get("result")) for e in r.trace["io"] if e["op"] == "readLine"]
    parses = [(e.get("args"), e["ok"]) for e in r.trace["io"] if e["op"] == "parseInt"]
    return [("readLine returns each line, then null at the end", reads == [("readLine", "4 5"), ("readLine", "x"), ("readLine", "y"), ("readLine", None)], reads),
            ("parseInt is recorded, including the failing one", parses == [(["4"], True), (["5"], True), (["12x"], False)], parses)]

J_ZOO = '''public class Zoo {
    static class Animal {
        protected final String name;
        Animal(String name) { this.name = name; }
        String sound() { return "..."; }
        String speak() { return name + " says " + sound(); }
    }

    static class Dog extends Animal {
        Dog(String name) { super(name); }
        @Override String sound() { return "Woof"; }
    }

    static class Puppy extends Dog {
        Puppy(String name) { super(name + " Jr."); }
        @Override String speak() { return super.speak() + "!"; }
    }

    public static void main(String[] args) {
        Animal[] pets = { new Animal("Generic"), new Dog("Rex"), new Puppy("Rex") };
        for (Animal a : pets) System.out.println(a.speak());
    }
}
'''
@program("java-inheritance", "java", {"Zoo.java": J_ZOO}, "Zoo", "Generic says ...\nRex says Woof\nRex Jr. says Woof!\n")
def _(r):
    seen = set()
    for k, s in enumerate(r.steps):
        f = s["stack"][0] if s["stack"] else None
        if f and f["locals"].get("this"):
            seen.add((f["cls"].split("$")[-1], f["method"], r.obj(f["locals"]["this"], k)["cls"].split("$")[-1]))
    H = {c["simpleName"]: c for c in r.result.get("hierarchy", [])}
    return [("Animal.speak runs on a Dog (inherited); Dog.sound on a Dog (override)", {("Animal", "speak", "Dog"), ("Dog", "sound", "Dog")} <= seen, seen),
            ("Puppy.speak runs, and its super.speak() is Animal.speak on the Puppy", {("Puppy", "speak", "Puppy"), ("Animal", "speak", "Puppy")} <= seen),
            ("constructors chain Puppy -> Dog -> Animal on the same object", {("Puppy", "<init>", "Puppy"), ("Dog", "<init>", "Puppy"), ("Animal", "<init>", "Puppy")} <= seen),
            ("the class model: Puppy extends Dog extends Animal", H["Puppy"]["superclass"] == "Zoo$Dog" and H["Dog"]["superclass"] == "Zoo$Animal")]

J_ERR = '''public class Errors {
    static class InsufficientFunds extends Exception {
        InsufficientFunds(String msg) { super(msg); }
    }

    static int withdraw(int balance, int amount) throws InsufficientFunds {
        if (amount > balance) throw new InsufficientFunds("need " + (amount - balance) + " more");
        return balance - amount;
    }

    public static void main(String[] args) {
        int balance = 100;
        try {
            balance = withdraw(balance, 30);
            balance = withdraw(balance, 100);
        } catch (InsufficientFunds e) {
            System.out.println("caught: " + e.getMessage());
        } finally {
            System.out.println("balance " + balance);
        }
        Object o = null;
        System.out.println(o.toString());
    }
}
'''
@program("java-exceptions", "java", {"Errors.java": J_ERR}, "Errors", "caught: need 30 more\nbalance 70\n", status="runtime_error",
         exc=("java.lang.NullPointerException", line_of(J_ERR, "o.toString()")))
def _(r):
    catch = line_of(J_ERR, 'System.out.println("caught: "')
    return [("the caught exception's handler runs with balance 70", any(s["line"] == catch and r.local("balance", k)["v"] == 70 for k, s in enumerate(r.steps))),
            ("the uncaught NullPointerException ends the recording on its line", r.steps[-1]["kind"] == "exception" and r.steps[-1]["line"] == line_of(J_ERR, "o.toString()"))]

J_GRAPH = '''import java.util.*;

public class Graphs {
    public static void main(String[] args) {
        int n = 6;
        List<List<Integer>> graph = new ArrayList<>();
        for (int i = 0; i < n; i++) graph.add(new ArrayList<>());
        int[][] edges = {{0, 1}, {0, 2}, {1, 3}, {2, 4}, {3, 5}, {4, 5}};
        for (int[] e : edges) {
            graph.get(e[0]).add(e[1]);
            graph.get(e[1]).add(e[0]);
        }
        List<Integer> bfs = new ArrayList<>();
        boolean[] seen = new boolean[n];
        Deque<Integer> queue = new ArrayDeque<>();
        queue.add(0);
        seen[0] = true;
        while (!queue.isEmpty()) {
            int u = queue.poll();
            bfs.add(u);
            for (int v : graph.get(u)) if (!seen[v]) { seen[v] = true; queue.add(v); }
        }
        List<Integer> dfs = new ArrayList<>();
        dfs(graph, 0, new boolean[n], dfs);
        System.out.println("BFS " + bfs + " DFS " + dfs);
    }

    static void dfs(List<List<Integer>> g, int u, boolean[] seen, List<Integer> out) {
        seen[u] = true;
        out.add(u);
        for (int v : g.get(u)) if (!seen[v]) dfs(g, v, seen, out);
    }
}
'''
@program("java-bfs-dfs", "java", {"Graphs.java": J_GRAPH}, "Graphs", "BFS [0, 1, 2, 3, 4, 5] DFS [0, 1, 3, 5, 4, 2]\n")
def _(r):
    polls = [r.local("u", k)["v"] for k, s in enumerate(r.steps) if s["line"] == line_of(J_GRAPH, "bfs.add(u)") and s["method"] == "main"]
    visits = [f["locals"]["u"]["v"] for f in r.frames("dfs").values()]
    return [("BFS takes nodes off the queue in order 0..5", polls == [0, 1, 2, 3, 4, 5], polls),
            ("DFS enters one frame per node, in order 0 1 3 5 4 2", visits == [0, 1, 3, 5, 4, 2], visits)]

J_DIJ = '''import java.util.*;

public class Dijkstra {
    public static void main(String[] args) {
        int n = 5;
        int[][] edges = {{0, 1, 4}, {0, 2, 1}, {2, 1, 2}, {1, 3, 1}, {2, 3, 5}, {3, 4, 3}};
        List<List<int[]>> adj = new ArrayList<>();
        for (int i = 0; i < n; i++) adj.add(new ArrayList<>());
        for (int[] e : edges) adj.get(e[0]).add(new int[] {e[1], e[2]});
        int[] dist = new int[n];
        Arrays.fill(dist, Integer.MAX_VALUE);
        dist[0] = 0;
        PriorityQueue<int[]> pq = new PriorityQueue<>((a, b) -> a[1] - b[1]);
        pq.add(new int[] {0, 0});
        while (!pq.isEmpty()) {
            int[] cur = pq.poll();
            int u = cur[0];
            if (cur[1] > dist[u]) continue;
            for (int[] e : adj.get(u)) {
                if (dist[u] + e[1] < dist[e[0]]) {
                    dist[e[0]] = dist[u] + e[1];
                    pq.add(new int[] {e[0], dist[e[0]]});
                }
            }
        }
        System.out.println(Arrays.toString(dist));
    }
}
'''
@program("java-dijkstra", "java", {"Dijkstra.java": J_DIJ}, "Dijkstra", "[0, 3, 1, 4, 7]\n")
def _(r):
    seq = []
    for k in range(len(r.steps)):
        d = r.items(r.local("dist", k), k)
        if d and (not seq or seq[-1] != d): seq.append(d)
    big = 2147483647
    return [("dist relaxes 4 -> 3 for node 1 and ends [0, 3, 1, 4, 7]", seq[-1] == [0, 3, 1, 4, 7] and [0, 4, 1, big, big] in seq and [0, 3, 1, big, big] in seq, seq)]

J_SPIRAL = '''public class Spiral {
    public static void main(String[] args) {
        int[][] m = {{1, 2, 3}, {4, 5, 6}, {7, 8, 9}};
        StringBuilder sb = new StringBuilder();
        int top = 0, bottom = 2, left = 0, right = 2;
        while (top <= bottom && left <= right) {
            for (int c = left; c <= right; c++) sb.append(m[top][c]).append(' ');
            top++;
            for (int r = top; r <= bottom; r++) sb.append(m[r][right]).append(' ');
            right--;
            if (top <= bottom) {
                for (int c = right; c >= left; c--) sb.append(m[bottom][c]).append(' ');
                bottom--;
            }
            if (left <= right) {
                for (int r = bottom; r >= top; r--) sb.append(m[r][left]).append(' ');
                left++;
            }
        }
        System.out.println(sb.toString().trim());
    }
}
'''
@program("java-matrix-traversal", "java", {"Spiral.java": J_SPIRAL}, "Spiral", "1 2 3 6 9 8 7 4 5\n")
def _(r):
    return [("the matrix is recorded as 3 rows of 3", [r.items({"t": "ref", "id": x["id"]}) for x in r.obj(r.local("m"))["items"]] == [[1, 2, 3], [4, 5, 6], [7, 8, 9]])]

PASCAL = {f"examples/pascaltriangle/{p.name}": p.read_text() for p in (EXAMPLES / "pascaltriangle").glob("*.java")}
for cls, out in [("PascalTriangle", None), ("PascalTriangleMemoized", "41 calls, 12 answered from the cache"), ("PascalTriangleNaive", "105 calls without a cache")]:
    rows = "[1]\n[1, 1]\n[1, 2, 1]\n[1, 3, 3, 1]\n[1, 4, 6, 4, 1]\n[1, 5, 10, 10, 5, 1]\n"
    program(f"java-dp-{cls}", "java", PASCAL, f"examples.pascaltriangle.{cls}", rows + (out + "\n" if out else ""), stdin="6\n")(lambda r: [])

J_MULTI = {
    "app/Main.java": "package app;\n\nimport app.model.Point;\nimport app.util.Geometry;\n\npublic class Main {\n    public static void main(String[] args) {\n        Point a = new Point(0, 0);\n        Point b = new Point(3, 4);\n        System.out.println(\"distance \" + Geometry.distance(a, b));\n    }\n}\n",
    "app/Other.java": "package app;\n\npublic class Other {\n    public static void main(String[] args) {\n        System.out.println(\"the other entry point\");\n    }\n}\n",
    "app/model/Point.java": "package app.model;\n\npublic class Point {\n    public final int x, y;\n    public Point(int x, int y) { this.x = x; this.y = y; }\n}\n",
    "app/util/Geometry.java": "package app.util;\n\nimport app.model.Point;\n\npublic class Geometry {\n    public static double distance(Point a, Point b) {\n        int dx = b.x - a.x, dy = b.y - a.y;\n        return Math.sqrt(dx * dx + dy * dy);\n    }\n}\n",
}
@program("java-multi-file", "java", J_MULTI, "app.Main", "distance 5.0\n")
def _(r):
    files = {s["sourcePath"] for s in r.steps}
    return [("the recording moves through all three files", {"app/Main.java", "app/model/Point.java", "app/util/Geometry.java"} <= files, files),
            ("distance() returns 5.0", r.returns("distance", "dx") == [(3, 5.0)], r.returns("distance", "dx"))]
program("java-multi-file-other-entry", "java", J_MULTI, "app.Other", "the other entry point\n", record=False)(lambda r: [])

# ============================================================== Python

P_PRIM = '''count = 7
ready = False
ratio = 2.5
name = "Ada"
nothing = None
count += 3
ready = not ready
ratio *= 2
name = name + " Lovelace"
count = str(count)
print(count, ready, ratio, name, nothing, type(count).__name__)
'''
@program("python-primitives", "python", {"prim.py": P_PRIM}, "prim.py", "10 True 5.0 Ada Lovelace None str\n")
def _(r):
    end = {n: (r.glob(n)["t"], r.glob(n).get("v")) for n in ["count", "ready", "ratio", "name", "nothing"]}
    was_int = any((r.glob("count", k) or {}).get("t") == "int" and r.glob("count", k)["v"] == 10 for k in range(len(r.steps)))
    return [("globals end with their values and runtime types", end == {"count": ("str", "10"), "ready": ("bool", True), "ratio": ("float", 5.0), "name": ("str", "Ada Lovelace"), "nothing": ("null", None)}, end),
            ("count was the int 10 before becoming the str '10'", was_int)]

P_COLL = '''nums = [3, 1, 2]
nums.append(5)
nums.remove(1)
nums[0] = 30
point = (2, 3)
ages = {"ann": 31}
ages["bo"] = 22
ages["ann"] += 1
del ages["bo"]
tags = {"x", "y"}
tags.add("z")
tags.discard("x")
nested = {"grid": [[1, 2], [3, 4]], "meta": {"rows": 2}}
nested["grid"][1][0] = 30
print(nums, point, ages, sorted(tags), nested)
'''
@program("python-collections", "python", {"coll.py": P_COLL}, "coll.py", "[30, 2, 5] (2, 3) {'ann': 32} ['y', 'z'] {'grid': [[1, 2], [30, 4]], 'meta': {'rows': 2}}\n")
def _(r):
    nested = r.obj(r.glob("nested"))
    grid = r.obj(dict(nested["entries"][0][1]))
    return [("list, tuple, dict, and set hold their final contents", r.items(r.glob("nums")) == [30, 2, 5] and r.obj(r.glob("point"))["cls"] == "tuple" and r.items(r.glob("point")) == [2, 3]
             and [(k["v"], v["v"]) for k, v in r.obj(r.glob("ages"))["entries"]] == [("ann", 32)] and sorted(r.items(r.glob("tags"))) == ["y", "z"]),
            ("the nested grid is recorded as lists of lists with the change", [r.items(x) for x in grid["items"]] == [[1, 2], [30, 4]])]

P_MATRIX = '''import numpy as np
grid = [[0] * 4 for _ in range(3)]
for r in range(3):
    for c in range(4):
        grid[r][c] = r * 4 + c
arr = np.arange(12).reshape(3, 4)
total = int(arr.sum())
same = all(grid[r][c] == arr[r, c] for r in range(3) for c in range(4))
print(len(grid), len(grid[0]), total, same)
'''
@program("python-matrix-numpy", "python", {"mat.py": P_MATRIX}, "mat.py", "3 4 66 True\n")
def _(r):
    g = [r.items(x) for x in r.obj(r.glob("grid"))["items"]]
    a = [r.items(x) for x in r.obj(r.glob("arr"))["items"]]
    return [("grid is 3 rows of 4 (12 cells) filled 0..11", g == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]], g),
            ("the numpy array is recorded with the same 3x4 values", a == g, a)]

P_LOOPS = '''out = []
for i in range(1, 5):
    if i == 3:
        continue
    for j in range(1, 5):
        if j > i:
            break
        out.append(i * j)
n, steps = 10, 0
while n != 1:
    n = n // 2 if n % 2 == 0 else 3 * n + 1
    steps += 1
squares = [k * k for k in range(6) if k % 2 == 0]
pairs = {k: v for k, v in zip("abc", range(3))}
print(out, steps, squares, pairs)
'''
@program("python-loops", "python", {"loops.py": P_LOOPS}, "loops.py", "[1, 2, 4, 4, 8, 12, 16] 6 [0, 4, 16] {'a': 0, 'b': 1, 'c': 2}\n")
def _(r):
    inner = line_of(P_LOOPS, "out.append(i * j)")
    pairs = [(r.glob("i", k)["v"], r.glob("j", k)["v"]) for k, s in enumerate(r.steps) if s["line"] == inner]
    return [("the inner body runs exactly for (1,1) (2,1) (2,2) (4,1)..(4,4)", pairs == [(1, 1), (2, 1), (2, 2), (4, 1), (4, 2), (4, 3), (4, 4)], pairs)]

P_FUNC = '''calls = 0


def factorial(n):
    global calls
    calls += 1
    if n <= 1:
        return 1
    return n * factorial(n - 1)


def scale(values, factor=2):
    result = [v * factor for v in values]
    return result


print(factorial(5), calls, scale([1, 2, 3]), scale([1], factor=10))
'''
@program("python-functions-recursion", "python", {"func.py": P_FUNC}, "func.py", "120 5 [2, 4, 6] [10]\n")
def _(r):
    scale_frames = r.frames("scale")
    return [("five factorial frames, each with its own n; returns 1, 2, 6, 24, 120", sorted(f["locals"]["n"]["v"] for f in r.frames("factorial").values()) == [1, 2, 3, 4, 5]
             and r.returns("factorial", "n") == [(1, 1), (2, 2), (3, 6), (4, 24), (5, 120)]),
            ("the global calls counts 0..5 and is not a local of factorial", sorted({r.glob("calls", k)["v"] for k in range(len(r.steps)) if r.glob("calls", k)}) == [0, 1, 2, 3, 4, 5]
             and all("calls" not in f["locals"] for f in r.frames("factorial").values())),
            ("scale has its own locals and default factor=2, then factor=10", sorted(f["locals"]["factor"]["v"] for f in scale_frames.values()) == [2, 10])]

P_INPUT = '''n = int(input())
values = list(map(int, input().split()))
name = input("Name? ")
print(f"{name}: {sum(values[:n])}")
try:
    extra = input()
except EOFError:
    print("end of input")
try:
    int("12x")
except ValueError as e:
    print("bad number:", e)
'''
@program("python-input", "python", {"inp.py": P_INPUT}, "inp.py", "Name? Ada: 60\nend of input\nbad number: invalid literal for int() with base 10: '12x'\n", stdin="3\n10 20 30\nAda\n")
def _(r):
    io = [(e["op"], e.get("result") if e["ok"] else e["error"]["type"], e["line"]) for e in r.trace["io"]]
    return [("each input() call is recorded with the line it read, then EOFError", io == [("input", "3", 1), ("input", "10 20 30", 2), ("input", "Ada", 3), ("input", "EOFError", 6)], io)]

@program("python-input-eof-uncaught", "python", {"inp.py": "a = input()\nb = input()\n"}, "inp.py", "", stdin="only one line\n", status="runtime_error", exc=("EOFError", 2), record=False)
def _(r):
    return []

P_ZOO = '''class Animal:
    def __init__(self, name):
        self.name = name

    def sound(self):
        return "..."

    def speak(self):
        return f"{self.name} says {self.sound()}"


class Dog(Animal):
    def sound(self):
        return "Woof"


class Puppy(Dog):
    def __init__(self, name):
        super().__init__(name + " Jr.")

    def speak(self):
        return super().speak() + "!"


for a in [Animal("Generic"), Dog("Rex"), Puppy("Rex")]:
    print(a.speak())
'''
@program("python-inheritance", "python", {"zoo.py": P_ZOO}, "zoo.py", "Generic says ...\nRex says Woof\nRex Jr. says Woof!\n")
def _(r):
    seen = set()
    for k, s in enumerate(r.steps):
        f = s["stack"][0] if s["stack"] else None
        if f and f["locals"].get("self"):
            seen.add((f["cls"].split(".")[-1], f["method"], r.obj(f["locals"]["self"], k)["cls"].split(".")[-1]))
    H = {c["simpleName"]: c for c in r.result.get("hierarchy", [])}
    return [("Animal.speak on a Dog (inherited), Dog.sound on a Dog (override)", {("Animal", "speak", "Dog"), ("Dog", "sound", "Dog")} <= seen, seen),
            ("Puppy.speak, then super().speak() as Animal.speak on the Puppy", {("Puppy", "speak", "Puppy"), ("Animal", "speak", "Puppy")} <= seen),
            ("Puppy.__init__ chains to Animal.__init__ on the same object", {("Puppy", "<init>", "Puppy"), ("Animal", "<init>", "Puppy")} <= seen),
            ("the class model: Puppy extends Dog extends Animal", H["Puppy"]["superclass"] == "__main__.Dog" and H["Dog"]["superclass"] == "__main__.Animal")]

P_ERR = '''import collections
import json
import math
from dataclasses import dataclass


class InsufficientFunds(Exception):
    pass


def withdraw(balance, amount):
    if amount > balance:
        raise InsufficientFunds(f"need {amount - balance} more")
    return balance - amount


@dataclass
class Account:
    owner: str
    balance: int


acct = Account("ann", 100)
try:
    acct.balance = withdraw(acct.balance, 30)
    acct.balance = withdraw(acct.balance, 100)
except InsufficientFunds as e:
    print("caught:", e)
finally:
    print("balance", acct.balance)
counts = collections.Counter("banana")
print(math.isqrt(17), json.dumps({"a": [1, 2]}), counts.most_common(1))
print(undefined_name)
'''
@program("python-exceptions-stdlib", "python", {"err.py": P_ERR}, "err.py", 'caught: need 30 more\nbalance 70\n4 {"a": [1, 2]} [(\'a\', 3)]\n', status="runtime_error", exc=("NameError", line_of(P_ERR, "undefined_name")))
def _(r):
    acct = r.obj(r.glob("acct"))
    return [("the dataclass object's balance is recorded as 70", acct["cls"] == "__main__.Account" and acct["fields"]["balance"]["v"] == 70 and acct["fields"]["owner"]["v"] == "ann", acct),
            ("the uncaught NameError ends the recording on its line", r.steps[-1]["kind"] == "exception" and r.steps[-1]["line"] == line_of(P_ERR, "undefined_name"))]

P_GRAPHS = '''import heapq
from collections import deque

graph = [[1, 2], [0, 3], [0, 4], [1, 5], [2, 5], [3, 4]]
seen = [False] * 6
order = []
queue = deque([0])
seen[0] = True
while queue:
    u = queue.popleft()
    order.append(u)
    for v in graph[u]:
        if not seen[v]:
            seen[v] = True
            queue.append(v)

visited = []


def dfs(u):
    visited.append(u)
    for v in graph[u]:
        if v not in visited:
            dfs(v)


dfs(0)
weights = {0: [(1, 4), (2, 1)], 1: [(3, 1)], 2: [(1, 2), (3, 5)], 3: [(4, 3)], 4: []}
dist = [float("inf")] * 5
dist[0] = 0
pq = [(0, 0)]
while pq:
    d, u = heapq.heappop(pq)
    if d > dist[u]:
        continue
    for v, w in weights[u]:
        if d + w < dist[v]:
            dist[v] = d + w
            heapq.heappush(pq, (dist[v], v))
m = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]
spiral = []
while m:
    spiral += m.pop(0)
    m = [list(row) for row in zip(*m)][::-1]
print(order, visited, dist, spiral)
'''
@program("python-algorithms", "python", {"graphs.py": P_GRAPHS}, "graphs.py", "[0, 1, 2, 3, 4, 5] [0, 1, 3, 5, 4, 2] [0, 3, 1, 4, 7] [1, 2, 3, 6, 9, 8, 7, 4, 5]\n")
def _(r):
    visits = [f["locals"]["u"]["v"] for f in r.frames("dfs").values()]
    return [("DFS enters one frame per node, in order 0 1 3 5 4 2", visits == [0, 1, 3, 5, 4, 2], visits)]

PYP = {f"examples/py_pascal/{p.name}": p.read_text() for p in (EXAMPLES / "py_pascal").glob("*.py")}
for f, extra in [("pascal_triangle.py", ""), ("pascal_memo.py", "41 calls, 12 answered from the cache\n"), ("pascal_naive.py", "105 calls without a cache\n")]:
    program(f"python-dp-{f[:-3]}", "python", PYP, f"examples/py_pascal/{f}", "[1]\n[1, 1]\n[1, 2, 1]\n[1, 3, 3, 1]\n[1, 4, 6, 4, 1]\n[1, 5, 10, 10, 5, 1]\n" + extra, stdin="6\n")(lambda r: [])

P_MULTI = {
    "main.py": "from helpers import shout\nfrom geometry.report import describe\n\nprint(shout('hi'), describe(3, 4))\n",
    "helpers.py": "def shout(s):\n    return s.upper() + '!'\n",
    "geometry/__init__.py": "",
    "geometry/shapes.py": "def area(w, h):\n    return w * h\n",
    "geometry/report.py": "from .shapes import area\n\n\ndef describe(w, h):\n    return f'{w}x{h}={area(w, h)}'\n",
}
@program("python-multi-file", "python", P_MULTI, "main.py", "HI! 3x4=12\n")
def _(r):
    files = {s["sourcePath"] for s in r.steps}
    return [("the recording moves through all four files", {"main.py", "helpers.py", "geometry/report.py", "geometry/shapes.py"} <= files, files)]

P_PANDAS = "import pandas as pd\ndf = pd.DataFrame({'team': ['a', 'b', 'a'], 'pts': [3, 5, 4]})\ntotals = df.groupby('team')['pts'].sum()\nprint(totals.to_dict())\n"
@program("python-pandas", "python", {"pd.py": P_PANDAS}, "pd.py", "{'a': 7, 'b': 5}\n")
def _(r):
    df = r.obj(r.glob("df"))
    return [("the DataFrame is recorded as its columns and values (the library's internals are not)", df["cls"] == "pandas.DataFrame" and [k["v"] for k, _ in df["entries"]] == ["team", "pts"])]

# ============================================================== run them

for t in TESTS:
    section(f"{t['lang']}: {t['id']}")
    lang = "python" if t["lang"] == "python" else None
    run = job(t["files"], "run", t["main"], t["stdin"], lang)
    res = run.get("result", {})
    check("runs with the expected status and output", run["status"] == t["status"] and res.get("stdout", "") == t["stdout"], (run["status"], res.get("stdout"), (res.get("stderr") or "")[-300:], res.get("error")))
    if t["exc"]:
        ex = res.get("exception") or {}
        check(f"  the exception is {t['exc'][0].split('.')[-1]} on line {t['exc'][1]}", ex.get("type") == t["exc"][0] and ex.get("line") == t["exc"][1], ex)
    if not t["record"]:
        continue
    rec = job(t["files"], "trace", t["main"], t["stdin"], lang)
    rres = rec.get("result", {})
    tr = rres.get("trace") or {}
    check("  recorded with the same status and output", rec["status"] == t["status"] and rres.get("stdout", "") == t["stdout"] and not tr.get("truncated"), (rec["status"], rres.get("stdout"), tr.get("stopReason")))
    json.dump({"id": t["id"], "lang": t["lang"], "files": t["files"], "main": t["main"], "stdin": t["stdin"], "result": rres}, open(OUT / f"{t['id']}.json", "w"))
    try:
        for name, cond, *detail in t["check"](Rec(rres)):
            check("  " + name, cond, detail[0] if detail else "")
    except Exception as e:
        check("  recording checks ran", False, f"{type(e).__name__}: {e}")

print(f"\n{len(passed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
