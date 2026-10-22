/**
 * Strings and StringBuilder in the visualizer, from real recordings (tests/fixtures/strings).
 * Run: npx tsx tests/strings-check.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { interpret } from "../lib/trace/interpret";

const DIR = join(__dirname, "fixtures/strings");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  " + JSON.stringify(d)?.slice(0, 300)}`); };
type View = { kind: string; name: string; nodes: { id: string; label: string; state: string }[] };
const load = (k: string) => { const { files, result } = JSON.parse(readFileSync(join(DIR, `${k}.json`), "utf8")); return interpret(result.trace, files); };
const view = (s: ReturnType<typeof load>["steps"][number], name: string): View | null =>
  ([s.structure, ...(s.layers ?? []).map((l) => l.view)].find((v) => (v as unknown as View | null)?.name === name) as unknown as View) ?? null;
const rows = (v: View | null) => { const r: string[][] = []; for (const n of v?.nodes ?? []) { const m = n.id.match(/^g(\d+),(\d+)$/); if (m) (r[+m[1]] ??= [])[+m[2]] = n.label; } return r; };
const hot = (v: View | null) => (v?.nodes ?? []).filter((n) => n.state === "current").map((n) => n.id).sort();
const local = (s: ReturnType<typeof load>["steps"][number], n: string) => [...(s.scope?.frames[0]?.locals ?? []), ...(s.scope?.frames[0]?.args ?? []), ...(s.scope?.statics ?? []).flatMap((g) => g.vars)].find((v) => v.name === n)?.value;

/* The longest common prefix program from the user. */
const lcp = load("lcp");
const cmp = lcp.steps.filter((s) => s.line === 12);
check("String[] strs is a character grid: one row per word", JSON.stringify(rows(view(cmp[0], "strs"))) === JSON.stringify([[..."flower"], [..."flow"], [..."flight"]]), rows(view(cmp[0], "strs")));
check("  each comparison highlights strs[0].charAt(i) and strs[j].charAt(i)", cmp.every((s) => JSON.stringify(hot(view(s, "strs"))) === JSON.stringify([`g0,${local(s, "i")}`, `g${local(s, "j")},${local(s, "i")}`].sort())), cmp.map((s) => [local(s, "i"), local(s, "j"), hot(view(s, "strs"))]));
const sbStates: string[] = [];
for (const s of lcp.steps) { const v = view(s, "sb"); if (v) { const t = v.nodes.map((n) => n.label).join(""); if (sbStates.at(-1) !== t) sbStates.push(t); } }
check("StringBuilder sb is drawn as its characters as it grows: f, fl, flo", JSON.stringify(sbStates.filter(Boolean)) === JSON.stringify(["f", "fl", "flo"]), sbStates);
check("  and reads as \"flo\" in the variables panel", lcp.steps.filter((s) => local(s, "sb") !== undefined).at(-1) && local(lcp.steps.filter((s) => local(s, "sb") !== undefined).at(-1)!, "sb") === '"flo"');

/* Other shapes. */
const vow = load("vowels");
const loopReads = vow.steps.filter((s) => s.line === 8);
check("a single String read with charAt is a one-row strip, highlighting s.charAt(i)", JSON.stringify(rows(view(loopReads[0], "s"))) === JSON.stringify([[..."banana"]]) && loopReads.every((s) => JSON.stringify(hot(view(s, "s"))) === JSON.stringify([`g0,${local(s, "i")}`])), loopReads.map((s) => hot(view(s, "s"))));
const ops: string[] = [];
for (const s of load("builder_ops").steps) { const v = local(s, "sb"); if (v && ops.at(-1) !== v) ops.push(v); }
check("StringBuilder through insert, reverse, setCharAt, deleteCharAt", JSON.stringify(ops) === JSON.stringify(['"abc"', '"xabc"', '"cbax"', '"Cbax"', '"Cba"']), ops);
const lone = load("lone_words");
check("a lone String[] is drawn (it used to show nothing)", lone.layers.length === 1 && JSON.stringify(view(lone.steps.at(-1)!, "words")?.nodes.map((n) => n.label)) === JSON.stringify(["red", "teal", "blue"]), lone.layers.map((l) => l.key));
const printed = load("printed_only");
check("strings only printed are not turned into character grids", printed.layers.length === 0 && !printed.structure, printed.layers.map((l) => l.key));
const ps = load("py_str");
const pyReads = ps.steps.filter((s) => s.line === 4);
check("a Python str indexed with s[i] is a strip, highlighting s[i]", JSON.stringify(rows(view(pyReads[0], "s"))) === JSON.stringify([[..."banana"]]) && pyReads.every((s) => JSON.stringify(hot(view(s, "s"))) === JSON.stringify([`g0,${local(s, "i")}`])), pyReads.map((s) => [local(s, "i"), hot(view(s, "s"))]));
const pw = load("py_words");
const pwReads = pw.steps.filter((s) => s.line === 4);
check("a Python list of strings read with words[r][c] is a character grid", JSON.stringify(rows(view(pwReads[0], "words"))) === JSON.stringify([[..."cat"], [..."car"], [..."cap"]]) && pwReads.every((s) => hot(view(s, "words")).length === 3), pwReads.map((s) => hot(view(s, "words"))));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
