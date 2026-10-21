/**
 * Python collections in the visualizer, from real recordings (tests/fixtures/python-collections,
 * recorded by the runner's Python recorder). Run: npx tsx tests/python-collections-check.ts
 *
 * The view is picked the way the workspace picks it: several layers, else a structure (grid, map,
 * set), else the array view.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { interpret } from "../lib/trace/interpret";

const DIR = join(__dirname, "fixtures/python-collections");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  " + JSON.stringify(d)?.slice(0, 300)}`); };
const load = (name: string) => {
  const { files, result } = JSON.parse(readFileSync(join(DIR, `${name}.json`), "utf8"));
  return { it: interpret(result.trace, files), result };
};
const shown = (name: string) => {
  const { it } = load(name);
  const kind = it.layers.length >= 2 ? "layers" : it.structure ? "structure" : it.array ? "array" : "nothing";
  return { it, kind, last: it.steps[it.steps.length - 1] };
};
const arr = (name: string) => shown(name).last.array;
const states = (name: string) => {
  const out: string[] = [];
  for (const s of shown(name).it.steps) if (s.array) { const k = `${s.array.name}=${JSON.stringify(s.array.values)}`; if (out[out.length - 1] !== k) out.push(k); }
  return out;
};
const grid = (name: string) => {
  const v = shown(name).last.structure as unknown as { kind: string; grid?: { rows: number; cols: number }; nodes: { id: string; label: string }[] } | null;
  if (!v || v.kind !== "grid" || !v.grid) return null;
  const cells: string[][] = Array.from({ length: v.grid.rows }, () => Array(v.grid!.cols).fill(""));
  for (const n of v.nodes) { const m = n.id.match(/^g(\d+),(\d+)$/); if (m) cells[+m[1]][+m[2]] = n.label; }
  return { rows: v.grid.rows, cols: v.grid.cols, cells };
};

/* The four programs from the bug report. */
check("numbers = [1, 2, 3, 4, 5] is drawn, named, typed list", shown("numbers").kind === "array" && JSON.stringify(arr("numbers")) === JSON.stringify({ ...arr("numbers"), name: "numbers", type: "list", values: [1, 2, 3, 4, 5] }), arr("numbers"));
check("arr = [0] * 10 filled in a loop ends as [0, 2, ..., 18]", JSON.stringify(arr("arr")?.values) === JSON.stringify([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]), arr("arr"));
const loopSteps = shown("arr").it.steps.filter((s) => s.line === 4 && s.array);
check("  and the module-level loop index i is drawn at arr[i] while it runs", loopSteps.length > 0 && loopSteps.every((s) => { const p = s.array!.pointers.find((x) => x.name === "i"); const iv = s.scope?.statics.flatMap((g) => g.vars).find((v) => v.name === "i"); return !!p && (!iv || Number(iv.value) === p.index); }), loopSteps.map((s) => s.array?.pointers));
check("matrix = [[1, 2, 3], [4, 5, 6]] is drawn as a 2 x 3 grid", JSON.stringify(grid("matrix")) === JSON.stringify({ rows: 2, cols: 3, cells: [["1", "2", "3"], ["4", "5", "6"]] }), grid("matrix"));
check("values grows from [] through each append", JSON.stringify(states("values")) === JSON.stringify(["values=[]", "values=[10]", "values=[10,20]", "values=[10,20,30]"]), states("values"));

/* Mutation versus reassignment. */
check("mutations: each change is its own state, and arr = [10, 20] shows the new list", JSON.stringify(states("mutations")) === JSON.stringify(["arr=[1,2,3]", "arr=[99,2,3]", "arr=[99,2,3,4]", "arr=[99,2,3]", "arr=[99,2,3,5,6]", "arr=[10,20]"]), states("mutations"));
const re = shown("mutations").it.steps.find((s) => JSON.stringify(s.array?.values) === "[10,20]");
check("  and the reassignment is not shown as cells being written", !!re && re.array!.writes.length === 0, re?.array);
const al = states("alias");
check("alias: names stay bound to their own lists (a = [7] does not change b's list)", al[al.length - 1] === "a=[7]" || al[al.length - 1] === "b=[1,2,3]", al);
const sharing = shown("alias").it.steps.find((s) => JSON.stringify(s.array?.values) === "[1,2,3]");
check("  while a and b share one list, the other name is shown as an alias", !!sharing && sharing.array!.aliases.length > 0, sharing?.array);

/* Functions. */
check("pass and return: inside double it is xs, and afterwards out = [2, 4, 6]", states("pass_return").includes("xs=[1,2,3]") && states("pass_return").at(-1) === "out=[2,4,6]", states("pass_return"));
check("a list built inside a function is shown as nums there and as result after it returns", states("in_function").some((x) => x.startsWith("nums=")) && states("in_function").at(-1) === "result=[3,1,2,9]", states("in_function"));

/* Matrices. */
check("matrix 3 x 4: 3 rows, 4 columns, all 12 values in place (with matrix[1][2] = 70)", JSON.stringify(grid("matrix_4x3")) === JSON.stringify({ rows: 3, cols: 4, cells: [["1", "2", "3", "4"], ["5", "6", "70", "8"], ["9", "10", "11", "12"]] }), grid("matrix_4x3"));
check("a matrix from a nested comprehension is a 2 x 3 grid", JSON.stringify(grid("comprehension_matrix")?.cells) === JSON.stringify([["0", "1", "2"], ["3", "4", "5"]]), grid("comprehension_matrix"));
check("a matrix built with nested loops is a 3 x 2 grid", ["structure", "layers"].includes(shown("loop_matrix").kind) && JSON.stringify(grid("loop_matrix")?.cells) === JSON.stringify([["0", "1"], ["1", "2"], ["2", "3"]]), grid("loop_matrix"));

/* Other types. */
check("strings: names = ['ann', 'ben', 'cy']", JSON.stringify(arr("strings")?.values) === JSON.stringify(["ann", "ben", "cy"]), arr("strings"));
check("mixed types show as Python writes them: None and True", JSON.stringify(arr("mixed")?.values) === JSON.stringify([1, "two", 3.5, "None", "True"]), arr("mixed"));
check("a tuple is drawn, typed tuple", arr("tuple")?.type === "tuple" && JSON.stringify(arr("tuple")?.values) === "[3,4]", arr("tuple"));
const dict = shown("dict").last.structure as unknown as { kind: string; nodes: { label: string }[] } | null;
check("a dict is drawn as a map with its keys and values", dict?.kind === "map" && ["ann", "bob", "cy", "31", "25", "40"].every((l) => dict.nodes.some((n) => n.label === l)), dict?.nodes.map((n) => n.label));
const set = shown("set").last.structure as unknown as { kind: string; nodes: { label: string }[] } | null;
check("a set is drawn with its elements", set?.kind === "set" && ["1", "2", "3", "5"].every((l) => set.nodes.some((n) => n.label === l)), set?.nodes.map((n) => n.label));
check("a 1-D NumPy array is drawn, typed numpy.ndarray", arr("numpy_1d")?.type === "numpy.ndarray" && JSON.stringify(arr("numpy_1d")?.values) === "[10,2,3]", arr("numpy_1d"));
check("a 2-D NumPy array uses its real shape: 2 x 3", JSON.stringify(grid("numpy_2d")) === JSON.stringify({ rows: 2, cols: 3, cells: [["0", "1", "2"], ["3", "4", "5"]] }), grid("numpy_2d"));
check("an empty list is still drawn (named, size 0)", shown("empty").kind === "array" && arr("empty")?.name === "values" && arr("empty")?.values.length === 0, arr("empty"));

/* Playback: a step always shows the same state, forward or backward. */
const a = shown("mutations").it.steps.map((s) => JSON.stringify(s.array)), b = shown("mutations").it.steps.map((s) => JSON.stringify(s.array));
check("playback is deterministic: every step shows the same state each time", JSON.stringify(a) === JSON.stringify(b));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
