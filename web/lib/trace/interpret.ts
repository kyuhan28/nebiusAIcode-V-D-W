import { applyLoops, detectExtraLayers, detectStructure, polishSequence, titleFor, type Detector, type StructureView } from "./structures";
import { findLoops, trackLoops, type ActiveLoop } from "./loops";
import { createScopeBuilder, frameTitle, normalizeTrace, type ClassInfo, type ScopeView } from "./scope";
import { describeType, identifier, simpleName } from "./types";

/**
 * Turns a raw execution recording (from any language's recorder) into visualization steps.
 * The recorder only reports facts: lines, frames, locals, and heap objects. Everything here is
 * derived from those facts, so the picture can never drift from what the program really did.
 *
 * Scope for this milestone: one primary array (or list of values) per program. Programs
 * without one still get line, variable, and output playback.
 */

export type Val = {
  t: string;
  v?: unknown;
  id?: string;
  /* C and C++ pointers (from bin/ctrace.py): what they point at, read from the stopped program. */
  ptr?: boolean;
  state?: "live" | "past-end" | "dangling" | "stack" | "global" | "static" | "unknown";
  block?: number;
  offset?: number;
  index?: number | null;
  addr?: string;
  var?: string;
  frameVar?: string;
  string?: string;
  type?: string;
  code?: number;
};
export type HeapObj =
  | { t: "array"; of: string; len: number; items: Val[] }
  | { t: "object"; cls: string; fields: Record<string, Val> }
  | { t: "list" | "stack" | "deque" | "heap" | "set"; cls: string; items: Val[]; buckets?: number[]; capacity?: number }
  | { t: "map"; cls: string; entries: [Val, Val][]; buckets?: number[]; capacity?: number }
  | { t: "opaque"; cls: string };
export type RawFrame = {
  cls: string;
  method: string;
  line: number;
  locals: Record<string, Val>;
  /** Trace v2: one id per invocation, so two calls of a method never share a frame. */
  id?: number;
  /** Call depth from the outermost user frame (0). */
  depth?: number;
  /** Parameter names, sent with the frame's first step. */
  args?: string[];
  /** The running method's JVM descriptor, "(I)V", sent with the frame's first step. */
  sig?: string;
  /** Declared types of the visible variables, sent when they change. */
  types?: Record<string, string>;
  /** Filled in by normalizeTrace: a stable key for this invocation. */
  key?: string;
};
export type RawStep = {
  /** "return" steps are recorded as a method returns, while its frame is still on the stack. */
  kind: "line" | "exception" | "return";
  line: number;
  sourcePath: string | null;
  cls: string;
  method: string;
  out: number;
  stack: RawFrame[];
  statics?: Record<string, Val>;
  heap: Record<string, HeapObj> | null;
  /** How many user frames were on the stack; the recorder sends at most 16 of them. */
  stackDepth?: number;
  /** The real return value on a "return" step ({ t: "void" } for void methods). */
  ret?: Val;
  retType?: string;
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
  /** Trace v2: declared field and static types per user class. */
  classes?: Record<string, ClassInfo>;
  /** "python" for recordings made by pyrun.py; Java recordings leave it out. */
  language?: string;
};

export type ArrayView = {
  name: string;
  /** Declared type of the variable that holds it here, or the runtime type when none was recorded. */
  type: string | null;
  /** Other variables holding this same array: "arr in main". */
  aliases: string[];
  values: (number | string | boolean | null)[];
  pointers: { name: string; index: number }[];
  reads: number[];
  writes: number[];
  swap: [number, number] | null;
};
export type VizVar = { name: string; value: string; changed: boolean };
export type VizStep = {
  index: number;
  kind: "line" | "exception" | "return";
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
  /** Call frames, their variables, static fields, and the call or return at this step. */
  scope: ScopeView | null;
};
export type Interpretation = {
  steps: VizStep[];
  array: { name: string; length: number; id: string } | null;
  structure: StructureView["kind"] | null;
  /** The primary structure's floating label: "scores : Map<String, Integer>". */
  title: string;
  /** The structures drawn together, when the program holds more than one. */
  layers: { key: string; title: string }[];
};

const NUMERIC = new Set(["int", "long", "short", "byte", "double", "float", "char", "Integer", "Long", "Short", "Byte", "Double", "Float", "Character", "String"]);
const SEQUENCES = new Set(["list", "stack", "deque"]);
/**
 * The variables a program uses as indexes into the array called `name`, from its own source:
 * subscripts (arr[i], arr[j + 1], list.get(k)) and loops bounded by the array's length
 * (i < arr.length, i < len(arr), range(len(arr))). A variable is drawn on the array only with this
 * evidence; a scalar such as max or count never is, whatever its name or value.
 */
const KEYWORDS = new Set(["length", "size", "len", "int", "long", "new", "this", "self", "true", "false", "null", "None", "Math", "range"]);
const indexUsersCache = new Map<string, Set<string>>();
function indexUsers(sources: Record<string, string>, name: string): Set<string> {
  const key = `${name}\u0000${Object.keys(sources).join("|")}`;
  const hit = indexUsersCache.get(key);
  if (hit) return hit;
  const out = new Set<string>();
  const ids = (expr: string) => { for (const id of expr.match(/[A-Za-z_]\w*/g) ?? []) if (id !== name && !KEYWORDS.has(id)) out.add(id); };
  const n = name.replace(/[$]/g, "\\$");
  for (const text of Object.values(sources)) {
    for (const m of text.matchAll(new RegExp(`\\b${n}\\s*\\[([^\\]]+)\\]`, "g"))) ids(m[1]);
    for (const m of text.matchAll(new RegExp(`\\b${n}\\s*\\.\\s*(?:get|set|remove)\\(\\s*([^,)]+)`, "g"))) ids(m[1]);
    for (const m of text.matchAll(new RegExp(`\\b([A-Za-z_]\\w*)\\s*<=?\\s*(?:${n}\\s*\\.\\s*(?:length|size\\s*\\(\\s*\\))|len\\(\\s*${n}\\s*\\))`, "g"))) out.add(m[1]);
    for (const m of text.matchAll(new RegExp(`for\\s+([A-Za-z_]\\w*)\\s+in\\s+range\\((?:[^,()]*,\\s*)?len\\(\\s*${n}\\s*\\)`, "g"))) out.add(m[1]);
  }
  /* Variables that compute an index are index variables too: in mid = (lo + hi) / 2, lo and hi. */
  for (let round = 0; round < 3; round++) {
    const before = out.size;
    for (const u of [...out]) {
      const uu = u.replace(/[$]/g, "\\$");
      for (const text of Object.values(sources)) {
        for (const m of text.matchAll(new RegExp(`\\b${uu}\\s*[-+*/]?=(?!=)\\s*([^;\\n]+)`, "g"))) {
          for (const id of m[1].replace(/[A-Za-z_]\w*\s*\(/g, "(").match(/[A-Za-z_]\w*/g) ?? []) if (id !== name && !KEYWORDS.has(id)) out.add(id);
        }
      }
    }
    if (out.size === before) break;
  }
  indexUsersCache.set(key, out);
  return out;
}

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
  if (v.t === "str") return `'${String(v.v)}'`;
  if (v.t === "bool") return v.v ? "True" : "False";
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
/** The sequences bound to names a Python step can see: its locals first, then the program's module globals. */
function pyScope(s: RawStep, heap: Record<string, HeapObj>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [n, v] of Object.entries(s.stack[0]?.locals ?? {})) if (v.t === "ref" && sequenceItems(heap[v.id as string])) m.set(n, v.id as string);
  for (const [q, v] of Object.entries(s.statics ?? {})) {
    const n = q.startsWith("__main__.") ? q.slice(9) : null;
    if (n && !m.has(n) && v.t === "ref" && sequenceItems(heap[v.id as string])) m.set(n, v.id as string);
  }
  return m;
}

/** A Python value as the cell shows it: None, True, and False as Python writes them. */
function pyPlain(v: Val): ReturnType<typeof plain> {
  if (v.t === "null") return "None" as ReturnType<typeof plain>;
  if (v.t === "boolean" || v.t === "bool") return (v.v ? "True" : "False") as ReturnType<typeof plain>;
  return plain(v);
}

function evalIndex(expr: string, ints: Record<string, number>): number | null {
  const m = expr.trim().match(/^([A-Za-z_]\w*|\d+)\s*(?:([+-])\s*(\d+))?$/);
  if (!m) return null;
  const base = /^\d+$/.test(m[1]) ? Number(m[1]) : ints[m[1]];
  if (base === undefined) return null;
  return m[2] ? base + (m[2] === "+" ? 1 : -1) * Number(m[3]) : base;
}

export function interpret(raw: RawTrace, sources: Record<string, string> = {}): Interpretation {
  /* 0. Frame ids, parameter names, and declared types are sent once; carry them forward. */
  const trace = normalizeTrace(raw);
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
  const python = trace.language === "python";
  let tracked: { name: string; id: string } | null = python && primaryId && primaryName ? { name: primaryName, id: primaryId } : null;
  let prevScope = new Map<string, string>();
  let prevShownId: string | null = null;
  let prevValues: ArrayView["values"] | null = null;
  let prevVars = new Map<string, string>();
  const recentWrites: { step: number; index: number; from: unknown; to: unknown }[] = [];
  let maxLength = 0;

  const detector = detectStructure(trace.steps, heaps);
  const extra = detectExtraLayers(trace.steps, heaps, detector, sources, 4, trace.classes);
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

    /* Python binds names to objects and re-binds them freely: follow the variable, not the first list seen. */
    let shownId = primaryId;
    let shownName: string | null = null;
    if (python) {
      const scope = pyScope(s, heap);
      /* What the last statement bound (a new name, or a name re-bound to another list) comes first; then the
         name already shown; then whichever name holds the same list (a parameter, a returned value). */
      const changed = [...scope].find(([n, id]) => prevScope.get(n) !== id);
      const kept = tracked && scope.has(tracked.name) ? ([tracked.name, scope.get(tracked.name)!] as [string, string]) : undefined;
      const same = tracked ? [...scope].find(([, id]) => id === tracked!.id) : undefined;
      const c = changed ?? kept ?? same ?? [...scope][0];
      const pick: { name: string; id: string } | null = c ? { name: c[0], id: c[1] } : null;
      prevScope = scope;
      if (pick) tracked = pick;
      shownId = tracked?.id ?? null;
      shownName = tracked?.name ?? null;
      /* A different object than the last step: its cells were not "written", it was swapped in. */
      if (shownId !== prevShownId) { prevValues = null; recentWrites.length = 0; }
      prevShownId = shownId;
    }
    const items = shownId ? sequenceItems(heap[shownId]) : null;
    if (items && shownId) {
      const values = items.map(python ? pyPlain : plain);
      maxLength = Math.max(maxLength, values.length);
      const ints: Record<string, number> = {};
      const isInt = (v: Val) => (v.t === "int" || v.t === "Integer" || v.t === "long" || v.t === "short") && typeof v.v === "number";
      /* Fields of the object the method runs on (top, head, tail) count as pointers too. */
      const self = top?.locals.this?.t === "ref" ? heap[top.locals.this.id as string] : undefined;
      if (self?.t === "object") for (const [name, v] of Object.entries(self.fields)) if (isInt(v)) ints[name] = v.v as number;
      /* Python module globals (a top-level for loop's i) are visible too; locals win. */
      if (python) for (const [q, v] of Object.entries(s.statics ?? {})) if (q.startsWith("__main__.") && isInt(v)) ints[q.slice(9)] = v.v as number;
      for (const [name, v] of Object.entries(top?.locals ?? {})) if (isInt(v)) ints[name] = v.v as number;
      /* The local that holds the array in this frame may have a different name (e.g. a parameter). */
      const fieldName = self?.t === "object" ? Object.entries(self.fields).find(([, v]) => v.t === "ref" && v.id === shownId)?.[0] : undefined;
      const localName = (python && shownName) ||
        (Object.entries(top?.locals ?? {}).find(([, v]) => v.t === "ref" && v.id === shownId)?.[0] ?? fieldName ?? primaryName ?? "array");

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
      const users = indexUsers(sources, localName);
      const pointers = Object.entries(ints)
        .filter(([name, v]) => (named.has(name) || users.has(name)) && v >= 0 && v < values.length)
        .slice(0, 4)
        .map(([name, index]) => ({ name, index }));

      /* The label uses the declared type where it was recorded: this frame's local, the field of
         `this`, another frame's local, or a static field, whichever holds the array by that name. */
      let declared: string | undefined;
      let source = "";
      const inFrame = s.stack.findIndex((f) => f.locals[localName]?.t === "ref" && f.locals[localName].id === shownId);
      const inStatic = Object.keys(s.statics ?? {}).find((q) => q.endsWith(`.${localName}`) && s.statics![q].t === "ref" && s.statics![q].id === shownId);
      if (inFrame === 0) { declared = top?.types?.[localName]; source = `0:${localName}`; }
      else if (fieldName && self?.t === "object") { declared = trace.classes?.[self.cls]?.fields[fieldName]; source = "field"; }
      else if (inFrame > 0) { declared = s.stack[inFrame].types?.[localName]; source = `${inFrame}:${localName}`; }
      else if (inStatic) { declared = trace.classes?.[inStatic.slice(0, inStatic.lastIndexOf("."))]?.statics[localName]; source = inStatic; }
      const described = describeType(declared, heap[shownId]).type;
      const type = python && described === "ndarray" ? "numpy.ndarray" : described;
      const aliases: string[] = [];
      s.stack.forEach((f, depth) => {
        for (const [nm, v] of Object.entries(f.locals)) {
          if (v.t !== "ref" || v.id !== shownId || nm === "this" || `${depth}:${nm}` === source) continue;
          const text = `${nm} in ${frameTitle(f.method, f.cls)}`;
          if (aliases.length < 2 && !aliases.includes(text)) aliases.push(text);
        }
      });
      for (const [q, v] of Object.entries(s.statics ?? {})) {
        if (v.t !== "ref" || v.id !== shownId || q === source || aliases.length >= 2) continue;
        aliases.push(`${simpleName(q.slice(0, q.lastIndexOf(".")))}.${q.slice(q.lastIndexOf(".") + 1)}`);
      }

      array = { name: localName, type, aliases, values, pointers, reads: [...reads], writes, swap };

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
      scope: null,
    };
  });
  if (detector && (detector.kind === "stack" || detector.kind === "queue")) polishSequence(steps.map((st) => st.structure));
  extra.forEach((l, i) => {
    if (l.detector.kind === "stack" || l.detector.kind === "queue") polishSequence(steps.map((st) => st.layers[i].view));
  });
  /* The primary structure joins the layers when there is more than one structure to show. */
  let primaryTitle = detector ? titleFor(detector, trace.steps, heaps, trace.classes) : "";
  /* Trees and linked lists found by their node class are named after the variable holding them. */
  if (detector && !detector.name) primaryTitle = ownerLabel(trace, heaps, detector, primaryTitle);
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
  /* Variables, frames, and static fields per step, with references marked when the scene draws them. */
  const build = createScopeBuilder({ classes: trace.classes, language: trace.language === "python" ? "python" : trace.language === "c" || trace.language === "cpp" ? "c" : "java" });
  const arrayLabel = (st: VizStep) => (st.array ? identifier(st.array.name, st.array.type) : "");
  steps.forEach((st, k) => {
    const drawn = new Map<string, string>();
    if (primaryId && st.array) drawn.set(primaryId, arrayLabel(st));
    const views: { title: string; view: StructureView | null }[] = multi ? st.layers : [{ title: primaryTitle, view: st.structure }];
    for (const { title, view } of views) {
      if (!view) continue;
      if (view.name) {
        const hit = rootsOf(trace.steps[k]).find(([nm, v]) => nm === view.name && v.t === "ref");
        if (hit) drawn.set(hit[1].id as string, title);
      } else if (view.kind === "tree" || view.kind === "list") for (const n of view.nodes) if (heaps[k][n.id]) drawn.set(n.id, title);
    }
    st.scope = build(trace.steps[k], heaps[k], drawn);
    /* A return is worth saying unless the line already says something more specific. */
    if (st.kind === "return" && st.note.startsWith("Line ") && st.scope.event) st.note = st.scope.event.text;
  });

  /* Structure captions are more specific than line notes when nothing else happened. */
  /* Stacks, queues, and maps narrate their own operations, so their caption always wins. */
  const seqView = detector?.kind === "stack" || detector?.kind === "queue" || detector?.kind === "map";
  for (const st of steps) if (st.structure && (seqView || st.note.startsWith("Line "))) st.note = st.structure.caption;
  for (const st of steps) {
    const badge = [st.structure, ...st.layers.map((l) => l.view)].find((v) => v?.badge)?.badge;
    if (badge && (st.note.startsWith("Line ") || /^\d+ (element|entr|item|node)/.test(st.note) || / is empty$/.test(st.note) || /: \d+ elements?$/.test(st.note))) st.note = badge;
  }

  /* Calls narrate themselves when nothing more specific happened on that step. */
  for (const st of steps) if (st.note.startsWith("Line ") && st.scope?.event) st.note = st.scope.event.text;

  return {
    steps,
    array: primaryId && primaryName ? { name: primaryName, length: maxLength, id: primaryId } : null,
    structure: detector?.kind ?? null,
    title: primaryTitle,
    layers: steps[0]?.layers.map((l) => ({ key: l.key, title: l.title })) ?? [],
  };
}

/** Locals of every frame (innermost first) and then static fields, as [name, value] pairs. */
function rootsOf(step: RawStep): [string, Val][] {
  const out: [string, Val][] = [];
  for (const f of step.stack) for (const [n, v] of Object.entries(f.locals)) out.push([n, v]);
  for (const [n, v] of Object.entries(step.statics ?? {})) out.push([n.slice(n.lastIndexOf(".") + 1), v]);
  return out;
}

/**
 * The variable that owns a structure found by its class rather than by a name: one that points at
 * a node (root, head), or an object with a field that does (a list holding head, or the stack
 * object itself). Statics and outer frames come first, so the label names the owner, not a cursor.
 */
function ownerLabel(trace: RawTrace, heaps: Record<string, HeapObj>[], detector: Detector, fallback: string): string {
  const cls = detector.cls;
  if (!cls) return fallback;
  const isNode = (v: Val, heap: Record<string, HeapObj>) => v.t === "ref" && heap[v.id as string]?.t === "object" && (heap[v.id as string] as { cls: string }).cls === cls;
  const holds = (v: Val, heap: Record<string, HeapObj>) => {
    const o = v.t === "ref" ? heap[v.id as string] : undefined;
    return o?.t === "object" && Object.values(o.fields).some((x) => isNode(x, heap));
  };
  /* Stack and queue classes are the structure themselves; trees and lists are reached through a node. */
  const direct = detector.kind === "stack" || detector.kind === "queue";
  /* Rank 0 is a static field, 1 the outermost frame, and so on inward; the lowest rank seen wins. */
  const best = { rank: 99, label: fallback };
  for (let k = 0; k < Math.min(trace.steps.length, 600) && best.rank > 1; k++) {
    const heap = heaps[k];
    const step = trace.steps[k];
    const consider = (rank: number, name: string, v: Val, declared: string | undefined) => {
      if (best.rank <= rank) return;
      if (!(isNode(v, heap) || (!direct && holds(v, heap)))) return;
      best.rank = rank;
      best.label = `${identifier(name, describeType(declared, heap[v.id as string]).type)} (${fallback})`;
    };
    for (const [q, v] of Object.entries(step.statics ?? {})) {
      const owner = q.slice(0, q.lastIndexOf(".")), field = q.slice(q.lastIndexOf(".") + 1);
      consider(0, field, v, trace.classes?.[owner]?.statics[field]);
    }
    step.stack.forEach((f) => {
      const rank = 1 + (f.depth ?? 0);
      for (const [n, v] of Object.entries(f.locals)) if (n !== "this" && n !== "args") consider(rank, n, v, f.types?.[n]);
    });
  }
  return best.label;
}
