/**
 * The class hierarchy javac resolved while compiling, and what the recorded run did with it.
 * Relationships and override facts come from the compiler (never from file or class names);
 * which implementation ran, on which object, comes from the recorded frames.
 */
import type { HeapObj, RawStep, RawTrace } from "./interpret";
import { simpleName } from "./types";

export type MethodModel = {
  name: string;
  descriptor: string;
  params: string[];
  returns: string;
  modifiers: string[];
  implicit: boolean;
  line: number | null;
  /** "binary.Name#method" of the nearest supertype method this one overrides. */
  overrides: string | null;
};
export type FieldModel = { name: string; type: string; modifiers: string[]; line: number | null };
export type ClassModel = {
  name: string;
  simpleName: string;
  kind: "class" | "interface" | "enum" | "record";
  abstract: boolean;
  file: string | null;
  line: number | null;
  superclass: string | null;
  interfaces: string[];
  methods: MethodModel[];
  fields: FieldModel[];
};

export type MemberRef = { owner: string; method: MethodModel };
export type ClassView = {
  model: ClassModel;
  /** Shown name: simple, or package-qualified when two classes share a simple name. */
  label: string;
  /** User superclasses, nearest first. */
  ancestors: string[];
  /** A superclass outside the project (Exception, Thread), shown but not expanded. */
  externalParent: string | null;
  constructors: MethodModel[];
  declared: MethodModel[];
  inherited: MemberRef[];
  inheritedFields: { owner: string; field: FieldModel }[];
};

export type Hierarchy = { classes: Map<string, ClassView>; children: Map<string, string[]> };

const key = (m: MethodModel) => `${m.name}${m.descriptor.slice(0, m.descriptor.indexOf(")") + 1)}`;
const isPrivate = (mods: string[]) => mods.includes("private");

export function buildHierarchy(models: ClassModel[]): Hierarchy {
  const byName = new Map(models.map((m) => [m.name, m]));
  const counts = new Map<string, number>();
  for (const m of models) counts.set(m.simpleName, (counts.get(m.simpleName) ?? 0) + 1);
  const children = new Map<string, string[]>();
  const classes = new Map<string, ClassView>();
  for (const m of models) {
    for (const parent of [m.superclass, ...m.interfaces]) {
      if (parent && byName.has(parent)) children.set(parent, [...(children.get(parent) ?? []), m.name]);
    }
    const ancestors: string[] = [];
    const seen = new Set([m.name]);
    let cur = m.superclass;
    while (cur && byName.has(cur) && !seen.has(cur)) {
      ancestors.push(cur);
      seen.add(cur);
      cur = byName.get(cur)!.superclass;
    }
    const externalParent = cur && !byName.has(cur) && cur !== "java.lang.Object" && !/^java\.lang\.(Enum|Record)$/.test(cur) ? cur : null;
    /* Inherited: the nearest ancestor's version of each method this class does not declare itself. */
    const have = new Set(m.methods.filter((x) => x.name !== "<init>").map(key));
    const inherited: MemberRef[] = [];
    for (const a of ancestors) {
      for (const am of byName.get(a)!.methods) {
        if (am.name === "<init>" || isPrivate(am.modifiers) || am.modifiers.includes("static") || have.has(key(am))) continue;
        have.add(key(am));
        inherited.push({ owner: a, method: am });
      }
    }
    classes.set(m.name, {
      model: m,
      label: (counts.get(m.simpleName) ?? 0) > 1 ? m.name : m.simpleName.includes("$") ? simpleName(m.name) : m.simpleName,
      ancestors,
      externalParent,
      constructors: m.methods.filter((x) => x.name === "<init>"),
      declared: m.methods.filter((x) => x.name !== "<init>"),
      inherited,
      inheritedFields: ancestors.flatMap((a) => byName.get(a)!.fields.filter((f) => !f.modifiers.includes("static")).map((field) => ({ owner: a, field }))),
    });
  }
  return { classes, children };
}

/* ---------------- Layout ---------------- */

export type Placed = { name: string; x: number; y: number; w: number; h: number };
export type Edge = { from: string; to: string; kind: "extends" | "implements" };

export const NODE_W = 220;
const GAP_X = 36;
const GAP_Y = 72;

/** Height of a node card: header, file line, and up to six member rows. */
export function nodeHeight(c: ClassView, open: boolean): number {
  const rows = open ? Math.min(c.declared.length, 6) + (c.declared.length > 6 ? 1 : 0) + (c.inherited.length ? 1 : 0) : 0;
  return 64 + rows * 19 + (open && rows ? 8 : 0);
}

/**
 * Parents above children. Each class sits one row below its deepest parent; within a row,
 * classes follow their parents' order so connectors cross as little as a simple pass allows.
 */
export function layout(h: Hierarchy, open: (name: string) => boolean): { nodes: Placed[]; edges: Edge[]; width: number; height: number } {
  const depth = new Map<string, number>();
  const visit = (n: string, trail: Set<string>): number => {
    if (depth.has(n)) return depth.get(n)!;
    const c = h.classes.get(n)!.model;
    const parents = [c.superclass, ...c.interfaces].filter((p): p is string => !!p && h.classes.has(p) && !trail.has(p));
    const d = parents.length ? Math.max(...parents.map((p) => visit(p, new Set(trail).add(n)))) + 1 : 0;
    depth.set(n, d);
    return d;
  };
  for (const n of h.classes.keys()) visit(n, new Set());
  const rows: string[][] = [];
  for (const [n, d] of depth) (rows[d] ??= []).push(n);
  const order = new Map<string, number>();
  rows.forEach((row, d) => {
    if (d === 0) row.sort((a, b) => h.classes.get(a)!.label.localeCompare(h.classes.get(b)!.label));
    else {
      const bary = (n: string) => {
        const c = h.classes.get(n)!.model;
        const ps = [c.superclass, ...c.interfaces].filter((p): p is string => !!p && order.has(p));
        return ps.length ? ps.reduce((s, p) => s + order.get(p)!, 0) / ps.length : 0;
      };
      row.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    }
    row.forEach((n, i) => order.set(n, i));
  });
  const width = Math.max(...rows.map((r) => r.length)) * (NODE_W + GAP_X) - GAP_X;
  const nodes: Placed[] = [];
  let y = 0;
  for (const row of rows) {
    const heights = row.map((n) => nodeHeight(h.classes.get(n)!, open(n)));
    const rowW = row.length * (NODE_W + GAP_X) - GAP_X;
    row.forEach((n, i) => nodes.push({ name: n, x: (width - rowW) / 2 + i * (NODE_W + GAP_X), y, w: NODE_W, h: heights[i] }));
    y += Math.max(...heights) + GAP_Y;
  }
  const edges: Edge[] = [];
  for (const [n, c] of h.classes) {
    if (c.model.superclass && h.classes.has(c.model.superclass)) edges.push({ from: n, to: c.model.superclass, kind: "extends" });
    for (const i of c.model.interfaces) if (h.classes.has(i)) edges.push({ from: n, to: i, kind: c.model.kind === "interface" ? "extends" : "implements" });
  }
  return { nodes, edges, width: Math.max(width, NODE_W), height: Math.max(0, y - GAP_Y) };
}

/* ---------------- Runtime ---------------- */

export type Dispatch = {
  /** The class whose code is running, and the method. */
  implementer: string;
  method: MethodModel | null;
  methodName: string;
  /** The object's own class, from the heap; null for static code. */
  runtime: string | null;
  /** Caller variables holding the same object, with their declared types: pet : Animal. */
  holders: { name: string; type: string | null }[];
  kind: "constructor" | "super-constructor" | "super-call" | "inherited" | "override" | "own" | "static";
  /** The superclass method an override replaces, when javac says it overrides one. */
  replaces: string | null;
};

export function memberOf(h: Hierarchy, cls: string, name: string, sig: string | undefined): MethodModel | null {
  const c = h.classes.get(cls);
  if (!c) return null;
  const all = name === "<init>" ? c.constructors : c.declared;
  return all.find((m) => m.name === name && (!sig || m.descriptor === sig)) ?? (all.filter((m) => m.name === name).length === 1 ? all.find((m) => m.name === name)! : null);
}

/** What the running frame at this step means in terms of inheritance. */
export function dispatchAt(h: Hierarchy, step: RawStep, heap: Record<string, HeapObj>): Dispatch | null {
  const top = step.stack[0];
  if (!top || !h.classes.has(top.cls)) return null;
  const method = memberOf(h, top.cls, top.method, top.sig);
  /* Java's this, or Python's self (the first parameter of a method). */
  const receiver = (f: RawStep["stack"][number] | undefined) => f && (f.locals.this ?? (f.args?.[0] === "self" ? f.locals.self : undefined));
  const self = receiver(top);
  const obj = self?.t === "ref" ? heap[self.id as string] : undefined;
  const runtime = obj && "cls" in obj ? (obj as { cls: string }).cls : null;
  const caller = step.stack[1];
  const holders: Dispatch["holders"] = [];
  if (caller && self?.t === "ref") {
    for (const [n, v] of Object.entries(caller.locals)) {
      if (n !== "this" && v.t === "ref" && v.id === self.id && !(n === "self" && caller.args?.[0] === "self")) holders.push({ name: n, type: caller.types?.[n] ?? null });
    }
  }
  const callerSelf = receiver(caller);
  const sameObject = !!caller && callerSelf?.t === "ref" && callerSelf.id === self?.id;
  const callerIsSub = !!caller && (h.classes.get(caller.cls)?.ancestors.includes(top.cls) ?? false);
  let kind: Dispatch["kind"];
  if (!self) kind = "static";
  else if (top.method === "<init>") kind = sameObject && callerIsSub && caller.method === "<init>" ? "super-constructor" : "constructor";
  else if (sameObject && callerIsSub && caller.method === top.method) kind = "super-call";
  else if (runtime && runtime !== top.cls) kind = "inherited";
  else kind = method?.overrides ? "override" : "own";
  return { implementer: top.cls, method, methodName: top.method, runtime, holders, kind, replaces: method?.overrides ?? null };
}

/** Which implementations had run by each step: "Called" means the recorder saw that frame. */
export function firstCalls(trace: RawTrace): Map<string, number> {
  const first = new Map<string, number>();
  trace.steps.forEach((s, k) => {
    for (const f of s.stack) {
      const id = `${f.cls}#${f.method}${f.sig ?? ""}`;
      if (!first.has(id)) first.set(id, k);
    }
  });
  return first;
}
export const callKey = (owner: string, m: MethodModel) => `${owner}#${m.name}${m.descriptor}`;
