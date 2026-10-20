/**
 * Dynamic programming, read from a recorded run. Two kinds of runtime evidence:
 *
 * - Table writes (tabulation, and the cache in memoization): a cell of a 2D numeric array changing
 *   between two recorded steps. The line that made the change is the step before.
 * - Calls and returns (recursion): every invocation of the recursive method, with its own
 *   arguments, the calls it made, and the value it returned. A call that returns without making
 *   calls and is not a base case answered from the cache.
 *
 * A recurrence spec (Pascal's triangle is the first) says which subproblems a value depends on.
 * Every observed value is checked against it; dependencies drawn from a spec are labelled as such,
 * and only shown when the recorded values agree with it.
 */
import type { HeapObj, RawStep, RawTrace, Val, VizStep } from "./interpret";

export type CellId = string;
export const cellId = (r: number, c: number): CellId => `${r},${c}`;

export type Approach = "tabulation" | "memoized" | "recursion";

/** What a recurrence says about one problem; future specs (Fibonacci, LCS, coin change) plug in here. */
export type RecurrenceSpec = {
  id: string;
  title: string;
  /** Lines of the relation, shown as written. */
  formula: { text: string; when: string; base: boolean }[];
  /** The relation in plain language. */
  plain: string[];
  layout: "triangle" | "table";
  isBase: (r: number, c: number) => boolean;
  deps: (r: number, c: number) => [number, number][];
  combine: (values: number[]) => number;
  baseValue: (r: number, c: number) => number;
  /** The relation filled in for one cell: "P(4,2) = P(3,1) + P(3,2)". */
  instance: (r: number, c: number) => string;
  complexity: Record<Approach, string>;
};

export const PASCAL: RecurrenceSpec = {
  id: "pascal",
  title: "Pascal's triangle",
  formula: [
    { text: "P(r, c) = P(r−1, c−1) + P(r−1, c)", when: "for 0 < c < r", base: false },
    { text: "P(r, 0) = 1,   P(r, r) = 1", when: "the two ends of every row", base: true },
  ],
  plain: [
    "r is the row and c the position in it, both counted from 0.",
    "Every value inside a row is the sum of the two values just above it.",
    "The first and last values of every row are 1: those are the base cases.",
    "Each row reuses the row before it, so no value is ever worked out from scratch.",
  ],
  layout: "triangle",
  isBase: (r, c) => c === 0 || c === r,
  deps: (r, c) => (c === 0 || c === r ? [] : [[r - 1, c - 1], [r - 1, c]]),
  combine: (v) => v.reduce((a, b) => a + b, 0),
  baseValue: () => 1,
  instance: (r, c) => (c === 0 || c === r ? `P(${r},${c}) = 1` : `P(${r},${c}) = P(${r - 1},${c - 1}) + P(${r - 1},${c})`),
  complexity: {
    tabulation: "Building n rows does one addition per inside value: O(n²) additions, and O(n²) stored values when the whole triangle is kept.",
    memoized: "Each value is computed once and then looked up, so n rows cost O(n²) work and an O(n²) cache. The recursion also uses up to n stack frames.",
    recursion: "With no cache, the same values are computed again and again. Computing P(r, c) this way takes 2·P(r, c) − 1 calls, so the work grows exponentially with the row.",
  },
};

/** Every recurrence the visualizer knows. A run is matched to the first one its values agree with. */
export const SPECS: RecurrenceSpec[] = [PASCAL];

export type DpWrite = { step: number; r: number; c: number; value: number; line: number | null; file: string | null; parents: { r: number; c: number; value: number | null }[] };
export type DpCall = {
  key: string;
  r: number;
  c: number;
  callStep: number;
  returnStep: number | null;
  value: number | null;
  outcome: "base" | "hit" | "computed" | null;
  parent: string | null;
  children: string[];
  line: number | null;
  file: string | null;
};

export type DpModel = {
  approach: Approach;
  spec: RecurrenceSpec | null;
  /** The 2D array the run fills: the table itself, or the memo cache. */
  table: { name: string; writes: DpWrite[] } | null;
  method: string | null;
  calls: DpCall[];
  rows: number;
  /** Why the spec matched, or what did not agree with it. */
  checks: { matched: number; mismatches: string[] };
};

const num = (v: Val | undefined) => (v && typeof v.v === "number" && v.t !== "char" && v.t !== "boolean" ? (v.v as number) : null);

/** A 2D numeric array as rows of numbers, or null where a row is not allocated yet. */
function grid(outer: HeapObj | undefined, heap: Record<string, HeapObj>): (number | null)[][] | null {
  if (!outer) return null;
  /* A cache keyed by (r, c) tuples, like Python's memo[(r, c)]: laid out as a table too. */
  if (outer.t === "map") {
    const rows: (number | null)[][] = [];
    for (const [k, v] of outer.entries) {
      const key = k.t === "ref" ? heap[k.id as string] : undefined;
      const rc = key && key.t === "list" && key.items.length === 2 ? key.items.map(num) : null;
      const value = num(v);
      if (!rc || rc[0] === null || rc[1] === null || value === null) continue;
      (rows[rc[0]] ??= [])[rc[1]] = value;
    }
    return rows.map((r) => (r ? Array.from(r, (x) => x ?? null) : (null as unknown as (number | null)[])));
  }
  /* Java's long[][] and Python's list of lists. */
  if (outer.t !== "array" && outer.t !== "list") return null;
  return outer.items.map((row) => {
    const o = row.t === "ref" ? heap[row.id as string] : undefined;
    return o && (o.t === "array" || (o.t === "list" && o.cls === "list")) ? o.items.map(num) : (null as unknown as (number | null)[]);
  });
}

function nameOf(steps: RawStep[], id: string): string {
  for (let k = steps.length - 1; k >= 0; k--) {
    for (const [q, v] of Object.entries(steps[k].statics ?? {})) if (v.t === "ref" && v.id === id) return q.slice(q.lastIndexOf(".") + 1);
    for (const f of steps[k].stack) for (const [n, v] of Object.entries(f.locals)) if (v.t === "ref" && v.id === id) return n;
  }
  return "table";
}

/** The 2D array with the most cell writes over the run, with every write and the parents' values then. */
function tableWrites(steps: RawStep[], heaps: Record<string, HeapObj>[], viz: VizStep[], spec: RecurrenceSpec | null) {
  const outers = new Set<string>();
  for (const heap of heaps) {
    for (const [id, o] of Object.entries(heap)) {
      const javaTable = o.t === "array" && /^(int|long|short|byte|double|float)\[\]$/.test(o.of);
      const pyTable = o.t === "list" && o.cls === "list" && o.items.some((x) => x.t === "ref" && heap[x.id as string]?.t === "list");
      const pyCache = o.t === "map" && o.entries.some(([k]) => k.t === "ref" && heap[k.id as string]?.t === "list");
      if (javaTable || pyTable || pyCache) outers.add(id);
    }
  }
  let best: { id: string; writes: DpWrite[] } | null = null;
  for (const id of outers) {
    const writes: DpWrite[] = [];
    let prev = grid(heaps[0]?.[id], heaps[0] ?? {});
    for (let k = 1; k < heaps.length; k++) {
      const cur = grid(heaps[k][id], heaps[k]);
      if (cur) {
        cur.forEach((row, r) => row?.forEach((v, c) => {
          const was = prev?.[r]?.[c] ?? null;
          /* A new row of zeros is an allocation, not a computed value. */
          if (v === null || v === was || (was === null && v === 0)) return;
          const parents = (spec?.deps(r, c) ?? []).map(([pr, pc]) => ({ r: pr, c: pc, value: cur[pr]?.[pc] ?? null }));
          writes.push({ step: k, r, c, value: v, line: viz[k - 1]?.line ?? null, file: viz[k - 1]?.file ?? null, parents });
        }));
      }
      prev = cur ?? prev;
    }
    if (writes.length && (!best || writes.length > best.writes.length)) best = { id, writes };
  }
  return best ? { name: nameOf(steps, best.id), writes: best.writes } : null;
}

/** Every call of the recursive method (one that calls itself) with at least one numeric argument. */
function recursion(steps: RawStep[], viz: VizStep[]): { method: string; calls: DpCall[] } | null {
  const recursive = new Map<string, number>();
  for (const s of steps) {
    for (let i = 0; i + 1 < s.stack.length; i++) {
      const a = s.stack[i], b = s.stack[i + 1];
      if (a.method === b.method && a.cls === b.cls) recursive.set(`${a.cls}#${a.method}`, (recursive.get(`${a.cls}#${a.method}`) ?? 0) + 1);
    }
  }
  const method = [...recursive.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
  if (!method) return null;
  const calls = new Map<string, DpCall>();
  steps.forEach((s, k) => {
    s.stack.forEach((f, i) => {
      if (`${f.cls}#${f.method}` !== method || !f.key || calls.has(f.key)) return;
      const args = (f.args ?? []).map((n) => num(f.locals[n])).filter((x): x is number => x !== null);
      if (!args.length) return;
      const caller = s.stack[i + 1];
      calls.set(f.key, {
        key: f.key, r: args[0], c: args[1] ?? 0, callStep: k, returnStep: null, value: null, outcome: null,
        parent: caller && `${caller.cls}#${caller.method}` === method ? caller.key ?? null : null, children: [],
        line: viz[k]?.line ?? null, file: viz[k]?.file ?? null,
      });
    });
    if (s.kind === "return" && s.stack[0]?.key && calls.has(s.stack[0].key)) {
      const call = calls.get(s.stack[0].key)!;
      call.returnStep = k;
      call.value = num(s.ret);
      call.line = viz[k]?.line ?? call.line;
    }
  });
  if (!calls.size) return null;
  for (const call of calls.values()) if (call.parent) calls.get(call.parent)?.children.push(call.key);
  return { method: method.slice(method.indexOf("#") + 1), calls: [...calls.values()] };
}

/** Builds the model from a normalized recording and its interpreted steps; null when the run is not DP-shaped. */
export function buildDp(trace: RawTrace, viz: VizStep[]): DpModel | null {
  const steps = trace.steps;
  const heaps = viz.map((v) => v.scope?.heap ?? {});
  const rec = recursion(steps, viz);
  const calls = rec?.calls ?? [];
  const byKey = new Map(calls.map((c) => [c.key, c]));
  const leafNonBase = (spec: RecurrenceSpec | null) => calls.filter((c) => c.returnStep !== null && !c.children.length && !(spec?.isBase(c.r, c.c) ?? true)).length;

  /* Try each known recurrence; keep the first that every recorded value agrees with. */
  let chosen: { spec: RecurrenceSpec | null; table: DpModel["table"]; mismatches: string[]; matched: number } | null = null;
  for (const spec of [...SPECS, null]) {
    const table = tableWrites(steps, heaps, viz, spec);
    if (!spec) { chosen = { spec: null, table, mismatches: [], matched: 0 }; break; }
    const mismatches: string[] = [];
    let matched = 0;
    if (rec) {
      for (const c of calls) {
        if (c.value === null) continue;
        if (spec.isBase(c.r, c.c)) {
          if (c.value !== spec.baseValue(c.r, c.c)) mismatches.push(`${rec.method}(${c.r}, ${c.c}) returned ${c.value}, not the base value`);
          else matched++;
        } else if (c.children.length) {
          const want = spec.deps(c.r, c.c).map(([r, cc]) => cellId(r, cc)).sort().join("|");
          const got = c.children.map((k) => byKey.get(k)!).map((x) => cellId(x.r, x.c)).sort().join("|");
          const sum = spec.combine(c.children.map((k) => byKey.get(k)!.value ?? NaN));
          if (want !== got || sum !== c.value) mismatches.push(`${rec.method}(${c.r}, ${c.c}) called ${got || "nothing"} and returned ${c.value}`);
          else matched++;
        } else matched++;
      }
    } else if (table) {
      for (const w of table.writes) {
        const ok = spec.isBase(w.r, w.c) ? w.value === spec.baseValue(w.r, w.c) : w.parents.every((p) => p.value !== null) && w.value === spec.combine(w.parents.map((p) => p.value!));
        if (ok) matched++;
        else mismatches.push(`${table.name}[${w.r}][${w.c}] became ${w.value}`);
      }
    }
    if (matched > 0 && !mismatches.length) { chosen = { spec, table, mismatches, matched }; break; }
  }
  if (!chosen || (!rec && !chosen.table)) return null;
  /* How each call ended: computed from its own calls, a base case, or answered from the cache. */
  for (const c of calls) {
    if (c.returnStep === null) continue;
    c.outcome = c.children.length ? "computed" : !chosen.spec || chosen.spec.isBase(c.r, c.c) ? "base" : "hit";
  }
  const approach: Approach = rec ? (leafNonBase(chosen.spec) > 0 || chosen.table ? "memoized" : "recursion") : "tabulation";
  const points = rec ? calls.map((c) => c.r) : chosen.table!.writes.map((w) => w.r);
  return {
    approach,
    spec: chosen.spec,
    table: chosen.table,
    method: rec?.method ?? null,
    calls,
    rows: Math.max(0, ...points) + 1,
    checks: { matched: chosen.matched, mismatches: chosen.mismatches },
  };
}

/* ---------------- State at one step ---------------- */

export type CellView = {
  r: number;
  c: number;
  status: "pending" | "evaluating" | "waiting" | "current" | "computed";
  value: number | null;
  base: boolean;
  /** Where the dependencies come from: the recorded calls, or the recurrence (checked against recorded values). */
  deps: { r: number; c: number; value: number | null }[];
  depsFrom: "calls" | "recurrence" | null;
  /** How many times the value was computed (more than once only without a cache), and cache answers. */
  computed: number;
  hits: number;
  /** Where it was computed: step, file, line. */
  at: { step: number; file: string | null; line: number | null } | null;
};

export type DpState = {
  cells: Map<CellId, CellView>;
  /** The cell this step is about. */
  focus: CellId | null;
  /** What happened at this step, in a sentence. */
  event: string | null;
  /** The cache (memo table) as of this step, for memoization. */
  cache: Map<CellId, number>;
  cacheHit: CellId | null;
  counters: { calls: number; base: number; hits: number; computed: number; writes: number; distinct: number; repeats: number };
};

export function dpStateAt(m: DpModel, step: number, steps: RawStep[]): DpState {
  const cells = new Map<CellId, CellView>();
  const blank = (r: number, c: number): CellView => ({ r, c, status: "pending", value: null, base: m.spec?.isBase(r, c) ?? false, deps: [], depsFrom: null, computed: 0, hits: 0, at: null });
  const cell = (r: number, c: number) => {
    const id = cellId(r, c);
    if (!cells.has(id)) cells.set(id, blank(r, c));
    return cells.get(id)!;
  };
  /* The shape of the whole problem is known from the recording, so pending cells show from the start. */
  for (let r = 0; r < m.rows; r++) for (let c = 0; c <= (m.spec?.layout === "triangle" ? r : m.rows - 1); c++) cell(r, c);
  const cache = new Map<CellId, number>();
  let focus: CellId | null = null;
  let event: string | null = null;
  let cacheHit: CellId | null = null;
  const counters = { calls: 0, base: 0, hits: 0, computed: 0, writes: 0, distinct: 0, repeats: 0 };
  const name = (r: number, c: number) => `P(${r},${c})`;

  if (m.approach === "tabulation" && m.table) {
    for (const w of m.table.writes) {
      if (w.step > step) {
        /* The line about to run makes the next write: show that cell as being evaluated. */
        if (w.step === step + 1) { const v = cell(w.r, w.c); v.status = "evaluating"; focus ??= cellId(w.r, w.c); }
        continue;
      }
      const v = cell(w.r, w.c);
      v.value = w.value;
      v.status = w.step === step ? "current" : "computed";
      v.deps = w.parents;
      v.depsFrom = w.parents.length ? "recurrence" : null;
      v.computed += 1;
      v.at = { step: w.step, file: w.file, line: w.line };
      counters.writes++;
      if (w.step === step) {
        focus = cellId(w.r, w.c);
        event = w.parents.length
          ? `${name(w.r, w.c)} = ${w.parents.map((p) => p.value).join(" + ")} = ${w.value}, stored in ${m.table.name}[${w.r}][${w.c}]`
          : `${name(w.r, w.c)} = 1, a base case at the end of row ${w.r}`;
      }
    }
  } else {
    const byKey = new Map(m.calls.map((c) => [c.key, c]));
    const onStack = new Set((steps[step]?.stack ?? []).map((f) => f.key));
    const top = steps[step]?.stack[0]?.key;
    for (const call of m.calls) {
      if (call.callStep > step) continue;
      counters.calls++;
      const v = cell(call.r, call.c);
      const returned = call.returnStep !== null && call.returnStep <= step;
      if (returned) {
        if (call.outcome === "base") counters.base++;
        if (call.outcome === "hit") { counters.hits++; v.hits++; }
        if (call.outcome === "computed") { counters.computed++; v.computed++; }
        if (v.value === null || call.outcome !== "hit") {
          v.value = call.value;
          if (call.outcome === "computed") {
            v.deps = call.children.map((k) => byKey.get(k)!).map((x) => ({ r: x.r, c: x.c, value: x.value }));
            v.depsFrom = "calls";
          }
          v.at = { step: call.returnStep!, file: call.file, line: call.line };
        }
        if (v.status !== "current") v.status = "computed";
        if (call.returnStep === step) {
          focus = cellId(call.r, call.c);
          v.status = "current";
          const fn = m.method ?? "f";
          event = call.outcome === "hit" ? `${fn}(${call.r}, ${call.c}) answered from the cache: ${call.value}, no recursion`
            : call.outcome === "base" ? `${fn}(${call.r}, ${call.c}) is a base case: ${call.value}`
              : `${fn}(${call.r}, ${call.c}) = ${call.children.map((k) => byKey.get(k)!.value).join(" + ")} = ${call.value}`;
          if (call.outcome === "hit") cacheHit = cellId(call.r, call.c);
        }
      } else if (onStack.has(call.key)) {
        v.status = call.key === top ? "evaluating" : v.value === null ? "waiting" : v.status;
        if (call.key === top) {
          focus ??= cellId(call.r, call.c);
          if (call.callStep === step) event = `Call ${m.method}(${call.r}, ${call.c})${call.parent ? `, asked for by ${m.method}(${byKey.get(call.parent)!.r}, ${byKey.get(call.parent)!.c})` : ""}`;
        }
      }
    }
    if (m.table) for (const w of m.table.writes) if (w.step <= step) { cache.set(cellId(w.r, w.c), w.value); counters.writes++; }
  }
  for (const v of cells.values()) {
    if (v.value !== null) counters.distinct++;
    if (v.computed > 1) counters.repeats += v.computed - 1;
  }
  return { cells, focus, event, cache, cacheHit, counters };
}
