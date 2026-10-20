/**
 * Checks what the visualizer shows for the recordings made by runner/tests/test_programs.py.
 *
 *   cd runner/tests && python3 test_programs.py      # needs a running runner; saves recordings
 *   cd ../../web && npx tsx tests/visual-check.ts     # checks the visualizer against them
 *
 * Every expectation comes from the program's known behavior, not from the visualizer itself.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { interpret, type VizStep } from "../lib/trace/interpret";
import { normalizeTrace, type FrameView, type ScopeView, type VarView } from "../lib/trace/scope";
import type { StructureView } from "../lib/trace/structures";
import { buildDp, dpStateAt, cellId } from "../lib/trace/dp";
import { buildHierarchy, dispatchAt, type ClassModel } from "../lib/trace/inheritance";
import { replayInput } from "../lib/trace/input";

const DIR = join(__dirname, "..", "..", "runner", "tests", "out", "visual");
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  " + JSON.stringify(detail)?.slice(0, 400)}`);
};

function load(id: string) {
  const path = join(DIR, `${id}.json`);
  if (!existsSync(path)) throw new Error(`no recording for ${id}: run runner/tests/test_programs.py first`);
  const rec = JSON.parse(readFileSync(path, "utf8"));
  const it = interpret(rec.result.trace, rec.files);
  const raw = normalizeTrace(rec.result.trace);
  return { rec, it, raw, last: it.steps.at(-1)! };
}
const vars = (f: FrameView | undefined): Record<string, VarView> => Object.fromEntries([...(f?.args ?? []), ...(f?.locals ?? [])].map((v) => [v.name, v]));
const globals = (s: ScopeView | null): Record<string, VarView> => Object.fromEntries((s?.statics ?? []).flatMap((g) => g.vars.map((v) => [v.name, v])));
const shown = (vs: Record<string, VarView>, names: string[]) => Object.fromEntries(names.map((n) => [n, vs[n] ? `${vs[n].value} : ${vs[n].type}` : "(missing)"]));
const views = (st: VizStep): StructureView[] => [...(st.layers ?? []).map((l) => l.view), (st as unknown as { structure?: StructureView | null }).structure].filter((v): v is StructureView => !!v);
const firstView = (steps: VizStep[], kind: string, name?: string, from: "first" | "last" = "last") => {
  const list = steps.flatMap(views).filter((v) => v.kind === kind && (!name || v.name === name));
  return from === "last" ? list.at(-1) : list[0];
};
const dispatchKinds = (id: string) => {
  const { rec, it, raw } = load(id);
  const h = buildHierarchy(rec.result.hierarchy as ClassModel[]);
  const kinds = new Set<string>();
  raw.steps.forEach((s, k) => {
    const d = dispatchAt(h, s, it.steps[k].scope!.heap);
    if (d) kinds.add(`${d.kind}:${d.implementer.split(/[.$]/).pop()}.${d.methodName}@${d.runtime?.split(/[.$]/).pop()}`);
  });
  return kinds;
};
const run = (name: string, fn: () => void) => {
  try { fn(); } catch (e) { check(`${name}: checks ran`, false, String(e)); }
};

/* ---------------- Java ---------------- */

run("java-primitives", () => {
  const { last } = load("java-primitives");
  const v = shown(vars(last.scope!.frames[0]), ["count", "ready", "ratio", "scale", "grade", "name", "big"]);
  check("java primitives: each variable shows its value and Java type", JSON.stringify(v) === JSON.stringify({
    count: "10 : int", ready: "true : boolean", ratio: "5.0 : double", scale: "1.25 : float", grade: "'C' : char", name: '"Ada Lovelace" : String', big: "9000000000 : long" }), v);
});
run("java-arrays", () => {
  const { it } = load("java-arrays");
  const k = it.steps.findIndex((s) => s.array?.writes.includes(2) && s.array.values[2] === 42);
  check("java arrays: the step after nums[2] = 42 marks index 2 as written", k > 0 && it.steps[k - 1].array?.values[2] === 15, { k, before: it.steps[k - 1]?.array?.values });
  check("  and the final array is [4, 8, 42, 16, 23]", JSON.stringify(it.steps.filter((s) => s.array?.name === "nums").at(-1)?.array?.values) === "[4,8,42,16,23]");
});
run("java-2d-array", () => {
  const { it } = load("java-2d-array");
  const g = firstView(it.steps, "grid", "grid");
  check("java 2D array: new int[3][4] draws exactly 3 rows, 4 columns, 12 cells", !!g && g.grid?.rows === 3 && g.grid?.cols === 4 && JSON.stringify(g.grid?.lengths) === "[4,4,4]" && g.nodes.length === 12, { grid: g?.grid, cells: g?.nodes.length });
  check("  with the values 0..11 in row order", JSON.stringify(g?.nodes.map((n) => Number(n.label))) === JSON.stringify([...Array(12).keys()]), g?.nodes.map((n) => n.label));
  const early = firstView(it.steps, "grid", "grid", "first");
  check("  an early step still shows the untouched zeros", !!early && early.nodes.filter((n) => n.label === "0").length >= 11, early?.nodes.map((n) => n.label));
});
run("java-collections", () => {
  const { last } = load("java-collections");
  const v = vars(last.scope!.frames[0]);
  check("java collections: ArrayList, LinkedList, HashMap, HashSet show their final contents", v.list?.value === "[70, 9]" && /\[\s*"?a"?,\s*"?b"?\s*\]/.test(v.deque?.value ?? "") && /ann/.test(v.ages?.value ?? "") && /32/.test(v.ages?.value ?? "") && !/bo/.test(v.ages?.value ?? "") && /^[[{]4[\]}]$/.test(v.seen?.value ?? ""),
    shown(v, ["list", "deque", "ages", "seen"]));
});
run("java-loops", () => {
  const { it, rec } = load("java-loops");
  const inner = rec.files["Loops.java"].split("\n").findIndex((l: string) => l.includes("out.append(i * j)")) + 1;
  check("java loops: the inner body is shown exactly 7 times (continue and break respected)", it.steps.filter((s) => s.line === inner).length === 7);
});
run("java-arrays loop badge", () => {
  const { it } = load("java-arrays");
  const passes = it.steps.flatMap((s) => s.loops.filter((l) => l.iterable === "nums").map((l) => `${l.iteration}:${l.value?.v}`));
  check("java loop over nums.length: shown with its pass number and index, passes 1..5 for i = 0..4", JSON.stringify([...new Set(passes)]) === JSON.stringify(["1:0", "2:1", "3:2", "4:3", "5:4"]), [...new Set(passes)]);
});
run("java-recursion", () => {
  const { it } = load("java-recursion");
  const deepest = it.steps.map((s) => s.scope!).reduce((a, b) => (b.frames.filter((f) => f.method === "factorial").length > a.frames.filter((f) => f.method === "factorial").length ? b : a));
  check("java recursion: the call stack reads factorial(n = 1) .. factorial(n = 5), main, innermost first", deepest.frames.map((f) => f.signature).join(" | ") === "factorial(n = 1) | factorial(n = 2) | factorial(n = 3) | factorial(n = 4) | factorial(n = 5) | main(args = [])", deepest.frames.map((f) => f.signature));
  const ret = it.steps.map((s) => s.scope!).find((s) => s.frames[0]?.signature === "factorial(n = 5)" && s.frames[0].returning);
  check("  factorial(5) is shown returning 120", ret?.frames[0].returning?.value === "120", ret?.frames[0].returning);
});
run("java-scanner", () => {
  const { rec } = load("java-scanner");
  const r = replayInput(rec.result.trace, rec.files)!;
  const text = r.ops.map((o) => (o.range ? rec.stdin.slice(o.range[0], o.range[1]) : null));
  /* A line read consumes its newline but does not return it: Scanner.nextLine, readLine, and input() all work that way. */
  check("java Scanner: each call is placed on the input it consumed (nextLine consumes the newline too)", JSON.stringify(text.slice(0, 6)) === JSON.stringify(["3", "10", "20", "30", "\n", "Ada Lovelace\n"]) && r.ops[5].result === "Ada Lovelace" && r.ops.slice(0, 6).every((o) => o.verified), { text, verified: r.ops.map((o) => o.verified) });
  check("  the last nextInt is shown failing at the end of the input", r.ops[6]?.ok === false && r.ops[6].range === null, r.ops[6]);
});
run("java-bufferedreader", () => {
  const { rec } = load("java-bufferedreader");
  const r = replayInput(rec.result.trace, rec.files)!;
  const lines = r.ops.filter((o) => o.kind === "line").map((o) => (o.range ? rec.stdin.slice(o.range[0], o.range[1]) : null));
  check("java BufferedReader: readLine is placed on each line, then null at the end", JSON.stringify(lines) === JSON.stringify(["4 5\n", "x\n", "y\n", null]), lines);
  check("  parseInt(\"12x\") is shown failing", r.ops.some((o) => o.kind === "parse" && o.ok === false), r.ops.filter((o) => o.kind === "parse").map((o) => [o.args, o.ok]));
});
run("java-inheritance", () => {
  const k = dispatchKinds("java-inheritance");
  check("java inheritance: the Inheritance view explains each dispatch correctly", ["inherited:Animal.speak@Dog", "override:Dog.sound@Dog", "super-call:Animal.speak@Puppy"].every((x) => k.has(x)) && [...k].some((x) => x.startsWith("super-constructor:") && x.endsWith("@Puppy")), [...k]);
});
run("java-exceptions", () => {
  const { last, rec } = load("java-exceptions");
  check("java exceptions: the last step is the NullPointerException on its line", last.kind === "exception" && last.line === rec.result.exception.line, { kind: last.kind, line: last.line });
});
run("java-bfs-dfs", () => {
  const { it } = load("java-bfs-dfs");
  const g = firstView(it.steps, "graph", "graph");
  const pairs = new Set((g?.edges ?? []).map((e) => [e.from, e.to].map((x) => x.replace(/\D/g, "")).sort().join("-")));
  check("java BFS/DFS: the graph shows 6 nodes and exactly its 6 edges", g?.nodes.length === 6 && [...pairs].sort().join(" ") === "0-1 0-2 1-3 2-4 3-5 4-5", { nodes: g?.nodes.length, pairs: [...pairs] });
});
run("java-dijkstra", () => {
  const { it } = load("java-dijkstra");
  check("java Dijkstra: dist ends [0, 3, 1, 4, 7]", JSON.stringify(it.steps.filter((s) => s.array?.name === "dist").at(-1)?.array?.values) === "[0,3,1,4,7]", it.steps.filter((s) => s.array?.name === "dist").at(-1)?.array?.values);
});
run("java-matrix-traversal", () => {
  const { it } = load("java-matrix-traversal");
  const g = firstView(it.steps, "grid", "m");
  check("java matrix traversal: the matrix draws as 3 x 3 with 1..9", g?.grid?.rows === 3 && g?.grid?.cols === 3 && JSON.stringify(g?.nodes.map((n) => Number(n.label))) === "[1,2,3,4,5,6,7,8,9]", g?.grid);
});
for (const [cls, approach, calls, hits] of [["PascalTriangle", "tabulation", null, null], ["PascalTriangleMemoized", "memoized", 41, 12], ["PascalTriangleNaive", "recursion", 105, 0]] as const) {
  run(`java-dp-${cls}`, () => {
    const { it, raw } = load(`java-dp-${cls}`);
    const m = buildDp(raw, it.steps)!;
    const end = dpStateAt(m, raw.steps.length - 1, raw.steps);
    const six = end.cells.get(cellId(4, 2))!;
    check(`java DP ${cls}: ${approach}, P(4,2) = 3 + 3 = 6${calls ? `, ${calls} calls and ${hits} cache answers` : ""}`, m.approach === approach && m.spec?.id === "pascal" && six.value === 6 && six.deps.map((d) => d.value).join("+") === "3+3" && (calls === null || (end.counters.calls === calls && end.counters.hits === hits)), { a: m.approach, six, c: end.counters });
  });
}
run("java-multi-file", () => {
  const { it } = load("java-multi-file");
  const files = new Set(it.steps.map((s) => s.file));
  check("java multi-file: playback moves through Main, Point, and Geometry", ["app/Main.java", "app/model/Point.java", "app/util/Geometry.java"].every((f) => files.has(f)), [...files]);
});

/* ---------------- Python ---------------- */

run("python-primitives", () => {
  const { it, last } = load("python-primitives");
  const g = shown(globals(last.scope), ["count", "ready", "ratio", "name", "nothing"]);
  check("python primitives: module globals show Python values and runtime types", JSON.stringify(g) === JSON.stringify({ count: "'10' : str", ready: "True : bool", ratio: "5.0 : float", name: "'Ada Lovelace' : str", nothing: "None : None" }), g);
  check("  count shows 10 : int before it becomes a str", it.steps.some((s) => globals(s.scope).count?.value === "10" && globals(s.scope).count?.type === "int"));
});
run("python-collections", () => {
  const { last } = load("python-collections");
  const g = globals(last.scope);
  console.log("      shown:", JSON.stringify(shown(g, ["nums", "point", "ages", "tags", "nested"])));
  check("python collections: list, tuple, dict, set, and nested values are shown in Python notation", g.nums?.value === "[30, 2, 5]" && g.point?.value === "(2, 3)" && g.ages?.value === "{'ann': 32}" && /^\{'[yz]', '[yz]'\}$/.test(g.tags?.value ?? "") && (g.nested?.value ?? "").startsWith("{'grid': ["),
    shown(g, ["nums", "point", "ages", "tags"]));
});
run("python-matrix-numpy", () => {
  const { it } = load("python-matrix-numpy");
  const g = firstView(it.steps, "grid", "grid");
  check("python 2D list: grid draws exactly 3 rows, 4 columns, 12 cells with 0..11", g?.grid?.rows === 3 && g?.grid?.cols === 4 && JSON.stringify(g?.nodes.map((n) => Number(n.label))) === JSON.stringify([...Array(12).keys()]), g?.grid);
});
run("python-loops", () => {
  const { it, rec } = load("python-loops");
  const inner = rec.files["loops.py"].split("\n").findIndex((l: string) => l.includes("out.append(i * j)")) + 1;
  const body = it.steps.filter((s) => s.line === inner);
  console.log("      loop badges inside the inner Python loop:", body.map((s) => s.loops.length).join(","));
  check("python loops: the inner body runs 7 times", body.length === 7, body.length);
});
run("python-functions-recursion", () => {
  const { it, last } = load("python-functions-recursion");
  const deepest = it.steps.map((s) => s.scope!).reduce((a, b) => (b.frames.filter((f) => f.method === "factorial").length > a.frames.filter((f) => f.method === "factorial").length ? b : a));
  check("python recursion: the call stack reads factorial(n = 1) .. factorial(n = 5), main module", deepest.frames.map((f) => f.signature ?? f.title).join(" | ").startsWith("factorial(n = 1) | factorial(n = 2) | factorial(n = 3) | factorial(n = 4) | factorial(n = 5)") && deepest.frames.at(-1)?.title === "main module", deepest.frames.map((f) => f.signature || f.title));
  check("  calls is a module global (5 at the end), not a local", globals(last.scope).calls?.value === "5" && it.steps.every((s) => s.scope!.frames.every((f) => f.method !== "factorial" || !vars(f).calls)));
});
run("python-input", () => {
  const { rec } = load("python-input");
  const r = replayInput(rec.result.trace, rec.files)!;
  const text = r.ops.map((o) => (o.range ? rec.stdin.slice(o.range[0], o.range[1]) : null));
  check("python input(): each call is placed on its line; the fourth hits the end of the input", JSON.stringify(text) === JSON.stringify(["3\n", "10 20 30\n", "Ada\n", null]) && JSON.stringify(r.ops.slice(0, 3).map((o) => o.result)) === JSON.stringify(["3", "10 20 30", "Ada"]) && r.ops[3].ok === false, { text, ok: r.ops.map((o) => o.ok) });
});
run("python-inheritance", () => {
  const k = dispatchKinds("python-inheritance");
  check("python inheritance: the Inheritance view explains each dispatch correctly", ["inherited:Animal.speak@Dog", "override:Dog.sound@Dog", "super-call:Animal.speak@Puppy", "super-constructor:Animal.<init>@Puppy"].every((x) => k.has(x)), [...k]);
});
run("python-exceptions-stdlib", () => {
  const { last } = load("python-exceptions-stdlib");
  const acct = globals(last.scope).acct;
  check("python exceptions: the last step is the NameError, and acct reads like its repr: Account(owner='ann', balance=70)", last.kind === "exception" && acct?.value === "Account(owner='ann', balance=70)", acct?.value);
});
run("python-algorithms", () => {
  const { it } = load("python-algorithms");
  const g = firstView(it.steps, "graph", "graph");
  const pairs = new Set((g?.edges ?? []).map((e) => [e.from, e.to].map((x) => x.replace(/\D/g, "")).sort().join("-")));
  check("python BFS/DFS: the adjacency list draws as 6 nodes and exactly its 6 edges", g?.nodes.length === 6 && [...pairs].sort().join(" ") === "0-1 0-2 1-3 2-4 3-5 4-5", { nodes: g?.nodes.length, pairs: [...pairs] });
});
for (const [file, approach, calls, hits] of [["pascal_triangle", "tabulation", null, null], ["pascal_memo", "memoized", 41, 12], ["pascal_naive", "recursion", 105, 0]] as const) {
  run(`python-dp-${file}`, () => {
    const { it, raw } = load(`python-dp-${file}`);
    const m = buildDp(raw, it.steps)!;
    const end = dpStateAt(m, raw.steps.length - 1, raw.steps);
    const six = end.cells.get(cellId(4, 2))!;
    check(`python DP ${file}: ${approach}, P(4,2) = 3 + 3 = 6${calls ? `, ${calls} calls and ${hits} cache answers` : ""}`, m.approach === approach && six.value === 6 && six.deps.map((d) => d.value).join("+") === "3+3" && (calls === null || (end.counters.calls === calls && end.counters.hits === hits)), { a: m.approach, c: end.counters });
  });
}
run("python-multi-file", () => {
  const { it } = load("python-multi-file");
  const files = new Set(it.steps.map((s) => s.file));
  check("python multi-file: playback moves through all four files", ["main.py", "helpers.py", "geometry/report.py", "geometry/shapes.py"].every((f) => files.has(f)), [...files]);
});
run("python-pandas", () => {
  const { last } = load("python-pandas");
  const df = globals(last.scope).df;
  console.log("      DataFrame shown as:", df?.value, ":", df?.type);
  check("python pandas: the DataFrame is shown with its columns", /team/.test(df?.value ?? "") && /pts/.test(df?.value ?? ""), df?.value);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
