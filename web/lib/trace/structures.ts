/**
 * Recognizes linked structures in a recorded execution: binary trees, linked lists,
 * adjacency-list graphs, and maps. Like the array interpreter, it only reads recorded facts,
 * so what it draws is what the program actually built.
 */
import type { HeapObj, RawStep, Val } from "./interpret";
import type { ClassInfo } from "./scope";
import { describeType, identifier } from "./types";

export type NodeState = "idle" | "current" | "visited" | "queued" | "special" | "dim";
export type EdgeState = "idle" | "trail" | "active" | "special";
export type StructNode = { id: string; label: string; sub?: string; state: NodeState; tint?: string; pos?: [number, number] };
export type StructEdge = { from: string; to: string; label?: string; state: EdgeState };
export type StructureView = {
  kind: "tree" | "list" | "graph" | "map" | "grid" | "points" | "stack" | "queue" | "set" | "array";
  /** The variable this structure lives in, so loops over it can be matched to it. */
  name?: string;
  /** A short line about a loop running over this structure, shown above it. */
  badge?: string;
  nodes: StructNode[];
  edges: StructEdge[];
  pointers: { name: string; nodeId: string }[];
  /** Layout hints: list order, or tree positions. */
  order?: string[];
  tree?: Record<string, { x: number; depth: number }>;
  /** rows and cols of a 2D array; lengths holds each row's own length, so jagged arrays stay jagged. */
  grid?: { rows: number; cols: number; lengths: number[] };
  /** Draw edges with arrowheads (edge lists and capacity matrices). */
  directed?: boolean;
  /** Slots in an array-backed stack or queue, so the tube or track can be sized to match. */
  capacity?: number;
  /** A short line drawn with the structure, such as a set's ordering rule. */
  note?: string;
  /** A map's keys in its real iteration order (what a for-each loop visits). */
  iter?: string[];
  /** Whether keys or elements carry real bucket indices from the hash table. */
  buckets?: boolean;
  /** Changes happen in one call per line (java.util collections), so there are no in-between states to smooth. */
  atomic?: boolean;
  caption: string;
};

type Ctx = { step: RawStep; heap: Record<string, HeapObj>; line?: string };
export type Detector = { kind: StructureView["kind"]; name?: string; /** The user class a detector follows (tree or list nodes, a stack class). */ cls?: string; view: (c: Ctx) => StructureView | null };

const isObj = (h: HeapObj | undefined, cls?: string): h is Extract<HeapObj, { t: "object" }> => !!h && h.t === "object" && (!cls || h.cls === cls);
const num = (v: Val | undefined) => (v && typeof v.v === "number" ? (v.v as number) : null);
const short = (cls: string) => cls.split(/[.$]/).pop() as string;

/** Every value the program can see this step: all frames' locals, plus user-class statics. */
function roots(step: RawStep): [string, Val, number][] {
  const out: [string, Val, number][] = [];
  step.stack.forEach((f, depth) => Object.entries(f.locals).forEach(([n, v]) => out.push([n, v, depth])));
  Object.entries(step.statics ?? {}).forEach(([n, v]) => out.push([n.split(".").pop() as string, v, 99]));
  return out;
}

function displayValue(v: Val | undefined, heap: Record<string, HeapObj>): string {
  if (!v || v.t === "null") return "null";
  if (v.t === "ref") {
    const o = heap[v.id as string];
    return o && o.t === "object" ? short(o.cls) : "…";
  }
  return String(v.v);
}

/** Fields of a user class that point to the same class: one means a list, two or more a tree. */
function selfFields(heap: Record<string, HeapObj>, cls: string): string[] {
  const names = new Set<string>();
  for (const o of Object.values(heap)) {
    if (!isObj(o, cls)) continue;
    for (const [name, v] of Object.entries(o.fields)) {
      if (v.t === "ref" && isObj(heap[v.id as string], cls)) names.add(name);
    }
  }
  return [...names];
}

function valueField(o: Extract<HeapObj, { t: "object" }>) {
  const prefer = ["value", "val", "data", "key", "item", "v"];
  const entries = Object.entries(o.fields).filter(([, v]) => v.t !== "ref" && v.t !== "null");
  return (entries.find(([n]) => prefer.includes(n)) ?? entries[0])?.[1];
}

/** Top-frame locals pointing at structure nodes become named pointers; deeper frames mark the path. */
function pointersFor(step: RawStep, ids: Set<string>) {
  const pointers: { name: string; nodeId: string }[] = [];
  const onStack = new Set<string>();
  step.stack.forEach((f, depth) => {
    for (const [name, v] of Object.entries(f.locals)) {
      if (v.t !== "ref" || !ids.has(v.id as string)) continue;
      if (depth === 0) pointers.push({ name, nodeId: v.id as string });
      else onStack.add(v.id as string);
    }
  });
  return { pointers: pointers.filter((p) => p.name !== "this").slice(0, 4), onStack };
}

/* ---------------- Trees ---------------- */

function treeDetector(cls: string, [leftName, rightName]: string[]): Detector {
  return {
    kind: "tree",
    cls,
    view: ({ step, heap }) => {
      /* The root is the node nobody points to that the program still holds. */
      const children = new Set<string>();
      for (const o of Object.values(heap)) {
        if (!isObj(o, cls)) continue;
        for (const f of [leftName, rightName]) if (o.fields[f]?.t === "ref") children.add(o.fields[f].id as string);
      }
      const held = roots(step).filter(([, v]) => v.t === "ref" && isObj(heap[v.id as string], cls)).map(([, v]) => v.id as string);
      const root = held.find((id) => !children.has(id)) ?? null;
      if (!root) return null;
      const tree: Record<string, { x: number; depth: number }> = {};
      const nodes: StructNode[] = [];
      const edges: StructEdge[] = [];
      let x = 0;
      const walk = (id: string, depth: number) => {
        const o = heap[id];
        if (!isObj(o, cls) || tree[id] || nodes.length > 200) return;
        const l = o.fields[leftName];
        const r = o.fields[rightName];
        if (l?.t === "ref") walk(l.id as string, depth + 1);
        tree[id] = { x: x++, depth };
        nodes.push({ id, label: displayValue(valueField(o), heap), state: "idle" });
        if (r?.t === "ref") walk(r.id as string, depth + 1);
        for (const c of [l, r]) if (c?.t === "ref") edges.push({ from: id, to: c.id as string, state: "idle" });
      };
      walk(root, 0);
      const ids = new Set(nodes.map((n) => n.id));
      const { pointers, onStack } = pointersFor(step, ids);
      const current = new Set(pointers.map((p) => p.nodeId));
      for (const n of nodes) n.state = current.has(n.id) ? "current" : onStack.has(n.id) ? "queued" : "idle";
      for (const e of edges) e.state = current.has(e.to) && (onStack.has(e.from) || current.has(e.from)) ? "active" : onStack.has(e.to) ? "trail" : "idle";
      const cur = nodes.find((n) => n.state === "current");
      return {
        kind: "tree", nodes, edges, pointers, tree,
        caption: cur ? `At node ${cur.label} in ${step.method}()` : `${nodes.length} nodes in the tree`,
      };
    },
  };
}

/* ---------------- Linked lists ---------------- */

function listDetector(cls: string, nextName: string): Detector {
  return {
    kind: "list",
    cls,
    view: ({ step, heap }) => {
      const pointedTo = new Set<string>();
      for (const o of Object.values(heap)) if (isObj(o, cls) && o.fields[nextName]?.t === "ref") pointedTo.add(o.fields[nextName].id as string);
      /* A head held directly, or through a holder object's field (e.g. list.head). */
      let head: string | null = null;
      for (const [, v] of roots(step)) {
        if (v.t !== "ref") continue;
        const o = heap[v.id as string];
        if (isObj(o, cls) && !pointedTo.has(v.id as string)) { head = v.id as string; break; }
        if (isObj(o) && o.cls !== cls) {
          const h = Object.values(o.fields).find((f) => f.t === "ref" && isObj(heap[f.id as string], cls) && !pointedTo.has(f.id as string));
          if (h) { head = h.id as string; break; }
        }
      }
      const order: string[] = [];
      for (let id = head; id && !order.includes(id) && order.length < 64; ) {
        order.push(id);
        const o = heap[id] as Extract<HeapObj, { t: "object" }>;
        const nx = o.fields[nextName];
        id = nx?.t === "ref" ? (nx.id as string) : null;
      }
      const linked = new Set(order);
      const nodes: StructNode[] = order.map((id) => ({ id, label: displayValue(valueField(heap[id] as Extract<HeapObj, { t: "object" }>), heap), state: "idle" }));
      const edges: StructEdge[] = order.slice(1).map((id, i) => ({ from: order[i], to: id, state: "idle" }));
      /* Nodes the program holds but has not linked in yet (e.g. a new node mid-insert). */
      for (const [, v] of roots(step)) {
        if (v.t === "ref" && isObj(heap[v.id as string], cls) && !order.includes(v.id as string)) {
          const o = heap[v.id as string] as Extract<HeapObj, { t: "object" }>;
          nodes.push({ id: v.id as string, label: displayValue(valueField(o), heap), state: "special" });
          order.push(v.id as string);
        }
      }
      const { pointers } = pointersFor(step, new Set(order));
      /* Only pointers walking the chain mark progress; earlier linked nodes count as visited. */
      const walking = new Set(pointers.map((p) => p.nodeId).filter((id) => linked.has(id)));
      const firstWalk = order.findIndex((id) => walking.has(id));
      nodes.forEach((n, i) => {
        if (!linked.has(n.id)) return;
        n.state = walking.has(n.id) ? "current" : firstWalk > 0 && i < firstWalk ? "visited" : "idle";
      });
      const current = walking;
      for (const e of edges) e.state = current.has(e.to) ? "active" : nodes.find((n) => n.id === e.to)?.state === "visited" ? "trail" : "idle";
      return {
        kind: "list", nodes, edges, pointers, order,
        caption: nodes.length === 0 ? "The list is empty" : `${nodes.filter((n) => n.state !== "special").length} nodes, linked through ${nextName}`,
      };
    },
  };
}

/* ---------------- Sets ---------------- */

function setDetector(name: string): Detector {
  let last = new Set<string>();
  return {
    name,
    kind: "set",
    view: ({ step, heap, line }) => {
      const found = roots(step).find(([nm, v]) => nm === name && v.t === "ref" && heap[v.id as string]?.t === "set");
      if (!found) return null;
      const st = heap[found[1].id as string] as Extract<HeapObj, { items: Val[]; cls: string }>;
      const text = (v: Val) => (v.t === "ref" ? displayValue(v, heap) : String(v.v ?? "null"));
      const items = st.items.map(text);
      const now = new Set(items);
      const call = new RegExp(`\\b${name}\\s*\\.\\s*(add|contains|remove)\\s*\\(([^()]*)\\)`).exec(line ?? "");
      const op = call?.[1] ?? null;
      const key = call ? keyFromSource(call[2], step, heap) : null;
      const present = key !== null && now.has(key);
      const hasBuckets = st.buckets?.length === st.items.length;
      const nodes: StructNode[] = items.map((x, i) => ({
        id: `e:${x}`,
        label: x,
        sub: hasBuckets ? `bucket ${st.buckets![i]}` : undefined,
        state: key === x ? "current" : !last.has(x) && last.size ? "special" : "idle",
      }));
      const arg = call?.[2].trim() ?? "";
      let caption =
        op === "add" ? (present ? `add(${arg}): ${key} is already in the set, so nothing changes (add returns false)` : `add(${arg}) inserts ${key}`)
        : op === "contains" ? `contains(${arg}): ${present ? `yes, ${key} is in the set` : `no, ${key} isn't in the set`}`
        : op === "remove" ? (present ? `remove(${arg}) takes ${key} out` : `remove(${arg}): ${key} isn't there, so nothing changes`)
        : "";
      if (!caption) {
        const added = items.filter((x) => !last.has(x)), gone = [...last].filter((x) => !now.has(x));
        caption = last.size && added.length ? `${added[0]} was added` : last.size && gone.length ? `${gone[0]} was removed` : `${items.length} element${items.length === 1 ? "" : "s"} in ${name}`;
      }
      last = now;
      const note =
        st.cls === "java.util.TreeSet" ? "TreeSet: kept in sorted order"
        : st.cls === "java.util.LinkedHashSet" ? "LinkedHashSet: in insertion order"
        : "HashSet: real iteration order, not guaranteed";
      return { kind: "set", name, nodes, edges: [], pointers: [], order: nodes.map((n) => n.id), caption, note, buckets: hasBuckets };
    },
  };
}

/** java.util.LinkedList drawn as what it is: nodes joined by links, not array cells. */
function jdkListDetector(name: string): Detector {
  return {
    name,
    kind: "list",
    view: ({ step, heap }) => {
      const found = roots(step).find(([nm, v]) => nm === name && v.t === "ref" && heap[v.id as string]?.t === "list");
      if (!found) return null;
      const lst = heap[found[1].id as string] as Extract<HeapObj, { items: Val[]; cls: string }>;
      const ids = lst.items.map((_, i) => `n${i}`);
      const nodes: StructNode[] = lst.items.map((v, i) => ({ id: ids[i], label: v.t === "ref" ? displayValue(v, heap) : String(v.v ?? "null"), state: "idle" }));
      const edges: StructEdge[] = ids.slice(1).map((id, i) => ({ from: ids[i], to: id, state: "idle" }));
      return { kind: "list", name, nodes, edges, pointers: [], order: ids, caption: nodes.length ? `${nodes.length} node${nodes.length === 1 ? "" : "s"} in the LinkedList ${name}` : `${name} is an empty LinkedList` };
    },
  };
}

/* ---------------- Graphs ---------------- */

const VERTEX = /^(u|cur|current|node|vertex|from|src)$/;
const NEIGHBOR = /^(v|next|neighbor|nbr|w|to)$/;
/* Names that mean "adjacency or capacity matrix". Not "matrix": that is usually just a 2D array. */
const MATRIX_GRAPH = /^(cap|capacity|capacities|adj|adjacency|graph)$/;
/* Names that mean "a table of values", never an adjacency list, whatever its numbers look like. */
const TABLE_NAMES = /^(dp|table|tab|tri|triangle|pascal|memo|cache|grid|matrix|mat|board|rows|cells|scores|result|res|ans)$/i;
const FROM = ["from", "u", "src", "source"];
const TO = ["to", "v", "dst", "dest", "target"];
type Adj = { adj: { to: number; weight: number | null }[][]; directed: boolean; matrix: number[][] | null; edgeIds: Map<string, string> };

/** Every row of a 2D numeric array, with each row's real length (jagged arrays allowed). */
function rows2d(heap: Record<string, HeapObj>, v: Val | undefined): { id: string; rows: number[][] } | null {
  if (!v || v.t !== "ref") return null;
  const o = heap[v.id as string];
  /* Python: a list of lists of numbers (numpy 2-D arrays are recorded the same way). */
  if (o && o.t === "list" && o.cls === "list") {
    const rows: number[][] = [];
    for (const it of o.items) {
      const r = it.t === "ref" ? heap[it.id as string] : undefined;
      if (!r || r.t !== "list" || r.cls !== "list" || !r.items.every((x) => typeof x.v === "number")) return null;
      rows.push(r.items.map((x) => x.v as number));
    }
    return rows.length ? { id: v.id as string, rows } : null;
  }
  if (!o || o.t !== "array" || !/\[\]$/.test(o.of) || !/^(int|long|short|byte|double|float|char)\[\]$/.test(o.of)) return null;
  const rows: number[][] = [];
  for (const it of o.items) {
    if (it.t === "null") { rows.push([]); continue; }
    const r = it.t === "ref" ? heap[it.id as string] : undefined;
    if (!r || r.t !== "array") return null;
    rows.push(r.items.map((x) => (typeof x.v === "number" ? (x.v as number) : typeof x.v === "string" ? (x.v as string).charCodeAt(0) : 0)));
  }
  return { id: v.id as string, rows };
}

/** A 2D array of numbers, or null. */
function matrix(heap: Record<string, HeapObj>, v: Val | undefined): number[][] | null {
  if (!v || v.t !== "ref") return null;
  const o = heap[v.id as string];
  if (!o || o.t !== "array" || o.items.length === 0) return null;
  const rows: number[][] = [];
  for (const it of o.items) {
    const r = it.t === "ref" ? heap[it.id as string] : undefined;
    if (!r || r.t !== "array" || !/^(int|long|short|byte|double|float)$/.test(r.of)) return null;
    rows.push(r.items.map((x) => (typeof x.v === "number" ? (x.v as number) : 0)));
  }
  return rows.every((r) => r.length === rows[0].length && r.length > 0) ? rows : null;
}

function field(o: Extract<HeapObj, { t: "object" }>, names: string[]) {
  for (const n of names) {
    const x = num(o.fields[n]);
    if (x !== null) return x;
  }
  return null;
}

/** Adjacency lists, edge lists of objects with from/to fields, or a capacity matrix. */
function adjacency(heap: Record<string, HeapObj>, v: Val, name = ""): Adj | null {
  if (v.t !== "ref") return null;
  const outer = heap[v.id as string];
  if (!outer) return null;
  if (outer.t === "array" && MATRIX_GRAPH.test(name)) {
    const m = matrix(heap, v);
    if (!m || m.length !== m[0].length || m.length < 2) return null;
    const adj = m.map((row) => row.flatMap((c, to) => (c > 0 ? [{ to, weight: c }] : [])));
    return adj.some((r) => r.length) ? { adj, directed: true, matrix: m, edgeIds: new Map() } : null;
  }
  if (outer.t !== "list" || outer.items.length === 0) return null;
  if (TABLE_NAMES.test(name)) return null;
  const first = outer.items[0].t === "ref" ? heap[outer.items[0].id as string] : undefined;
  if (first && first.t === "object") {
    /* An edge list: every item is an object with from and to fields. */
    const edges: { from: number; to: number; weight: number | null; id: string }[] = [];
    for (const it of outer.items) {
      const o = it.t === "ref" ? heap[it.id as string] : undefined;
      if (!o || o.t !== "object") return null;
      const from = field(o, FROM), to = field(o, TO);
      if (from === null || to === null || from < 0 || to < 0) return null;
      edges.push({ from, to, weight: field(o, ["weight", "w", "cost"]), id: it.id as string });
    }
    const n = Math.max(...edges.map((e) => Math.max(e.from, e.to))) + 1;
    if (n > 200) return null;
    const adj: Adj["adj"] = Array.from({ length: n }, () => []);
    const edgeIds = new Map<string, string>();
    for (const e of edges) {
      adj[e.from].push({ to: e.to, weight: e.weight });
      edgeIds.set(e.id, `${e.from}>${e.to}`);
    }
    return { adj, directed: true, matrix: null, edgeIds };
  }
  const adj: Adj["adj"] = [];
  for (const item of outer.items) {
    const inner = item.t === "ref" ? heap[item.id as string] : undefined;
    if (!inner || inner.t !== "list") return null;
    const row: { to: number; weight: number | null }[] = [];
    for (const x of inner.items) {
      if (typeof x.v === "number") row.push({ to: x.v as number, weight: null });
      else if (x.t === "ref" && isObj(heap[x.id as string])) {
        const f = (heap[x.id as string] as Extract<HeapObj, { t: "object" }>).fields;
        const to = num(f.to ?? f.v ?? f.dest ?? f.target);
        if (to === null) return null;
        row.push({ to, weight: num(f.weight ?? f.w ?? f.cost) });
      } else return null;
    }
    adj.push(row);
  }
  if (!adj.every((r) => r.every((e) => e.to >= 0 && e.to < adj.length))) return null;
  /* Plain numbers that list their own row, or the same neighbor twice, are a table (like [[0], [0, 0]]
     or Pascal's [1, 1]), not neighbors. */
  const plain = adj.every((r) => r.every((e) => e.weight === null));
  if (plain && adj.some((r, i) => r.some((e) => e.to === i) || new Set(r.map((e) => e.to)).size !== r.length)) return null;
  return { adj, directed: false, matrix: null, edgeIds: new Map() };
}

function graphDetector(name: string): Detector {
  return {
    name,
    kind: "graph",
    view: ({ step, heap }) => {
      let found: Adj | null = null;
      for (const [nm, v] of roots(step)) if (nm === name && (found = adjacency(heap, v, nm))) break;
      if (!found) return null;
      const { directed, matrix: capm, edgeIds } = found;
      const arrayNamed = (re: RegExp) => {
        for (const [nm, v] of roots(step)) {
          if (!re.test(nm) || v.t !== "ref") continue;
          const o = heap[v.id as string];
          if (o?.t === "array" && o.len >= found!.adj.length) return o.items;
        }
        return null;
      };
      const flowm = (() => {
        for (const [nm, v] of roots(step)) if (/^(flow|flows)$/.test(nm)) { const m = matrix(heap, v); if (m) return m; }
        return null;
      })();
      const n = Math.max(found.adj.length, arrayNamed(/^(dist|distance|distances|d)$/)?.length ?? 0);
      const adj = Array.from({ length: n }, (_, i) => found!.adj[i] ?? []);
      const visited = arrayNamed(/^(visited|seen|done|settled)$/);
      const dist = arrayNamed(/^(dist|distance|distances|d)$/);
      const prev = arrayNamed(/^(prev|parent|pred|previous)$/);
      const height = arrayNamed(/^(height|heights|h|label)$/);
      const excess = arrayNamed(/^(excess|overflow)$/);
      const queued = new Set<number>();
      for (const [nm, v] of roots(step)) {
        if (!/^(queue|q|stack|frontier|pq|toVisit|active)$/.test(nm) || v.t !== "ref") continue;
        const o = heap[v.id as string];
        if (o && (o.t === "deque" || o.t === "list" || o.t === "stack" || o.t === "heap")) {
          for (const it of o.items) {
            if (typeof it.v === "number") queued.add(it.v as number);
            else if (it.t === "ref" && heap[it.id as string]?.t === "array") {
              const vtx = num((heap[it.id as string] as Extract<HeapObj, { t: "array" }>).items[1]);
              if (vtx !== null) queued.add(vtx);
            }
          }
        }
      }
      const ints: Record<string, number> = {};
      for (const [nm, v] of Object.entries(step.stack[0]?.locals ?? {})) if ((v.t === "int" || v.t === "Integer") && typeof v.v === "number") ints[nm] = v.v as number;
      let cur = Object.entries(ints).find(([nm, x]) => VERTEX.test(nm) && x >= 0 && x < n)?.[1] ?? null;
      let nb = Object.entries(ints).find(([nm, x]) => NEIGHBOR.test(nm) && x >= 0 && x < n)?.[1] ?? null;
      /* Edge-list loops: the edge object in hand is the active edge. */
      let activeKey: string | null = null;
      for (const v of Object.values(step.stack[0]?.locals ?? {})) {
        if (v.t === "ref" && edgeIds.has(v.id as string)) {
          activeKey = edgeIds.get(v.id as string)!;
          const [a, b] = activeKey.split(">").map(Number);
          cur = a;
          nb = b;
        }
      }
      const path = step.stack.slice(1).map((f) => Object.entries(f.locals).find(([nm, v]) => VERTEX.test(nm) && typeof v.v === "number")?.[1].v as number | undefined).filter((x): x is number => x !== undefined);
      const nodes: StructNode[] = adj.map((_, i) => {
        const d = dist ? num(dist[i]) : null;
        const ex = excess ? num(excess[i]) : null;
        const state: NodeState =
          i === cur ? "current"
          : queued.has(i) || path.includes(i) || (ex !== null && ex > 0) ? "queued"
          : visited && visited[i]?.v === true ? "visited"
          : d !== null && d < 2147483647 ? "visited" : "idle";
        const sub = dist ? (d === null || d >= 2147483647 ? "∞" : `d=${d}`)
          : height && excess ? `h${num(height[i])} e${num(excess[i])}` : undefined;
        return { id: `v${i}`, label: String(i), sub, state };
      });
      const seenEdge = new Set<string>();
      const edges: StructEdge[] = [];
      adj.forEach((row, u) =>
        row.forEach(({ to, weight }) => {
          const key = directed ? `${u}>${to}` : u < to ? `${u}-${to}` : `${to}-${u}`;
          if (seenEdge.has(key)) return;
          seenEdge.add(key);
          const tree = prev && (num(prev[to]) === u || (!directed && num(prev[u]) === to));
          const active = activeKey ? activeKey === key : cur !== null && nb !== null && ((u === cur && to === nb) || (!directed && u === nb && to === cur));
          const f = flowm ? Math.max(flowm[u]?.[to] ?? 0, 0) : null;
          const label = capm && f !== null ? `${f}/${capm[u][to]}` : weight !== null ? String(weight) : undefined;
          const saturated = capm && f !== null && f > 0;
          edges.push({ from: `v${u}`, to: `v${to}`, label, state: active ? "active" : tree || saturated ? "special" : "idle" });
        }),
      );
      const pointers = [
        ...(cur !== null ? [{ name: activeKey ? "from" : Object.keys(ints).find((k) => VERTEX.test(k) && ints[k] === cur) ?? "u", nodeId: `v${cur}` }] : []),
        ...(nb !== null && nb !== cur ? [{ name: activeKey ? "to" : Object.keys(ints).find((k) => NEIGHBOR.test(k) && ints[k] === nb) ?? "v", nodeId: `v${nb}` }] : []),
      ];
      const caption =
        cur !== null && nb !== null ? `${capm ? "Pushing along" : "Looking at"} edge ${cur} to ${nb}` : cur !== null ? `Visiting vertex ${cur}` : queued.size ? `Frontier: ${[...queued].join(", ")}` : `${n} vertices, ${edges.length} edges`;
      return { kind: "graph", name, nodes, edges, pointers, caption, directed };
    },
  };
}

/* ---------------- 2D tables (dynamic programming) ---------------- */

/** Evaluates a simple index expression such as i - 1 using known integer locals. */
function evalIndex(expr: string, ints: Record<string, number>): number | null {
  if (!/^[\w\s+\-*()]+$/.test(expr)) return null;
  let unknown = false;
  const replaced = expr.replace(/[A-Za-z_]\w*/g, (nm) => (nm in ints ? String(ints[nm]) : ((unknown = true), "0")));
  if (unknown || !/^[\d\s+\-*()]+$/.test(replaced)) return null;
  try {
    const v = Function(`"use strict"; return (${replaced});`)() as number;
    return Number.isInteger(v) ? v : null;
  } catch {
    return null;
  }
}

const fmt = (x: number) => (x >= 2147483647 ? "∞" : Number.isInteger(x) ? String(x) : x.toFixed(2));

function gridDetector(name: string): Detector {
  let prev: number[][] | null = null;
  let arrayId: string | null = null;
  let visited = new Set<string>();
  return {
    name,
    kind: "grid",
    view: ({ step, heap, line }) => {
      let found: { id: string; rows: number[][] } | null = null;
      for (const [nm, v] of roots(step)) if (nm === name && (found = rows2d(heap, v))) break;
      if (!found) return null;
      const m = found.rows;
      const lengths = m.map((r) => r.length);
      const cols = Math.max(0, ...lengths);
      const cells = lengths.reduce((a, b) => a + b, 0);
      if (cells > 900) return null;
      /* A different array object (e.g. a new matrix) starts a fresh visit history. */
      if (found.id !== arrayId) { arrayId = found.id; visited = new Set(); prev = null; }
      const ints: Record<string, number> = {};
      for (const [nm, v] of Object.entries(step.stack[0]?.locals ?? {})) if (typeof v.v === "number" && /^(int|long|short|Integer)$/.test(v.t)) ints[nm] = v.v as number;
      /* Cells this line touches: name[r][c] with indices evaluated from the program's real locals. */
      const cell = new RegExp(`\\b${name}\\s*\\[([^\\]]+)\\]\\s*\\[([^\\]]+)\\]`, "g");
      const reads: string[] = [];
      let target: string | null = null;
      for (const hit of (line ?? "").matchAll(cell)) {
        const r = evalIndex(hit[1], ints), c = evalIndex(hit[2], ints);
        if (r === null || c === null || r < 0 || r >= m.length || c < 0 || c >= lengths[r]) continue;
        const after = (line ?? "").slice((hit.index ?? 0) + hit[0].length);
        if (/^\s*(=(?!=)|\+=|-=|\*=|\/=|%=|\+\+|--)/.test(after) && target === null) target = `${r},${c}`;
        else if (!reads.includes(`${r},${c}`)) reads.push(`${r},${c}`);
      }
      const changed = new Set<string>();
      if (prev) m.forEach((row, r) => row.forEach((x, c) => prev![r]?.[c] !== x && changed.add(`${r},${c}`)));
      prev = m.map((row) => [...row]);
      const active = new Set([...reads, ...(target ? [target] : [])]);
      const nodes: StructNode[] = [];
      m.forEach((row, r) =>
        row.forEach((x, c) => {
          const key = `${r},${c}`;
          nodes.push({ id: `g${key}`, label: fmt(x), state: active.has(key) ? "current" : changed.has(key) ? "special" : visited.has(key) ? "visited" : "idle" });
        }),
      );
      for (const k of active) visited.add(k);
      const at = (k: string) => { const [r, c] = k.split(","); return `${name}[${r}][${c}]`; };
      const value = (k: string) => { const [r, c] = k.split(",").map(Number); return fmt(m[r][c]); };
      const shape = lengths.every((l) => l === cols) ? `${m.length} row${m.length === 1 ? "" : "s"} × ${cols} column${cols === 1 ? "" : "s"}` : `${m.length} rows of different lengths`;
      const caption =
        cells === 0 ? `${name} is empty (${m.length} × ${cols})`
        : target ? `Writing ${at(target)}${reads.length ? `, reading ${reads.map(at).join(" and ")}` : ""}`
        : reads.length === 1 ? `Reading ${at(reads[0])} = ${value(reads[0])}`
        : reads.length ? `Reading ${reads.map((k) => `${at(k)} = ${value(k)}`).join(", ")}`
        : `${name}: ${shape}`;
      return { kind: "grid", name, nodes, edges: [], pointers: [], grid: { rows: m.length, cols, lengths }, caption };
    },
  };
}

/* ---------------- Points (clustering) ---------------- */

const PALETTE = ["#2f6bff", "#8f6bff", "#2fd1b5", "#f2c94c", "#ff6b9a", "#5fd9c0"];

function pointsOf(heap: Record<string, HeapObj>, v: Val | undefined): [number, number][] | null {
  const m = matrix(heap, v);
  if (m && m[0].length >= 2) return m.map((r) => [r[0], r[1]]);
  if (!v || v.t !== "ref") return null;
  const o = heap[v.id as string];
  if (!o || (o.t !== "list" && o.t !== "array")) return null;
  const out: [number, number][] = [];
  for (const it of o.items) {
    const p = it.t === "ref" ? heap[it.id as string] : undefined;
    if (!p || p.t !== "object") return null;
    const x = num(p.fields.x), y = num(p.fields.y);
    if (x === null || y === null) return null;
    out.push([x, y]);
  }
  return out.length ? out : null;
}

function pointsDetector(name: string): Detector {
  return {
    name,
    kind: "points",
    view: ({ step, heap }) => {
      let pts: [number, number][] | null = null;
      let centers: [number, number][] | null = null;
      let assign: Val[] | null = null;
      for (const [nm, v] of roots(step)) {
        if (!pts && nm === name) pts = pointsOf(heap, v);
        if (!centers && /^(centroids|centers|centres|means)$/.test(nm)) centers = pointsOf(heap, v);
        if (!assign && /^(assignment|assignments|assign|clusters|cluster|labels)$/.test(nm) && v.t === "ref") {
          const o = heap[v.id as string];
          if (o?.t === "array") assign = o.items;
        }
      }
      if (!pts) return null;
      const ints: Record<string, number> = {};
      for (const [nm, v] of Object.entries(step.stack[0]?.locals ?? {})) if ((v.t === "int" || v.t === "Integer") && typeof v.v === "number") ints[nm] = v.v as number;
      const cur = Object.entries(ints).find(([nm, x]) => /^(p|i|idx|point)$/.test(nm) && x >= 0 && x < pts!.length)?.[1] ?? null;
      const cand = centers ? Object.entries(ints).find(([nm, x]) => /^(c|j|k2|centroid)$/.test(nm) && x >= 0 && x < centers!.length)?.[1] ?? null : null;
      const nodes: StructNode[] = pts.map((p, i) => {
        const a = assign ? num(assign[i]) : null;
        return { id: `p${i}`, label: "", state: i === cur ? "current" : a !== null && a >= 0 ? "visited" : "idle", tint: i !== cur && a !== null && a >= 0 ? PALETTE[a % PALETTE.length] : undefined, pos: p };
      });
      (centers ?? []).forEach((c, k) => nodes.push({ id: `c${k}`, label: `C${k}`, state: "special", tint: PALETTE[k % PALETTE.length], pos: c }));
      const edges: StructEdge[] = cur !== null && cand !== null ? [{ from: `p${cur}`, to: `c${cand}`, state: "active" }] : [];
      const best = ints.best;
      return {
        kind: "points", name, nodes, edges, pointers: [],
        caption: cur !== null && cand !== null ? `Point ${cur}: distance to centroid ${cand}${best !== undefined ? `, nearest so far ${best}` : ""}` : `${pts.length} points, ${centers?.length ?? 0} centroids`,
      };
    },
  };
}

/* ---------------- Maps ---------------- */

const MAP_OPS = "get|put|containsKey|remove|getOrDefault|putIfAbsent|merge|replace";

/** The key a call on this line uses: a string, char, or number literal, or a local variable. */
function keyFromSource(token: string, step: RawStep, heap: Record<string, HeapObj>): string | null {
  const t = token.trim();
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return t.slice(1, -1);
  if (/^'.'$/.test(t)) return t.slice(1, -1);
  if (/^-?\d+$/.test(t)) return t;
  const local = step.stack[0]?.locals[t];
  if (!local) return null;
  if (local.t === "ref") {
    const o = heap[local.id as string];
    return o && "value" in o && typeof (o as { value?: unknown }).value === "string" ? ((o as { value: string }).value) : null;
  }
  return local.v === undefined || local.v === null ? null : String(local.v);
}

/**
 * A map drawn as a table: one row per entry, a key cell pointing to its value cell. Rows keep
 * the order keys first appeared, so the table doesn't reshuffle as the program runs.
 */
function mapDetector(name: string): Detector {
  let order: string[] = [];
  let last = new Map<string, string>();
  return {
    name,
    kind: "map",
    view: ({ step, heap, line }) => {
      const found = roots(step).find(([nm, v]) => nm === name && v.t === "ref" && heap[v.id as string]?.t === "map");
      if (!found) return null;
      const m = heap[found[1].id as string] as Extract<HeapObj, { t: "map" }>;
      const keyText = (k: Val) => (k.t === "ref" ? displayValue(k, heap) : String(k.v ?? "null"));
      const now = new Map(m.entries.map(([k, v]) => [keyText(k), displayValue(v, heap)]));
      /* Real bucket indices, read from the HashMap's own table by the tracer. */
      const bucketOf = new Map<string, number>();
      if (m.buckets?.length === m.entries.length) m.entries.forEach(([k], i) => bucketOf.set(keyText(k), m.buckets![i]));
      for (const k of now.keys()) if (!order.includes(k)) order.push(k);
      order = order.filter((k) => now.has(k));

      /* The operation on this line, if any, and the key it uses. */
      const call = new RegExp(`\\b${name}\\s*\\.\\s*(${MAP_OPS})\\s*\\(([^()]*)\\)`).exec(line ?? "");
      const op = call?.[1] ?? null;
      const args = call ? call[2].split(",").map((a) => a.trim()) : [];
      const key = call && args[0] ? keyFromSource(args[0], step, heap) : null;
      const present = key !== null && now.has(key);

      const nodes: StructNode[] = [];
      const edges: StructEdge[] = [];
      for (const k of order) {
        const v = now.get(k)!;
        const isNew = !last.has(k);
        const changed = !isNew && last.get(k) !== v;
        const touched = key === k;
        nodes.push({ id: `k:${k}`, label: k, sub: bucketOf.has(k) ? `bucket ${bucketOf.get(k)}` : undefined, state: touched ? "current" : isNew && last.size ? "special" : "idle" });
        nodes.push({ id: `v:${k}`, label: v, state: touched ? "current" : (isNew && last.size) || changed ? "special" : "idle" });
        edges.push({ from: `k:${k}`, to: `v:${k}`, state: touched ? "active" : changed || (isNew && last.size) ? "special" : "idle" });
      }
      const removed = [...last.keys()].filter((k) => !now.has(k));
      const changedKeys = [...now.keys()].filter((k) => last.has(k) && last.get(k) !== now.get(k));
      const addedKeys = [...now.keys()].filter((k) => !last.has(k));
      const q = (k: string) => (args[0]?.trim().startsWith('"') ? `"${k}"` : k);
      let caption: string;
      if (op && key !== null) {
        const callText = `${op}(${args.join(", ")})` + (present && bucketOf.has(key) ? ` [bucket ${bucketOf.get(key)} of ${m.capacity}]` : "");
        caption =
          op === "get" ? (present ? `${callText} looks up ${q(key)} and finds ${now.get(key)}` : `${callText}: ${q(key)} isn't a key, so it returns null`)
          : op === "getOrDefault" ? (present ? `${callText} finds ${now.get(key)}` : `${callText}: ${q(key)} isn't a key, so the default ${args[1] ?? ""} is used`)
          : op === "containsKey" ? `${callText}: ${present ? `yes, ${q(key)} is a key` : `no, ${q(key)} isn't a key`}`
          : op === "remove" ? (present ? `${callText} deletes the ${q(key)} entry` : `${callText}: there's no ${q(key)} to remove`)
          : op === "put" ? (present ? `${callText} replaces the value for ${q(key)}` : `${callText} adds a new entry`)
          : `${callText}`;
      } else if (last.size && removed.length) caption = `${removed[0]} was removed`;
      else if (last.size && changedKeys.length) caption = `${changedKeys[0]} now maps to ${now.get(changedKeys[0])}`;
      else if (last.size && addedKeys.length) caption = `${addedKeys[0]} now maps to ${now.get(addedKeys[0])}`;
      else caption = now.size ? `${now.size} ${now.size === 1 ? "entry" : "entries"} in ${name}` : `${name} is empty`;
      last = now;
      return { kind: "map", name, nodes, edges, pointers: [], order, iter: m.entries.map(([k]) => keyText(k)), directed: true, caption, buckets: bucketOf.size > 0 };
    },
  };
}

/* ---------------- Stacks and queues ---------------- */

type ObjHeap = Extract<HeapObj, { t: "object" }>;
const intOf = (o: ObjHeap, names: string[]) => {
  for (const n of names) {
    const v = o.fields[n];
    if (v && typeof v.v === "number" && /^(int|long|short|Integer)$/.test(v.t)) return v.v as number;
  }
  return null;
};
const arrayFieldOf = (o: ObjHeap, heap: Record<string, HeapObj>) => {
  for (const v of Object.values(o.fields)) {
    if (v.t !== "ref") continue;
    const a = heap[v.id as string];
    if (a?.t === "array") return a;
  }
  return null;
};
type SeqKind = "stack" | "queue";
type Snapshot = { values: Val[]; slots: number[]; capacity: number | null };

/** An array-backed stack (array + top or size) or circular queue (array + head + count or tail). */
function seqOfObject(o: ObjHeap, heap: Record<string, HeapObj>, kind: SeqKind): Snapshot | null {
  const arr = arrayFieldOf(o, heap);
  if (!arr) return null;
  const len = arr.items.length;
  if (kind === "stack") {
    const top = intOf(o, ["top"]);
    const size = intOf(o, ["size", "count", "n", "length"]);
    const count = top !== null ? top + 1 : size;
    if (count === null) return null;
    const c = Math.max(0, Math.min(count, len));
    return { values: arr.items.slice(0, c), slots: [...Array(c).keys()], capacity: len };
  }
  const head = intOf(o, ["head", "front", "first"]);
  if (head === null || len === 0) return null;
  const count = intOf(o, ["count", "size", "n", "length"]);
  const tail = intOf(o, ["tail", "rear", "back", "last"]);
  const n = count ?? (tail !== null ? (tail - head + len) % len : null);
  if (n === null) return null;
  const slots = [...Array(Math.max(0, Math.min(n, len))).keys()].map((k) => (head + k) % len);
  return { values: slots.map((sl) => arr.items[sl]), slots, capacity: len };
}

/** java.util collections used as a stack or queue, recognized by variable name. */
function seqOfCollection(h: HeapObj | undefined, kind: SeqKind): Snapshot | null {
  if (!h || (h.t !== "deque" && h.t !== "list" && h.t !== "stack")) return null;
  /* Deque.push (ArrayDeque, LinkedList) adds at the front; java.util.Stack and ArrayList grow at the end. */
  const cls = (h as { cls?: string }).cls ?? "";
  const frontIsTop = h.t === "deque" || cls === "java.util.LinkedList";
  const values = kind === "stack" && frontIsTop ? [...h.items].reverse() : h.items;
  return { values, slots: values.map((_, i) => i), capacity: null };
}

const same = (a: Val, b: Val) => a.t === b.t && (a.t === "ref" ? a.id === b.id : a.v === b.v);

function seqDetector(kind: SeqKind, source: { cls: string } | { name: string }): Detector {
  const detectorName = "name" in source ? source.name : undefined;
  let prev: { values: Val[]; ids: string[] } | null = null;
  let fresh = 0;
  const gen = new Map<number, number>();
  let prevPos = new Map<number, number>();
  return {
    kind,
    name: detectorName,
    cls: "cls" in source ? source.cls : undefined,
    view: ({ step, heap }) => {
      let snap: Snapshot | null = null;
      if ("cls" in source) {
        const self = step.stack[0]?.locals.this;
        const pick = (v: Val | undefined) => (v?.t === "ref" && isObj(heap[v.id as string], source.cls) ? seqOfObject(heap[v.id as string] as ObjHeap, heap, kind) : null);
        snap = pick(self);
        if (!snap) for (const [, v] of roots(step)) if ((snap = pick(v))) break;
      } else {
        for (const [nm, v] of roots(step)) if (nm === source.name && v.t === "ref" && (snap = seqOfCollection(heap[v.id as string], kind))) break;
      }
      if (!snap) return null;
      const { values } = snap;
      /* Stable identities: a stack slot is its depth; a queue element keeps its id as it moves forward. */
      let ids: string[];
      if (kind === "stack") ids = values.map((_, i) => `s${i}`);
      else if (snap.capacity !== null) {
        /* Queue elements only move toward the front. A slot that shows up farther back than before
           (a full circular buffer wrapping) holds a different element, so it gets a new identity. */
        snap.slots.forEach((sl, i) => {
          const was = prevPos.get(sl);
          if (was === undefined || i > was) gen.set(sl, (gen.get(sl) ?? 0) + 1);
        });
        prevPos = new Map(snap.slots.map((sl, i) => [sl, i]));
        ids = snap.slots.map((sl) => `q${sl}g${gen.get(sl)}`);
      } else {
        ids = values.map(() => `q${fresh++}`);
        if (prev) {
          for (let shift = 0; shift <= prev.values.length; shift++) {
            const rest = prev.values.slice(shift);
            if (rest.length <= values.length && rest.every((v, i) => same(v, values[i]))) {
              rest.forEach((_, i) => (ids[i] = prev!.ids[shift + i]));
              break;
            }
          }
        }
      }
      prev = { values, ids };
      /* States, pointers, and captions are filled in by polishSequence once the whole run is known. */
      const nodes: StructNode[] = values.map((v, i) => ({ id: ids[i], label: displayValue(v, heap), state: "idle" }));
      const pointers: { name: string; nodeId: string }[] = [];
      const caption = "";
      return { kind, name: "name" in source ? source.name : undefined, nodes, edges: [], pointers, order: ids, capacity: snap.capacity ?? undefined, caption, atomic: !("cls" in source) };
    },
  };
}

/**
 * The tracer records state between lines, so a push shows an empty slot for one step (top++
 * runs before items[top] = value), and a dequeue briefly shows a cleared front and a phantom
 * slot. This smooths those in-between steps using their neighbors, then sets states, pointers,
 * and captions from the cleaned sequence.
 */
export function polishSequence(views: (StructureView | null)[]) {
  const raw = views.map((v) => (v ? new Map(v.nodes.map((n) => [n.id, n.label])) : null));
  views.forEach((v, k) => {
    if (!v || v.atomic) return;
    const prev = raw[k - 1] ?? null, next = raw[k + 1] ?? null;
    v.nodes = v.nodes.filter((n) => !(next && !next.has(n.id) && !(prev && prev.has(n.id))));
    for (const n of v.nodes) {
      const inPrev = prev?.has(n.id), inNext = next?.has(n.id);
      if (!inPrev && inNext && next!.get(n.id) !== n.label) n.label = next!.get(n.id)!;
      else if (inPrev && next && !inNext && prev!.get(n.id) !== n.label) n.label = prev!.get(n.id)!;
    }
    v.order = v.nodes.map((n) => n.id);
  });
  let before: StructureView | null = null;
  for (const v of views) {
    if (!v) { before = null; continue; }
    const ids = v.nodes.map((n) => n.id);
    const added = new Set(ids.filter((id) => !before?.nodes.some((n) => n.id === id)));
    const removed = before ? before.nodes.filter((n) => !ids.includes(n.id)) : [];
    v.pointers = [];
    if (v.kind === "stack") {
      const top = v.nodes.at(-1);
      if (top) {
        top.state = added.has(top.id) ? "special" : "current";
        v.pointers.push({ name: "top", nodeId: top.id });
      }
      v.caption = top && added.has(top.id) && before ? `push(${top.label}): ${top.label} is the new top`
        : removed.length ? `pop() took ${removed.at(-1)!.label} off the top`
        : top ? `${v.nodes.length} item${v.nodes.length === 1 ? "" : "s"} stacked, top is ${top.label}` : "The stack is empty";
    } else {
      const front = v.nodes[0], back = v.nodes.at(-1);
      if (back && back !== front) back.state = added.has(back.id) ? "special" : "queued";
      if (front) front.state = added.has(front.id) && v.nodes.length === 1 ? "special" : "current";
      if (front) v.pointers.push({ name: "front", nodeId: front.id });
      if (back && back !== front) v.pointers.push({ name: "back", nodeId: back.id });
      v.caption = removed.length ? `dequeue() removed ${removed[0].label} from the front`
        : back && added.has(back.id) && before ? `enqueue(${back.label}) joined at the back`
        : front ? `${v.nodes.length} waiting, front is ${front.label}` : "The queue is empty";
    }
    if (before && ids.join() === before.nodes.map((n) => n.id).join() && !removed.length && !added.size) {
      /* Nothing moved: keep describing the last change instead of flickering to a summary. */
      if (/^(push|pop|enqueue|dequeue)/.test(before.caption)) v.caption = before.caption;
    }
    before = v;
  }
}

/* ---------------- Plain arrays and lists, as one layer among several ---------------- */

const INDEXES = /^(i|j|k|lo|hi|low|high|mid|left|right|start|end|idx|index|pos|p|q|cur|curr|slow|fast|top|head|tail|front|rear|minIdx|maxIdx|minIndex|maxIndex)$/;

/** A one-dimensional array of values, or a list, deque, or priority queue holding values. */
function flatItems(h: HeapObj | undefined): Val[] | null {
  if (!h) return null;
  if (h.t === "array") return /\[\]$/.test(h.of) ? null : h.items;
  if (h.t === "list" || h.t === "deque" || h.t === "heap" || h.t === "stack") return h.items.every((v) => v.t !== "ref") ? h.items : null;
  return null;
}

/** Variables the source uses inside name[...] or name.get(...): the only honest pointers into it. */
function indexVarsFor(name: string, sources: Record<string, string>) {
  const vars = new Set<string>();
  const re = new RegExp(`\\b${name}\\s*(?:\\[([^\\]]+)\\]|\\.\\s*(?:get|set|remove)\\s*\\(([^,)]+))`, "g");
  for (const text of Object.values(sources)) for (const m of text.matchAll(re)) for (const id of (m[1] ?? m[2]).match(/[A-Za-z_]\w*/g) ?? []) vars.add(id);
  return vars;
}

function arrayDetector(name: string, indexVars: Set<string> = new Set()): Detector {
  let prev: string[] | null = null;
  return {
    name,
    kind: "array",
    view: ({ step, heap, line }) => {
      let items: Val[] | null = null;
      for (const [nm, v] of roots(step)) if (nm === name && v.t === "ref" && (items = flatItems(heap[v.id as string]))) break;
      if (!items) return null;
      const labels = items.map((v) => (v.t === "null" ? "null" : String(v.v)));
      const ints: Record<string, number> = {};
      for (const [nm, v] of Object.entries(step.stack[0]?.locals ?? {})) if (typeof v.v === "number" && /^(int|long|short|Integer)$/.test(v.t)) ints[nm] = v.v as number;
      const touched = new Set<number>();
      const access = new RegExp(`\\b${name}\\s*(?:\\[([^\\]]+)\\](?!\\s*\\[)|\\.\\s*(?:get|set|remove)\\s*\\(([^,)]+))`, "g");
      for (const hit of (line ?? "").matchAll(access)) {
        const ix = evalIndex(hit[1] ?? hit[2], ints);
        if (ix !== null && ix >= 0 && ix < labels.length) touched.add(ix);
      }
      const nodes: StructNode[] = labels.map((l, i) => ({
        id: `a${i}`, label: l, sub: String(i),
        state: touched.has(i) ? "current" : prev && prev.length === labels.length && prev[i] !== l ? "special" : "idle",
      }));
      prev = labels;
      const pointers = Object.entries(ints).filter(([nm, x]) => indexVars.has(nm) && x >= 0 && x < labels.length).slice(0, 3).map(([nm, x]) => ({ name: nm, nodeId: `a${x}` }));
      const first = [...touched][0];
      return {
        kind: "array", name, nodes, edges: [], pointers, order: nodes.map((n) => n.id),
        caption: first !== undefined ? `Reading ${name}[${first}] = ${labels[first]}` : `${name}: ${labels.length} element${labels.length === 1 ? "" : "s"}`,
      };
    },
  };
}

export type LayerDef = { key: string; name: string; title: string; detector: Detector };

/** The declared type of a root found by roots(): a frame's local, or a static field (depth 99). */
function declaredAt(step: RawStep, name: string, depth: number, classes?: Record<string, ClassInfo>): string | undefined {
  if (depth !== 99) return step.stack[depth]?.types?.[name];
  const q = Object.keys(step.statics ?? {}).find((k) => k.slice(k.lastIndexOf(".") + 1) === name);
  return q ? classes?.[q.slice(0, q.lastIndexOf("."))]?.statics[name] : undefined;
}

/** "scores : Map<String, Integer>" from the declared type, or the runtime class when none was recorded. */
function labelOf(step: RawStep, heap: Record<string, HeapObj>, name: string, v: Val, depth: number, classes?: Record<string, ClassInfo>) {
  /* The declared type is what the variable is; the object's own class shows in the variable panel. */
  return identifier(name, describeType(declaredAt(step, name, depth, classes), heap[v.id as string]).type);
}

/** A floating label for a structure: its variable and type, "graph : List<List<Integer>> (adjacency)". */
export function titleFor(detector: Detector, steps: RawStep[], heaps: Record<string, HeapObj>[], classes?: Record<string, ClassInfo>): string {
  if (!detector.name) return detector.kind === "tree" ? "binary tree" : detector.kind === "list" ? "linked list" : detector.kind === "stack" ? "stack" : detector.kind === "queue" ? "queue" : detector.kind;
  for (let k = 0; k < steps.length; k++) {
    const found = roots(steps[k]).find(([nm, v]) => nm === detector.name && v.t === "ref" && heaps[k][v.id as string]);
    if (!found) continue;
    return `${labelOf(steps[k], heaps[k], found[0], found[1], found[2], classes)}${detector.kind === "graph" ? " (adjacency)" : detector.kind === "points" ? " (points)" : ""}`;
  }
  return detector.name;
}

/**
 * Every other data structure the program holds, so several can be drawn side by side: arrays,
 * lists, maps, sets, stacks, queues, linked lists, and 2D arrays, named by their variables.
 */
export function detectExtraLayers(steps: RawStep[], heaps: Record<string, HeapObj>[], primary: Detector | null, sources: Record<string, string> = {}, limit = 4, classes?: Record<string, ClassInfo>): LayerDef[] {
  const skip = new Set(["args"]);
  if (primary?.name) skip.add(primary.name);
  if (primary?.kind === "graph") for (const n of ["dist", "distance", "distances", "d", "prev", "parent", "pred", "previous", "visited", "seen", "done", "settled", "level", "height", "heights", "h", "label", "excess", "overflow", "flow", "flows"]) skip.add(n);
  if (primary?.kind === "points") for (const n of ["centroids", "centers", "centres", "means", "assignment", "assignments", "assign", "clusters", "cluster", "labels"]) skip.add(n);
  const ids = new Set<string>(), names = new Set<string>(), out: LayerDef[] = [];
  const room = limit - (primary ? 1 : 0);
  steps.forEach((s, k) => {
    const heap = heaps[k];
    const consider = (nm: string, v: Val, depth: number) => {
      if (out.length >= room || skip.has(nm) || names.has(nm) || v.t !== "ref" || ids.has(v.id as string)) return;
      const h = heap[v.id as string];
      if (!h) return;
      let det: Detector | null = null;
      if (h.t === "map") det = mapDetector(nm);
      else if (h.t === "set") det = setDetector(nm);
      else if (h.t === "stack" || ((h.t === "deque" || h.t === "list") && /stack|^(stk|st|s)$/i.test(nm))) det = seqDetector("stack", { name: nm });
      else if ((h.t === "deque" || h.t === "list") && /queue|^(q|line|waiting)$/i.test(nm)) det = seqDetector("queue", { name: nm });
      else if (h.t === "list" && h.cls === "java.util.LinkedList") det = jdkListDetector(nm);
      else if (rows2d(heap, v) && !MATRIX_GRAPH.test(nm)) det = gridDetector(nm);
      else if (flatItems(h)) det = arrayDetector(nm, indexVarsFor(nm, sources));
      if (!det) return;
      ids.add(v.id as string);
      names.add(nm);
      out.push({ key: `v:${nm}`, name: nm, title: labelOf(s, heap, nm, v, depth, classes), detector: det });
    };
    /* Outermost frames first, so a structure is named after the variable that owns it. */
    for (let depth = s.stack.length - 1; depth >= 0; depth--) for (const [nm, v] of Object.entries(s.stack[depth].locals)) consider(nm, v, depth);
    for (const [nm, v] of Object.entries(s.statics ?? {})) consider(nm.split(".").pop()!, v, 99);
  });
  return out;
}

/* ---------------- Loops over a structure ---------------- */

import type { ActiveLoop } from "./loops";

const loopValue = (v: Val | null) => (!v ? "" : v.t === "ref" ? "" : v.t === "String" || v.t === "java.lang.String" || typeof v.v === "string" ? JSON.stringify(v.v) : String(v.v));

/**
 * Lights the element a loop is on in the structure it iterates, marks earlier passes visited,
 * and adds a badge. The pass and the variable's value come from the recording.
 */
export function applyLoops(view: StructureView | null, loops: ActiveLoop[]) {
  if (!view?.name) return;
  for (const lp of loops) {
    if (lp.iterable !== view.name) continue;
    const valueText = loopValue(lp.value);
    const plain = valueText.replace(/^"|"$/g, "");
    let target: number | null = null;
    let total = 0;
    if (view.kind === "map") {
      const keys = view.iter ?? [];
      total = keys.length;
      const idx = lp.mode === "keys" && plain ? keys.indexOf(plain) : lp.iteration - 1;
      const key = keys[idx];
      if (key !== undefined) {
        target = idx;
        for (const n of view.nodes) if (n.id === `k:${key}` || n.id === `v:${key}`) n.state = "current";
        for (const e of view.edges) if (e.from === `k:${key}`) e.state = "active";
        if (lp.kind !== "forEach") keys.slice(0, idx).forEach((k) => view.nodes.forEach((n) => (n.id === `k:${k}` || n.id === `v:${k}`) && n.state === "idle" && (n.state = "visited")));
      }
      const shown = lp.mode === "entries" && key !== undefined ? `${key}=${view.nodes.find((n) => n.id === `v:${key}`)?.label}` : valueText;
      view.badge = `${lp.kind === "forEach" ? `${lp.exprText}.forEach` : `for (${lp.typeText} ${lp.varName} : ${lp.exprText})`}: pass ${idx + 1} of ${total}${shown ? `, ${lp.varName} = ${shown}` : ""}`;
      continue;
    }
    if (view.kind === "graph") {
      /* for (int v : graph.get(u)) walks u's neighbors: light the neighbor by value, no totals. */
      const hit = view.nodes.find((n) => n.label === plain);
      if (hit && hit.state !== "current") hit.state = "queued";
      view.badge = `for (${lp.typeText} ${lp.varName} : ${lp.exprText}): ${/\.get\(/.test(lp.exprText) ? "neighbor" : "pass"} ${lp.iteration}${valueText ? `, ${lp.varName} = ${valueText}` : ""}`;
      continue;
    }
    if (view.kind === "grid") {
      total = view.grid?.rows ?? 0;
      const r = lp.iteration - 1;
      /* An indexed loop over a matrix only labels the row; the exact cell comes from the real index expressions. */
      if (lp.kind !== "enhanced") {
        view.badge = `for loop over ${lp.exprText}: ${lp.varName} = ${r}, row ${r} of ${total}`;
        continue;
      }
      for (const n of view.nodes) {
        const row = Number(n.id.slice(1).split(",")[0]);
        if (row === r) n.state = "current";
        else if (row < r && n.state === "idle") n.state = "visited";
      }
      view.badge = `for (${lp.typeText} ${lp.varName} : ${lp.exprText}): row ${r} of ${total}`;
      continue;
    }
    const nodes = view.nodes;
    total = nodes.length;
    const byPass = lp.kind === "indexed" ? lp.iteration - 1 : lp.iteration - 1;
    if (lp.kind !== "forEach" && nodes[byPass] && (!plain || nodes[byPass].label === plain || lp.kind === "indexed")) target = byPass;
    else if (plain) {
      const i = nodes.findIndex((n) => n.label === plain);
      if (i >= 0) target = i;
    }
    if (target !== null) {
      nodes[target].state = "current";
      if (lp.kind !== "forEach") nodes.slice(0, target).forEach((n) => n.state === "idle" && (n.state = "visited"));
      view.pointers = [...view.pointers.filter((p) => p.name !== lp.varName), { name: lp.varName, nodeId: nodes[target].id }];
    }
    view.badge =
      lp.kind === "indexed" ? `for loop over ${lp.exprText}: ${lp.varName} = ${lp.iteration - 1}, pass ${lp.iteration} of ${total}`
      : lp.kind === "forEach" ? `${lp.exprText}.forEach: ${lp.varName} = ${valueText}`
      : `for (${lp.typeText} ${lp.varName} : ${lp.exprText}): pass ${lp.iteration} of ${total}${valueText ? `, ${lp.varName} = ${valueText}` : ""}`;
  }
}

/** Picks the structure the program is built around, if any. Trees, lists, points, graphs, tables, maps. */
export function detectStructure(steps: RawStep[], heaps: Record<string, HeapObj>[]): Detector | null {
  const classes = new Map<string, string[]>();
  let graphName: string | null = null;
  let mapName: string | null = null;
  let gridName: string | null = null;
  let pointsName: string | null = null;
  let seqClass: { kind: SeqKind; cls: string } | null = null;
  let seqName: { kind: SeqKind; name: string } | null = null;
  let setName: string | null = null;
  let linkedName: string | null = null;
  steps.forEach((s, k) => {
    const heap = heaps[k];
    /* Union over the whole run: a tree's right links may only appear after its left ones. */
    for (const o of Object.values(heap)) if (o.t === "object") {
      const f = selfFields(heap, o.cls);
      if (f.length) classes.set(o.cls, [...new Set([...(classes.get(o.cls) ?? []), ...f])]);
    }
    for (const o of Object.values(heap)) {
      if (seqClass || o.t !== "object") continue;
      const asStack = /stack/i.test(o.cls) || "top" in o.fields;
      const asQueue = /queue/i.test(o.cls) || "head" in o.fields || "front" in o.fields;
      if (asStack && seqOfObject(o, heap, "stack")) seqClass = { kind: "stack", cls: o.cls };
      else if (asQueue && seqOfObject(o, heap, "queue")) seqClass = { kind: "queue", cls: o.cls };
    }
    for (const [nm, v] of roots(s)) {
      if (!seqName && v.t === "ref") {
        const h = heap[v.id as string];
        /* java.util.Stack is a stack whatever it's called; other collections by a stack- or queue-like name. */
        if (h?.t === "stack" || (/stack|^(stk|st|s)$/i.test(nm) && seqOfCollection(h, "stack"))) seqName = { kind: "stack", name: nm };
        else if (/queue|^(q|line|waiting)$/i.test(nm) && h?.t !== "heap" && seqOfCollection(h, "queue")) seqName = { kind: "queue", name: nm };
      }
      if (v.t === "ref") {
        const h = heap[v.id as string];
        if (!setName && h?.t === "set") setName = nm;
        if (!linkedName && h?.t === "list" && h.cls === "java.util.LinkedList") linkedName = nm;
      }
      if (!pointsName && /^(points|data|pts|samples|coords)$/.test(nm) && pointsOf(heap, v)) pointsName = nm;
      if (!graphName && adjacency(heap, v, nm)) graphName = nm;
      if (!gridName && !MATRIX_GRAPH.test(nm) && !/^(flow|flows)$/.test(nm) && rows2d(heap, v)) gridName = nm;
      if (!mapName && v.t === "ref" && heap[v.id as string]?.t === "map") mapName = nm;
    }
  });
  for (const [cls, f] of classes) if (f.length >= 2) {
    const ordered = [...f].sort((a, b) => (a.toLowerCase().includes("left") ? -1 : b.toLowerCase().includes("left") ? 1 : 0));
    return treeDetector(cls, ordered.slice(0, 2));
  }
  for (const [cls, f] of classes) if (f.length === 1) return listDetector(cls, f[0]);
  if (pointsName) return pointsDetector(pointsName);
  if (graphName) return graphDetector(graphName);
  if (gridName) return gridDetector(gridName);
  /* Assigned inside the scan callback, which TypeScript's flow analysis can't see. */
  const sc = seqClass as { kind: SeqKind; cls: string } | null;
  const sn = seqName as { kind: SeqKind; name: string } | null;
  if (sc) return seqDetector(sc.kind, { cls: sc.cls });
  if (sn) return seqDetector(sn.kind, { name: sn.name });
  if (mapName) return mapDetector(mapName);
  if (setName) return setDetector(setName);
  if (linkedName) return jdkListDetector(linkedName);
  return null;
}
