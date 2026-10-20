import * as THREE from "three";
import { pathBetween } from "../../algorithms/tree";
import { BFS, DFS, GRAPH, GRAPH_EDGES, GRAPH_LABELS, GRAPH_START, GRAPH_TARGET, SHORTEST_PATH } from "../../journey/data";
import { ANCHORS, local, phase } from "../../journey/timeline";
import type { HoverField } from "./hover-field";
import { EdgeVisual, LabelSet, NodeVisual, createCursor, easeOutBack, edgeGeometry, pointOnPath, sphereKit, type NodeState } from "./visuals";

/* Hand-placed in 3D so the graph has real depth, roughly layered by distance from A. */
const LAYOUT: [number, number, number][] = [
  [-5.2, 0.4, 1.4], [-2.6, 2.6, -1.1], [-2.4, -1.9, 1.3], [0, 3.4, 1.5], [0.3, 0.2, -1.9],
  [0.6, -2.8, 0.7], [3, 2.1, -0.9], [3.1, -1.4, 2.1], [5.4, 2.8, 0.8], [5.7, -0.5, -1.5],
];

const ARRIVE = 0.55;
const L = (i: number) => GRAPH_LABELS[i];
const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

export function createGraphChapter() {
  const group = new THREE.Group();
  const labels = new LabelSet();
  const anchor = new THREE.Vector3(...ANCHORS.graph);
  const pos = LAYOUT.map((v) => anchor.clone().add(new THREE.Vector3(...v)));

  const dist: number[] = [];
  BFS.order.forEach((u) => (dist[u] = BFS.parent[u] === null ? 0 : dist[BFS.parent[u] as number] + 1));

  const kit = sphereKit(0.42);
  const nodes = pos.map((p, i) => {
    const v = new NodeVisual(kit, i + 3);
    v.base.copy(p);
    v.targetScale = 0;
    const { obj, el } = labels.make(L(i));
    v.label = el;
    v.object.add(obj);
    group.add(v.object);
    return v;
  });

  const edgeGeo = edgeGeometry(0.032);
  const sleeveGeo = edgeGeometry(0.11);
  const edges = new Map<string, { edge: EdgeVisual; near: number; far: number; growth: number }>();
  GRAPH_EDGES.forEach(([a, b]) => {
    const [near, far] = dist[a] <= dist[b] ? [a, b] : [b, a];
    const edge = new EdgeVisual(edgeGeo, pos[near], pos[far], sleeveGeo);
    edge.grow(0);
    group.add(edge.mesh);
    edges.set(key(a, b), { edge, near, far, growth: 0 });
  });

  const startTag = labels.make("start", "small");
  startTag.obj.position.copy(pos[GRAPH_START]).add(new THREE.Vector3(0, -0.75, 0));
  group.add(startTag.obj);
  const targetTag = labels.make("target", "small");
  targetTag.obj.position.copy(pos[GRAPH_TARGET]).add(new THREE.Vector3(0, -0.75, 0));
  group.add(targetTag.obj);

  const cursor = createCursor();
  group.add(cursor);

  const P = { emerge: phase("graph", "emerge"), bfs: phase("graph", "bfs"), dfs: phase("graph", "dfs"), path: phase("graph", "path") };
  const maxDist = Math.max(...dist);

  const stepOf = (q: number, count: number) => {
    const k = q * (count + 0.4);
    const j = Math.min(Math.floor(k), count - 1);
    const f = k >= count ? 1 : k - Math.floor(k);
    return { j, arrived: f >= ARRIVE, move: Math.min(f / ARRIVE, 1) };
  };

  function update(p: number): string | null {
    /* Emergence: nodes ring outward from A, then edges grow. Reversible with scroll. */
    const e = local(p, P.emerge.start - 0.02, P.emerge.end);
    nodes.forEach((n, i) => {
      const a = THREE.MathUtils.clamp((e - (dist[i] / maxDist) * 0.5) / 0.3, 0, 1);
      n.targetScale = Math.max(easeOutBack(a), 0);
    });
    edges.forEach((entry) => {
      entry.growth = THREE.MathUtils.clamp((e - (dist[entry.far] / maxDist) * 0.5 - 0.15) / 0.3, 0, 1);
    });
    labels.setOpacity(local(e, 0.6, 1) * (1 - local(p, 0.83, 0.86)));

    const states: NodeState[] = new Array(GRAPH_LABELS.length).fill("idle");
    const edgeStates = new Map<string, "idle" | "trail" | "active" | "special">();
    let status: string | null = p < P.bfs.start ? "Ten nodes and thirteen edges, placed in three dimensions" : null;
    cursor.visible = false;

    if (p >= P.bfs.start && p < P.dfs.start) {
      const { j, arrived } = stepOf(local(p, P.bfs.start, P.bfs.end), BFS.order.length);
      const done = arrived ? j + 1 : j;
      const visited = BFS.order.slice(0, done);
      const queue = done > 0 ? BFS.queueAfter[done - 1] : [GRAPH_START];
      visited.forEach((u) => (states[u] = "visited"));
      queue.forEach((u) => (states[u] = "queued"));
      if (done > 0) states[visited[done - 1]] = "current";
      [...visited, ...queue].forEach((v) => {
        const par = BFS.parent[v];
        if (par !== null) edgeStates.set(key(par, v), par === visited[done - 1] ? "active" : "trail");
      });
      status =
        done === 0
          ? "Put A in the queue"
          : `Visit ${L(visited[done - 1])} (distance ${dist[visited[done - 1]]}). Queue: ${queue.map(L).join(", ") || "empty"}`;
    }

    if (p >= P.dfs.start && p < P.path.start) {
      const { j, arrived, move } = stepOf(local(p, P.dfs.start, P.dfs.end), DFS.order.length);
      const done = arrived ? j + 1 : j;
      DFS.order.slice(0, done).forEach((u) => (states[u] = "visited"));
      if (done > 0) states[DFS.order[done - 1]] = "current";
      const parentOf = (u: number) => DFS.parent[u];
      for (let s = 1; s <= j; s++) {
        const path = pathBetween(parentOf, DFS.order[s - 1], DFS.order[s]);
        const moving = s === j && !arrived;
        for (let i = 1; i < path.length; i++) edgeStates.set(key(path[i - 1], path[i]), moving ? "active" : "trail");
        if (s === j) pointOnPath(path.map((u) => pos[u]), arrived ? 1 : move, cursor.position);
      }
      if (j === 0) cursor.position.copy(pos[GRAPH_START]);
      cursor.visible = p <= P.dfs.end + 0.004;
      const stack = done > 0 ? DFS.stackAt[done - 1] : [];
      status = done === 0 ? "Start at A and go as deep as possible" : `Visit ${L(DFS.order[done - 1])}. Current path: ${stack.map(L).join(" → ")}`;
    }

    if (p >= P.path.start) {
      const q = local(p, P.path.start, P.path.end);
      const shown = Math.min(Math.floor(q * (SHORTEST_PATH.length + 0.4)), SHORTEST_PATH.length);
      states.fill("visited");
      SHORTEST_PATH.slice(0, shown).forEach((u) => (states[u] = "special"));
      for (let i = 1; i < shown; i++) edgeStates.set(key(SHORTEST_PATH[i - 1], SHORTEST_PATH[i]), "special");
      status = `BFS parents give the shortest path: ${SHORTEST_PATH.slice(0, Math.max(shown, 1)).map(L).join(" → ")}${
        shown >= SHORTEST_PATH.length ? `, ${SHORTEST_PATH.length - 1} edges` : ""
      }`;
    }

    nodes.forEach((n, i) => n.set(states[i], n.targetScale));
    edges.forEach(({ edge }, k) => edge.set(edgeStates.get(k) ?? "idle"));
    return status;
  }

  function tick(k: number, dt: number, field: HoverField | null) {
    nodes.forEach((n) => n.update(k, dt, field));
    edges.forEach(({ edge, near, far, growth }) => {
      edge.place(nodes[near].object.position, nodes[far].object.position);
      edge.grow(growth);
      edge.update(k);
    });
  }

  return { group, labels: [labels], update, tick };
}
