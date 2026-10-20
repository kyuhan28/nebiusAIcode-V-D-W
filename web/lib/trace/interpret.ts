import { applyLoops, detectExtraLayers, detectStructure, polishSequence, titleFor, type StructureView } from "./structures";
import { findLoops, trackLoops, type ActiveLoop } from "./loops";

/**
 * Turns a raw execution recording (from any language's recorder) into visualization steps.
 * The recorder only reports facts: lines, frames, locals, and heap objects. Everything here is
 * derived from those facts, so the picture can never drift from what the program really did.
 *
 * Scope for this milestone: one primary array (or list of values) per program. Programs
 * without one still get line, variable, and output playback.
 */

export type Val = { t: string; v?: unknown; id?: string };
export type HeapObj =
  | { t: "array"; of: string; len: number; items: Val[] }
  | { t: "object"; cls: string; fields: Record<string, Val> }
  | { t: "list" | "stack" | "deque" | "heap" | "set"; cls: string; items: Val[]; buckets?: number[]; capacity?: number }
  | { t: "map"; cls: string; entries: [Val, Val][]; buckets?: number[]; capacity?: number }
  | { t: "opaque"; cls: string };
export type RawFrame = { cls: string; method: string; line: number; locals: Record<string, Val> };
export type RawStep = {
  kind: "line" | "exception";
  line: number;
  sourcePath: string | null;
  cls: string;
  method: string;
  out: number;
  stack: RawFrame[];
  statics?: Record<string, Val>;
  heap: Record<string, HeapObj> | null;
};
export type RawTrace = {
  /** Recorded input operations (Scanner, BufferedReader, StringTokenizer, parse calls) and the stdin they read. */
  io?: import("./input").IoEvent[];
  ioTruncated?: boolean;
  stdin?: string;
  version: number;
  steps: RawStep[];
  stepCount: number;
  truncated: boolean;
  stopReason: string | null;
  sourceMap: Record<string, string>;
};

export type ArrayView = {
  name: string;
  values: (number | string | boolean | null)[];
  pointers: { name: string; index: number }[];
  reads: number[];
  writes: number[];
  swap: [number, number] | null;
};
export type VizVar = { name: string; value: string; changed: boolean };
export type VizStep = {
  index: number;
  kind: "line" | "exception";
  line: number;
  file: string | null;
  method: string;
  depth: number;
  out: number;
  frames: { method: string; line: number }[];
  vars: VizVar[];
  array: ArrayView | null;
  structure: StructureView | null;
  /** Every structure on screen when there are several, each with its own title. */
  layers: { key: string; title: string; view: StructureView | null }[];
  /** Loops running at this step, outermost first. */
  loops: ActiveLoop[];
  note: string;
};
export type Interpretation = {
  steps: VizStep[];
  array: { name: string; length: number; id: string } | null;
  structure: StructureView["kind"] | null;
  /** The structures drawn together, when the program holds more than one. */
  layers: { key: string; title: string }[];
};

const NUMERIC = new Set(["int", "long", "short", "byte", "double", "float", "char", "Integer", "Long", "Short", "Byte", "Double", "Float", "Character", "String"]);
const SEQUENCES = new Set(["list", "stack", "deque"]);
const INDEX_NAMES = /^(i|j|k|l|r|lo|hi|low|high|mid|left|right|start|end|min|max|minIndex|maxIndex|minIdx|maxIdx|idx|index|pos|p|q|a|b|cur|curr|slow|fast|key|top|head|tail|front|rear|parent|child|smallest|largest)$/;

function sequenceItems(obj: HeapObj | undefined): Val[] | null {
  if (!obj) return null;
  if (obj.t === "array") return NUMERIC.has(obj.of) ? obj.items : null;
  if (SEQUENCES.has(obj.t)) {
    const items = (obj as { items: Val[] }).items;
    return items.every((v) => v.t !== "ref") ? items : null;
  }
  return null;
}

const plain = (v: Val) => (v.t === "null" ? null : (v.v as number | string | boolean));

function display(v: Val, heap: Record<string, HeapObj>): string {
  if (v.t === "null") return "null";
  if (v.t === "String") return JSON.stringify(v.v);
  if (v.t === "char" || v.t === "Character") return `'${v.v}'`;
  if (v.t !== "ref") return String(v.v);
  const obj = heap[v.id as string];
  if (!obj) return "…";
  const items = sequenceItems(obj);
  if (items) {
    const shown = items.slice(0, 8).map((x) => String(plain(x)));
    return `[${shown.join(", ")}${items.length > 8 ? ", …" : ""}]`;
  }
  if (obj.t === "array") return `${obj.of.split(/[.$]/).pop()}[${obj.len}]`;
  if (obj.t === "map") return `{${obj.entries.length} entries}`;
  if (obj.t === "object") return obj.cls.split(/[.$]/).pop() as string;
  return obj.cls.split(".").pop() as string;
}

/** Evaluates simple index expressions like i, j + 1, mid - 1, 3, using the frame's ints. */
function evalIndex(expr: string, ints: Record<string, number>): number | null {
  const m = expr.trim().match(/^([A-Za-z_]\w*|\d+)\s*(?:([+-])\s*(\d+))?$/);
  if (!m) return null;
  const base = /^\d+$/.test(m[1]) ? Number(m[1]) : ints[m[1]];
  if (base === undefined) return null;
  return m[2] ? base + (m[2] === "+" ? 1 : -1) * Number(m[3]) : base;
}

export function interpret(trace: RawTrace, sources: Record<string, string> = {}): Interpretation {
  /* 1. Heaps are only sent when they change; carry the latest one forward. */
  const heaps: Record<string, HeapObj>[] = [];
  let current: Record<string, HeapObj> = {};
  for (const s of trace.steps) {
    if (s.heap) current = s.heap;
    heaps.push(current);
  }

  /* 2. Choose the array the program is clearly working on: referenced often, changed often. */
  const score = new Map<string, { refs: number; changes: number; names: Map<string, number>; last: string }>();
  trace.steps.forEach((s, k) => {
    const seen = new Set<string>();
    /* Locals, plus arrays one level down inside objects (a stack's items, a heap's array). */
    const visible: [string, Val, number][] = [];
    s.stack.forEach((f, depth) => {
      for (const [name, v] of Object.entries(f.locals)) {
        visible.push([name, v, depth]);
        const o = v.t === "ref" ? heaps[k][v.id as string] : undefined;
        if (o?.t === "object") for (const [fname, fv] of Object.entries(o.fields)) visible.push([fname, fv, depth + 1]);
      }
    });
    for (const [name, v] of Object.entries(s.statics ?? {})) visible.push([name.split(".").pop() as string, v, 1]);
    [visible].forEach((entries) => {
      for (const [name, v, depth] of entries) {
        if (v.t !== "ref" || seen.has(v.id as string)) continue;
        const items = sequenceItems(heaps[k][v.id as string]);
        if (!items) continue;
        seen.add(v.id as string);
        const e = score.get(v.id as string) ?? { refs: 0, changes: 0, names: new Map(), last: "" };
        e.refs += depth === 0 ? 2 : 1;
        if (depth <= 1) e.names.set(name, (e.names.get(name) ?? 0) + (depth === 0 ? 2 : 1));
        const sig = JSON.stringify(items);
        if (e.last && sig !== e.last) e.changes++;
        e.last = sig;
        score.set(v.id as string, e);
      }
    });
  });
  let best: { id: string; value: number } | null = null;
  score.forEach((e, id) => {
    const value = e.refs + e.changes * 6;
    if (!best || value > best.value) best = { id, value };
  });
  const chosen = best as { id: string; value: number } | null;
  const primaryId = chosen?.id ?? null;
  const primaryName = primaryId
    ? [...(score.get(primaryId)?.names.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "array"
    : null;

  /* 3. Build each step. */
  let prevValues: ArrayView["values"] | null = null;
  let prevVars = new Map<string, string>();
  const recentWrites: { step: number; index: number; from: unknown; to: unknown }[] = [];
  let maxLength = 0;

  const detector = detectStructure(trace.steps, heaps);
  const extra = detectExtraLayers(trace.steps, heaps, detector, sources);
  const loopsPerStep = trackLoops(trace, findLoops(sources));
  const lineOf = (st: RawStep) => {
    const f = st.sourcePath ? trace.sourceMap[st.sourcePath] ?? st.sourcePath : null;
    return f ? sources[f]?.split("\n")[st.line - 1] ?? "" : "";
  };

  const steps: VizStep[] = trace.steps.map((s, k) => {
    const heap = heaps[k];
    const top = s.stack[0];
    const vars: VizVar[] = top
      ? Object.entries(top.locals)
          .filter(([name]) => name !== "args" && name !== "this")
          .map(([name, v]) => {
            const value = display(v, heap);
            const changed = prevVars.has(name) && prevVars.get(name) !== value;
            return { name, value, changed };
          })
      : [];
    prevVars = new Map(vars.map((v) => [v.name, v.value]));

    let array: ArrayView | null = null;
    let note = s.kind === "exception" ? "The program stopped with an exception here" : `Line ${s.line} in ${s.method}()`;

    const items = primaryId ? sequenceItems(heap[primaryId]) : null;
    if (items && primaryId) {
      const values = items.map(plain);
      maxLength = Math.max(maxLength, values.length);
      const ints: Record<string, number> = {};
      const isInt = (v: Val) => (v.t === "int" || v.t === "Integer" || v.t === "long" || v.t === "short") && typeof v.v === "number";
      /* Fields of the object the method runs on (top, head, tail) count as pointers too. */
      const self = top?.locals.this?.t === "ref" ? heap[top.locals.this.id as string] : undefined;
      if (self?.t === "object") for (const [name, v] of Object.entries(self.fields)) if (isInt(v)) ints[name] = v.v as number;
      for (const [name, v] of Object.entries(top?.locals ?? {})) if (isInt(v)) ints[name] = v.v as number;
      /* The local that holds the array in this frame may have a different name (e.g. a parameter). */
      const fieldName = self?.t === "object" ? Object.entries(self.fields).find(([, v]) => v.t === "ref" && v.id === primaryId)?.[0] : undefined;
      const localName =
        Object.entries(top?.locals ?? {}).find(([, v]) => v.t === "ref" && v.id === primaryId)?.[0] ?? fieldName ?? primaryName ?? "array";

      const writes: number[] = [];
      if (prevValues && prevValues.length === values.length) {
        values.forEach((v, i) => {
          if (v !== prevValues![i]) {
            writes.push(i);
            recentWrites.push({ step: k, index: i, from: prevValues![i], to: v });
          }
        });
      }
      while (recentWrites.length && k - recentWrites[0].step > 3) recentWrites.shift();

      /* A swap: two cells traded values within a few steps (e.g. via a temporary variable). */
      let swap: [number, number] | null = null;
      if (writes.length === 2) {
        const [a, b] = writes;
        if (values[a] === prevValues![b] && values[b] === prevValues![a]) swap = [a, b];
      } else if (writes.length === 1) {
        const b = writes[0];
        const earlier = recentWrites.find((w) => w.step < k && w.index !== b && w.to === prevValues![b] && w.from === values[b]);
        if (earlier) swap = [earlier.index, b];
      }
      if (swap) recentWrites.length = 0;

      /* Cells read on this line: arr[expr] where expr is simple and evaluates in bounds. */
      const file = s.sourcePath ? trace.sourceMap[s.sourcePath] ?? s.sourcePath : null;
      const text = file ? sources[file]?.split("\n")[s.line - 1] ?? "" : "";
      const reads = new Set<number>();
      const named = new Set<string>();
      const access = new RegExp(`\\b${localName}\\s*\\[([^\\]]+)\\]|\\b${localName}\\.get\\(([^)]+)\\)`, "g");
      for (const m of text.matchAll(access)) {
        const expr = m[1] ?? m[2];
        const idx = evalIndex(expr, ints);
        if (idx !== null && idx >= 0 && idx < values.length) reads.add(idx);
        const id = expr.trim().match(/^[A-Za-z_]\w*/)?.[0];
        if (id && id in ints) named.add(id);
      }
      const pointers = Object.entries(ints)
        .filter(([name, v]) => (named.has(name) || INDEX_NAMES.test(name)) && v >= 0 && v < values.length)
        .slice(0, 4)
        .map(([name, index]) => ({ name, index }));

      array = { name: localName, values, pointers, reads: [...reads], writes, swap };

      if (swap) note = `Swap ${localName}[${swap[0]}] and ${localName}[${swap[1]}]`;
      else if (writes.length === 1) {
        const w = writes[0];
        note = `${localName}[${w}] = ${values[w]}, was ${prevValues?.[w]}`;
      } else if (reads.size >= 2 && /[<>]=?|==|!=/.test(text)) {
        const [a, b] = [...reads];
        note = `Compare ${localName}[${a}] (${values[a]}) with ${localName}[${b}] (${values[b]})`;
      } else if (reads.size === 1) {
        const [a] = [...reads];
        note = `Read ${localName}[${a}], which is ${values[a]}`;
      }
      prevValues = values;
    }

    return {
      index: k,
      kind: s.kind,
      line: s.line,
      file: s.sourcePath ? trace.sourceMap[s.sourcePath] ?? s.sourcePath : null,
      method: s.method,
      depth: s.stack.length,
      out: s.out,
      frames: s.stack.map((f) => ({ method: f.method, line: f.line })),
      vars,
      array,
      structure: detector ? detector.view({ step: s, heap, line: lineOf(s) }) : null,
      layers: extra.map((l) => ({ key: l.key, title: l.title, view: l.detector.view({ step: s, heap, line: lineOf(s) }) })),
      loops: loopsPerStep[k] ?? [],
      note,
    };
  });
  if (detector && (detector.kind === "stack" || detector.kind === "queue")) polishSequence(steps.map((st) => st.structure));
  extra.forEach((l, i) => {
    if (l.detector.kind === "stack" || l.detector.kind === "queue") polishSequence(steps.map((st) => st.layers[i].view));
  });
  /* The primary structure joins the layers when there is more than one structure to show. */
  const primaryTitle = detector ? titleFor(detector, trace.steps, heaps) : "";
  const multi = extra.length + (detector ? 1 : 0) >= 2;
  for (const st of steps) {
    if (multi && detector) st.layers.unshift({ key: "primary", title: primaryTitle, view: st.structure });
    if (!multi) st.layers = [];
    /* Loops light up the element they're on, in whichever structure they iterate. */
    for (const v of [st.structure, ...st.layers.map((l) => l.view)]) applyLoops(v, st.loops);
    if (st.array && st.loops.length) {
      const name = primaryName;
      for (const lp of st.loops) if (lp.iterable === name) {
        const idx = lp.kind === "forEach" ? st.array.values.findIndex((x) => String(x) === String(lp.value?.v)) : lp.iteration - 1;
        if (idx >= 0 && idx < st.array.values.length) st.array.pointers = [...st.array.pointers.filter((p) => p.name !== lp.varName), { name: lp.varName, index: idx }];
        if (st.note.startsWith("Line ")) st.note = lp.kind === "indexed" ? `for loop over ${lp.exprText}: ${lp.varName} = ${lp.iteration - 1}` : `for (${lp.typeText} ${lp.varName} : ${lp.exprText}): pass ${lp.iteration} of ${st.array.values.length}, ${lp.varName} = ${lp.value?.v}`;
      }
    }
  }
  /* Structure captions are more specific than line notes when nothing else happened. */
  /* Stacks, queues, and maps narrate their own operations, so their caption always wins. */
  const seqView = detector?.kind === "stack" || detector?.kind === "queue" || detector?.kind === "map";
  for (const st of steps) if (st.structure && (seqView || st.note.startsWith("Line "))) st.note = st.structure.caption;
  for (const st of steps) {
    const badge = [st.structure, ...st.layers.map((l) => l.view)].find((v) => v?.badge)?.badge;
    if (badge && (st.note.startsWith("Line ") || /^\d+ (element|entr|item|node)/.test(st.note) || / is empty$/.test(st.note) || /: \d+ elements?$/.test(st.note))) st.note = badge;
  }

  return {
    steps,
    array: primaryId && primaryName ? { name: primaryName, length: maxLength, id: primaryId } : null,
    structure: detector?.kind ?? null,
    layers: steps[0]?.layers.map((l) => ({ key: l.key, title: l.title })) ?? [],
  };
}
