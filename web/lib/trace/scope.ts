/**
 * Variables, call frames, and static fields at each recorded step. Everything comes from the
 * recording: frame ids separate two calls of the same method, so a recursive call's n never
 * merges with its caller's n; declared types come from the class files; return values are the
 * values the JVM actually returned. Change flags compare a step only with the step before it, so
 * stepping backward shows exactly what the program held at that moment.
 */
import type { HeapObj, RawFrame, RawStep, RawTrace, Val } from "./interpret";
import { describeType, formatType, simpleName } from "./types";

export type ChangeKind = "value" | "contents" | null;

export type VarView = {
  /** Unique per scope: frame key plus name, or the static field's qualified name. */
  key: string;
  name: string;
  /** Compact value, e.g. 42, "Kyu", 'A', [10, 20, 30], {a=1}. */
  value: string;
  type: string | null;
  /** The object's class when it differs from the declared type (List<Integer> holding an ArrayList). */
  runtime: string | null;
  changed: ChangeKind;
  previous: string | null;
  /** Declared (came into scope) at this step. */
  fresh: boolean;
  isArg: boolean;
  /** Something about this value the recording could not capture. */
  note: string | null;
  refId: string | null;
  /** The value can be opened to see more than the compact form shows. */
  expandable: boolean;
  /** The label of the scene structure this reference is drawn as, if any. */
  drawnAs: string | null;
  raw: Val;
};

export type FrameView = {
  key: string;
  method: string;
  /** How the method reads in code: factorial, new Node, lambda in main. */
  title: string;
  cls: string;
  /** Call depth: 0 is the outermost frame the recording holds (usually main). */
  depth: number;
  line: number;
  /** The call with its parameters' current values: factorial(n = 3). */
  signature: string;
  args: VarView[];
  locals: VarView[];
  self: VarView | null;
  active: boolean;
  /** The frame first appeared at this step: a call. */
  isNew: boolean;
  /** Called by a frame of the same method. */
  recursive: boolean;
  /** The frame is returning at this step, with the real value. */
  returning: { value: string; isVoid: boolean; type: string | null } | null;
  /** A call this frame made just returned into it. */
  received: { from: string; value: string } | null;
};

export type StaticGroup = { owner: string; vars: VarView[] };

export type ScopeEvent = { kind: "call" | "recursive-call" | "return" | "exception"; text: string };

export type ScopeView = {
  frames: FrameView[];
  /** Every frame the program had at this step, including any the recorder did not send. */
  depth: number;
  /** Outer frames beyond the recorder's frame limit; their variables were not recorded. */
  hidden: number;
  statics: StaticGroup[];
  event: ScopeEvent | null;
  heap: Record<string, HeapObj>;
};

export type ClassInfo = { fields: Record<string, string>; statics: Record<string, string>; super?: string };

/* ---------------- Normalizing the recording ---------------- */

/**
 * Fills in what the recorder sends only once: a frame's parameter names and declared types are
 * sent on its first step and when they change, so they are carried forward per frame here.
 * Older recordings without frame ids get a key from depth and method, which keeps recursion
 * levels apart but cannot tell two calls at the same depth apart.
 */
export function normalizeTrace(trace: RawTrace): RawTrace {
  const types = new Map<string, Record<string, string>>();
  const args = new Map<string, string[]>();
  const steps = trace.steps.map((s): RawStep => {
    const total = s.stackDepth ?? s.stack.length;
    const stack = s.stack.map((f, i): RawFrame => {
      const depth = f.depth ?? total - 1 - i;
      const key = f.id !== undefined ? String(f.id) : `${depth}:${f.cls}.${f.method}`;
      if (f.types) types.set(key, f.types);
      if (f.args) args.set(key, f.args);
      return { ...f, key, depth, types: types.get(key) ?? {}, args: args.get(key) ?? [] };
    });
    return { ...s, stack, stackDepth: total };
  });
  return { ...trace, steps };
}

/* ---------------- Values ---------------- */

const SHORT = 40;
const FLOATS = new Set(["float", "double", "Float", "Double"]);
const INTEGERS = new Set(["long", "Long"]);

const quote = (s: string) => JSON.stringify(s);
const charText = (c: string) => `'${c === "\n" ? "\\n" : c === "\t" ? "\\t" : c === "'" ? "\\'" : c === "\\" ? "\\\\" : c}'`;

function primitive(v: Val): string {
  if (v.t === "String") return quote(String(v.v));
  if (v.t === "char" || v.t === "Character") return charText(String(v.v));
  if (FLOATS.has(v.t)) {
    if (v.v === null || v.v === undefined) return "NaN or ∞";
    const x = v.v as number;
    return Number.isInteger(x) && Math.abs(x) < 1e7 ? x.toFixed(1) : String(x);
  }
  return String(v.v);
}

/** What the recording could not capture about a value, said plainly. */
function noteFor(v: Val, heap: Record<string, HeapObj>): string | null {
  if (FLOATS.has(v.t) && (v.v === null || v.v === undefined)) return "The recorder stores NaN and infinities as non-finite, without telling them apart.";
  if (INTEGERS.has(v.t) && typeof v.v === "number" && !Number.isSafeInteger(v.v)) return "This long is larger than the browser can show exactly, so the last digits may differ.";
  if (v.t === "ref") {
    const o = heap[v.id as string];
    if (!o) return "Not captured: the recording stops following objects after a size limit.";
    if (o.t === "opaque") return `The recorder does not read inside ${simpleName(o.cls)} objects.`;
  }
  return null;
}

function itemsOf(o: HeapObj): Val[] | null {
  if (o.t === "array" || o.t === "list" || o.t === "stack" || o.t === "deque" || o.t === "heap" || o.t === "set") return o.items;
  return null;
}

/** A compact, Java-flavored rendering. depth limits how far nested references are spelled out. */
export function summarize(v: Val, heap: Record<string, HeapObj>, depth = 0): string {
  if (v.t === "null") return "null";
  if (v.t === "void") return "void";
  if (v.t !== "ref") return primitive(v);
  const o = heap[v.id as string];
  if (!o) return "…";
  if (o.t === "opaque") return simpleName(o.cls);
  if (o.t === "object") {
    const name = simpleName(o.cls);
    if (depth > 0) return name;
    const fields = Object.entries(o.fields).slice(0, 3).map(([k, f]) => `${k}=${summarize(f, heap, depth + 1)}`);
    return `${name}{${fields.join(", ")}${Object.keys(o.fields).length > 3 ? ", …" : ""}}`;
  }
  if (o.t === "map") {
    if (depth > 1) return `{${o.entries.length} entries}`;
    const shown = o.entries.slice(0, 6).map(([k, x]) => `${summarize(k, heap, depth + 1)}=${summarize(x, heap, depth + 1)}`);
    return `{${shown.join(", ")}${o.entries.length > 6 ? ", …" : ""}}`;
  }
  const items = itemsOf(o) ?? [];
  const len = o.t === "array" ? o.len : items.length;
  if (depth > 1) return o.t === "array" ? `${formatType(o.of)}[${len}]` : `[${len} items]`;
  const [open, close] = o.t === "set" ? ["{", "}"] : ["[", "]"];
  const shown = items.slice(0, 8).map((x) => summarize(x, heap, depth + 1));
  return `${open}${shown.join(", ")}${len > shown.length ? `, … ${len} total` : ""}${close}`;
}

export type InspectNode = { label: string; value: string; children?: InspectNode[]; note?: string };

/** The full value, one level per click: indices, fields, entries, or a string's whole text. */
export function inspect(v: Val, heap: Record<string, HeapObj>, depth = 0, seen: Set<string> = new Set()): InspectNode[] {
  if (v.t === "String") {
    const text = String(v.v);
    return [{ label: "length", value: text.endsWith("…") ? `${text.length - 1}+ (recorded up to 300 characters)` : String(text.length) }, { label: "text", value: quote(text) }];
  }
  if (v.t !== "ref") return [];
  const id = v.id as string;
  const o = heap[id];
  if (!o) return [{ label: "", value: "Not captured", note: noteFor(v, heap) ?? undefined }];
  if (seen.has(id)) return [{ label: "", value: "Already shown above (the structure refers back to itself)" }];
  const nextSeen = new Set(seen).add(id);
  const child = (label: string, x: Val): InspectNode => ({
    label,
    value: summarize(x, heap, 1),
    children: depth < 3 && x.t === "ref" && heap[x.id as string] && heap[x.id as string].t !== "opaque" ? inspect(x, heap, depth + 1, nextSeen) : undefined,
    note: noteFor(x, heap) ?? undefined,
  });
  const LIMIT = 64;
  if (o.t === "opaque") return [{ label: "", value: simpleName(o.cls), note: noteFor(v, heap) ?? undefined }];
  if (o.t === "object") return Object.entries(o.fields).map(([k, x]) => child(k, x));
  if (o.t === "map") {
    const out = o.entries.slice(0, LIMIT).map(([k, x]) => child(summarize(k, heap, 1), x));
    if (o.entries.length > LIMIT) out.push({ label: "", value: `${o.entries.length - LIMIT} more entries` });
    return out;
  }
  const items = itemsOf(o) ?? [];
  const out = items.slice(0, LIMIT).map((x, i) => child(o.t === "set" ? "•" : `[${i}]`, x));
  const len = o.t === "array" ? o.len : items.length;
  if (len > Math.min(items.length, LIMIT)) out.push({ label: "", value: `${len - Math.min(items.length, LIMIT)} more ${o.t === "array" && len > items.length ? "(the recorder keeps the first 256)" : ""}`.trim() });
  return out;
}

/* ---------------- Frames ---------------- */

/** A method's name as it reads in source. */
export function frameTitle(method: string, cls: string): string {
  if (method === "<init>") return `new ${simpleName(cls)}`;
  if (method === "<clinit>") return `${simpleName(cls)} static setup`;
  const lambda = /^lambda\$(.+)\$\d+$/.exec(method);
  if (lambda) return `lambda in ${lambda[1]}`;
  return method;
}

type BuildOptions = { classes?: Record<string, ClassInfo> };

type Memory = {
  values: Map<string, { value: string; ref: string | null }>;
  order: Map<string, string[]>;
  prev: RawStep | null;
  prevFrames: Map<string, FrameView>;
};

export function createScopeBuilder(opts: BuildOptions = {}) {
  const memory: Memory = { values: new Map(), order: new Map(), prev: null, prevFrames: new Map() };
  const staticType = (qualified: string) => {
    const cut = qualified.lastIndexOf(".");
    let cls: string | undefined = qualified.slice(0, cut);
    const field = qualified.slice(cut + 1);
    /* A static declared in a superclass is reported under the class that declares it. */
    for (let hops = 0; cls && hops < 8; hops++) {
      const info: ClassInfo | undefined = opts.classes?.[cls];
      if (info?.statics[field]) return info.statics[field];
      cls = info?.super;
    }
    return null;
  };

  /** Call once per step, in order. drawn maps heap ids shown in the scene to their labels. */
  return function build(step: RawStep, heap: Record<string, HeapObj>, drawn?: Map<string, string>): ScopeView {
    const prev = memory.prev;
    const nextValues = new Map<string, { value: string; ref: string | null }>();

    const view = (key: string, name: string, v: Val, declared: string | null, isArg: boolean): VarView => {
      const value = summarize(v, heap);
      const ref = v.t === "ref" ? (v.id as string) : null;
      const before = memory.values.get(key);
      nextValues.set(key, { value, ref });
      const obj = ref ? heap[ref] : undefined;
      const { type, runtime } = describeType(declared, obj);
      const changed: ChangeKind = !before || before.value === value ? null : ref && before.ref === ref ? "contents" : "value";
      const fullLength = v.t === "String" ? String(v.v).length + 2 : value.length;
      return {
        key, name, value: value.length > SHORT ? value.slice(0, SHORT - 1) + "…" : value, type: type ?? (v.t !== "ref" && v.t !== "null" ? v.t : null), runtime,
        changed, previous: changed ? before!.value : null, fresh: !before && !!prev, isArg, note: noteFor(v, heap), refId: ref,
        expandable: fullLength > SHORT || (!!obj && obj.t !== "opaque") || (v.t === "String" && fullLength > 12),
        drawnAs: ref ? drawn?.get(ref) ?? null : null,
        raw: v,
      };
    };

    const frames: FrameView[] = step.stack.map((f, i) => {
      const key = f.key ?? `${i}`;
      const types = f.types ?? {};
      const argNames = f.args ?? [];
      const names = Object.keys(f.locals).filter((n) => n !== "this");
      const known = memory.order.get(key) ?? [];
      const order = [...known.filter((n) => names.includes(n)), ...names.filter((n) => !known.includes(n))];
      memory.order.set(key, [...known, ...names.filter((n) => !known.includes(n))]);
      const args = argNames.filter((n) => n in f.locals).map((n) => view(`${key}:${n}`, n, f.locals[n], types[n] ?? null, true));
      const locals = order.filter((n) => !argNames.includes(n)).map((n) => view(`${key}:${n}`, n, f.locals[n], types[n] ?? null, false));
      const self = f.locals.this ? view(`${key}:this`, "this", f.locals.this, types.this ?? f.cls, false) : null;
      const title = frameTitle(f.method, f.cls);
      const caller = step.stack[i + 1];
      return {
        key, method: f.method, title, cls: f.cls, depth: f.depth ?? step.stack.length - 1 - i, line: f.line,
        signature: `${title}(${args.map((a) => `${a.name} = ${a.value}`).join(", ")})`,
        args, locals, self,
        active: i === 0,
        isNew: !!prev && !prev.stack.some((p) => p.key === key),
        recursive: !!caller && caller.method === f.method && caller.cls === f.cls,
        returning: i === 0 && step.kind === "return" && step.ret
          ? { value: summarize(step.ret, heap), isVoid: step.ret.t === "void", type: formatType(step.retType) }
          : null,
        received: null,
      };
    });

    /* A frame that returned on the previous step is gone now: its value lands in the caller. */
    if (prev?.kind === "return" && prev.ret && prev.ret.t !== "void") {
      const gone = prev.stack[0];
      const was = gone?.key ? memory.prevFrames.get(gone.key) : undefined;
      const callerKey = prev.stack[1]?.key;
      const caller = frames.find((fr) => fr.key === callerKey);
      if (gone && !frames.some((fr) => fr.key === gone.key) && caller && was) caller.received = { from: was.signature, value: summarize(prev.ret, heap) };
    }

    const groups = new Map<string, VarView[]>();
    for (const [qualified, v] of Object.entries(step.statics ?? {})) {
      const cut = qualified.lastIndexOf(".");
      const owner = qualified.slice(0, cut);
      const list = groups.get(owner) ?? [];
      list.push(view(`static:${qualified}`, qualified.slice(cut + 1), v, staticType(qualified), false));
      groups.set(owner, list);
    }
    const statics = [...groups.entries()].map(([owner, vars]) => ({ owner: simpleName(owner), vars }));

    const top = frames[0];
    let event: ScopeEvent | null = null;
    if (step.kind === "exception") event = { kind: "exception", text: "The program stopped with an exception here" };
    else if (top?.returning) event = { kind: "return", text: top.returning.isVoid ? `${top.title}() finishes and its frame leaves the stack` : `${top.signature} returns ${top.returning.value}` };
    else if (top?.isNew) event = { kind: top.recursive ? "recursive-call" : "call", text: `${top.recursive ? "Recursive call" : "Call"}: ${top.signature}` };

    memory.values = nextValues;
    memory.prev = step;
    memory.prevFrames = new Map(frames.map((fr) => [fr.key, fr]));
    const depth = step.stackDepth ?? frames.length;
    return { frames, depth, hidden: Math.max(0, depth - frames.length), statics, event, heap };
  };
}
