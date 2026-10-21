/**
 * Lists of lists and 2D arrays in the visualizer, from real recordings (tests/fixtures/nested-collections).
 * Run: npx tsx tests/nested-collections-check.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { interpret } from "../lib/trace/interpret";

const DIR = join(__dirname, "fixtures/nested-collections");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  " + JSON.stringify(d)?.slice(0, 300)}`); };
type Grid = { kind: string; name: string; nodes: { id: string; label: string; state: string }[]; caption: string };
const steps = (k: string) => { const { files, result } = JSON.parse(readFileSync(join(DIR, `${k}.json`), "utf8")); return interpret(result.trace, files).steps; };
const gridAt = (s: ReturnType<typeof steps>[number], name: string): Grid | null =>
  ([s.structure, ...(s.layers ?? []).map((l) => l.view)].find((v) => (v as unknown as Grid | null)?.kind === "grid" && (v as unknown as Grid).name === name) as unknown as Grid) ?? null;
const rows = (g: Grid | null) => { if (!g) return null; const r: string[][] = []; for (const n of g.nodes) { const m = n.id.match(/^g(\d+),(\d+)$/); if (m) (r[+m[1]] ??= [])[+m[2]] = n.label; } return r; };
const last = (k: string) => { const s = steps(k); return s[s.length - 1]; };

/* The reported bug: List<List<String>> built one inner list at a time. */
const g = steps("groups");
check("List<List<String>>: drawn from the moment it exists, as an empty grid", g.filter((s) => s.line !== null && s.line >= 7 && s.line <= 10).every((s) => gridAt(s, "groups")?.caption === "groups is empty (0 × 0)"), g.map((s) => gridAt(s, "groups")?.caption));
const byLine = (line: number) => rows(gridAt(g.find((s) => s.line === line)!, "groups"));
check("  adding fruits adds a row", JSON.stringify(byLine(11)) === JSON.stringify([["apple", "pear"]]), byLine(11));
check("  adding veg adds a second row, of a different length", JSON.stringify(byLine(14)) === JSON.stringify([["apple", "pear"], ["kale"]]), byLine(14));
check("  adding an inline list adds the third", JSON.stringify(byLine(15)) === JSON.stringify([["apple", "pear"], ["kale"], ["x", "y", "z"]]), byLine(15));
check("  groups.get(0).add(\"plum\") extends row 0 in place", JSON.stringify(rows(gridAt(last("groups"), "groups"))) === JSON.stringify([["apple", "pear", "plum"], ["kale"], ["x", "y", "z"]]));
const added = gridAt(g.find((s) => s.line === 14)!, "groups")!;
check("  the cells just added are highlighted", added.nodes.find((n) => n.label === "kale")?.state === "special", added.nodes);
check("  and the caption says the rows differ in length", /3 rows of different lengths/.test(gridAt(last("groups"), "groups")!.caption));

/* Other 2D shapes. */
check("List<List<Integer>> (boxed numbers), with a set", JSON.stringify(rows(gridAt(last("ints"), "rows"))) === JSON.stringify([["1", "2"], ["30"]]));
check("String[][]", JSON.stringify(rows(gridAt(last("strings2d"), "words"))) === JSON.stringify([["a", "b"], ["z", "d"]]));
check("char[][] shows the characters, not their codes", JSON.stringify(rows(gridAt(last("chars2d"), "board"))) === JSON.stringify([["#", "Q"], [".", "#"]]));
check("List<int[]>", JSON.stringify(rows(gridAt(last("arrays_in_list"), "pairs"))) === JSON.stringify([["1", "2"], ["3", "4"]]));
check("a Python list of lists of strings", JSON.stringify(rows(gridAt(last("py_strings"), "table"))) === JSON.stringify([["a", "b"], ["c", "d"]]));
const flat = last("flat_list");
check("a flat List<Integer> that starts empty is still a list, not a grid", !gridAt(flat, "nums") && JSON.stringify(flat.array?.values ?? (flat.layers ?? []).find((l) => (l.view as unknown as { name?: string } | null)?.name === "nums")?.view) === JSON.stringify([5, 6]), flat.array);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
