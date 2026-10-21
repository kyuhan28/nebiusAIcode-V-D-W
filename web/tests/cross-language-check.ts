/**
 * The same programs in Java, Python, C, and C++, recorded by the runner (tests/fixtures/cross-language). Each
 * prints its state on its CHECK line; the visualizer must show exactly those values there. Also checks
 * recursion depth and per-frame values, globals inside functions, and 3 x 4 matrices.
 * Run: npx tsx tests/cross-language-check.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { interpret } from "../lib/trace/interpret";
const DIR = join(__dirname, "fixtures/cross-language");
let pass = 0, fail = 0;
const check = (n: string, ok: boolean, d?: unknown) => { ok ? pass++ : fail++; if (!ok || process.argv.includes("-v")) console.log(`${ok ? "PASS" : "FAIL"} ${n}${ok ? "" : "  " + JSON.stringify(d)?.slice(0, 400)}`); };
const norm = (v: string) => v.trim().replace(/^["']|["']$/g, "");
const same = (a: string, b: string) => { const x = norm(a), y = norm(b); return x === y || (x !== "" && y !== "" && !isNaN(+x) && !isNaN(+y) && +x === +y); };
type VarView = { name: string; value: string; type?: string };
for (const f of readdirSync(DIR).sort()) {
  const rec = JSON.parse(readFileSync(`${DIR}/${f}`, "utf8"));
  const key: string = rec.key;
  const [path, src] = Object.entries(rec.files)[0] as [string, string];
  const it = interpret(rec.result.trace, rec.files);
  const checkLine = src.split("\n").findIndex((l) => l.includes("CHECK")) + 1;
  const at = it.steps.filter((s) => s.line === checkLine && (s.sourcePath ?? path) === path).at(-1);
  if (!at) { check(`${key}: the CHECK line ${checkLine} is a recorded step`, false, it.steps.map((s) => s.line)); continue; }
  const frame = at.scope?.frames[0];
  const vars: VarView[] = [...(frame?.locals ?? []), ...(frame?.args ?? []), ...((at.scope?.statics ?? []).flatMap((g) => g.vars))] as VarView[];
  const printed = (rec.run.stdout as string).trim().split(/\s+/).map((kv) => kv.split("=")).filter((p) => p.length === 2);
  for (const [k, v] of printed) {
    const shown = vars.find((x) => x.name === k);
    /* Printed expressions (list.get(0), arr[1], m[2][3]) rather than variables of that program. */
    if (!shown && !new RegExp(`\\b${k}\\s*(=(?!=)|\\+=|\\[)`).test(src.split("\n").filter((l) => !l.includes("CHECK")).join("\n"))) continue;
    check(`${key}: ${k} shows ${v} at the CHECK line`, !!shown && same(shown.value, v), shown ?? `missing; visible: ${vars.map((x) => `${x.name}=${x.value}`).join(", ")}`);
  }
  check(`${key}: only the main frame is left at the CHECK line`, (at.scope?.frames.length ?? 0) === 1, at.scope?.frames.map((x) => x.method));
  if (key.endsWith("/recursion")) {
    const deepest = it.steps.reduce((a, s) => ((s.scope?.frames.length ?? 0) > (a.scope?.frames.length ?? 0) ? s : a));
    /* Python's module-level n is a global, shown with the module's globals rather than in a frame. */
    const ns = deepest.scope!.frames.map((fr, i, all) => [...fr.locals, ...(fr.args ?? []), ...(i === all.length - 1 ? (deepest.scope!.statics ?? []).flatMap((g) => g.vars) : [])].find((x) => x.name === "n")?.value);
    check(`${key}: 6 frames at the deepest point, each with its own n`, deepest.scope!.frames.length === 6 && JSON.stringify(ns.map(Number)) === "[1,2,3,4,5,5]", ns);
  }
  if (key.endsWith("/globals")) {
    const inside = it.steps.find((s) => (s.scope?.frames.length ?? 0) === 2);
    const visible = inside && [...(inside.scope?.statics ?? []).flatMap((g) => g.vars), ...(inside.scope?.frames.flatMap((fr) => fr.locals) ?? [])].some((x) => x.name === "counter");
    check(`${key}: the global is visible inside bump()`, !!visible, inside?.scope);
  }
  if (key.endsWith("/matrix")) {
    const views = it.steps.flatMap((s) => [s.structure, ...(s.layers ?? []).map((l) => l.view)]).filter(Boolean) as unknown as { kind: string; name: string; grid?: { rows: number; cols: number }; nodes: { id: string; label: string }[] }[];
    const g = views.filter((v) => v.kind === "grid" && v.name === "m").at(-1);
    const cells = g ? g.nodes.filter((n) => /^g\d+,\d+$/.test(n.id)) : [];
    check(`${key}: m is drawn as a 3 x 4 grid of 12 cells holding 0..11`, !!g && g.grid?.rows === 3 && g.grid?.cols === 4 && cells.length === 12 && cells.every((n) => { const [r, c] = n.id.slice(1).split(",").map(Number); return n.label === String(r * 4 + c); }), g ? { grid: g.grid, cells: cells.length } : `no grid; views: ${[...new Set(views.map((v) => v.kind + ":" + v.name))].join(", ")}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
