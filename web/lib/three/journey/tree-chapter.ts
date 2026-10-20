import * as THREE from "three";
import { pathBetween } from "../../algorithms/tree";
import { TRAVERSALS, TREE, TREE_ORDERS } from "../../journey/data";
import { ANCHORS, local, phase } from "../../journey/timeline";
import { seededRandom } from "../materials";
import type { HoverField } from "./hover-field";
import {
  EdgeVisual,
  LabelSet,
  NodeVisual,
  createCursor,
  easeOutBack,
  easeOutCubic,
  edgeGeometry,
  pointOnPath,
  sphereKit,
} from "./visuals";

const X_GAP = 1.3;
const Y_GAP = 1.8;
const Z_LEAN = 0.7;
const ARRIVE = 0.55;

const NAMES: Record<string, string> = { preorder: "Preorder", inorder: "Inorder", postorder: "Postorder" };

export function createTreeChapter() {
  const group = new THREE.Group();
  const labels = new LabelSet();
  const { nodes, root } = TREE;
  const parentOf = (id: number) => nodes[id].parent;
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  const inorderIndex = new Map(TREE_ORDERS.inorder.map((id, i) => [id, i]));
  const [ax, ay, az] = ANCHORS.tree;

  const home = nodes.map((n) => {
    const i = inorderIndex.get(n.id) as number;
    return new THREE.Vector3(
      ax + (i - (nodes.length - 1) / 2) * X_GAP,
      ay + (maxDepth / 2 - n.depth) * Y_GAP,
      az - n.depth * Z_LEAN,
    );
  });

  const rand = seededRandom(17);
  const scatter = home.map((h) =>
    h.clone().add(new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize().multiplyScalar(9)),
  );
  const arrival = nodes.map((n) => 0.16 + n.depth * 0.13 + (inorderIndex.get(n.id) as number) * 0.006);

  const kit = sphereKit(0.46, false);
  const visuals = nodes.map((n) => {
    const v = new NodeVisual(kit, n.id);
    v.base.copy(scatter[n.id]);
    const { obj, el } = labels.make(String(n.value));
    v.label = el;
    v.object.add(obj);
    group.add(v.object);
    return v;
  });

  const edgeGeo = edgeGeometry(0.035);
  const sleeveGeo = edgeGeometry(0.12);
  const edges = new Map<number, EdgeVisual>();
  const growth = new Map<number, number>();
  nodes.forEach((n) => {
    if (n.parent === null) return;
    const e = new EdgeVisual(edgeGeo, home[n.parent], home[n.id], sleeveGeo);
    e.grow(0);
    edges.set(n.id, e);
    growth.set(n.id, 0);
    group.add(e.mesh);
  });
  const edgeKey = (a: number, b: number) => (parentOf(b) === a ? b : a);

  const cursor = createCursor();
  group.add(cursor);
  const tmp = new THREE.Vector3();

  const phases = TRAVERSALS.map((kind) => ({ kind, ...phase("tree", kind) }));

  function update(p: number, intro: number): string | null {
    /* Opening assembly, driven by time rather than scroll. */
    nodes.forEach((n) => {
      const a = THREE.MathUtils.clamp((intro - arrival[n.id]) / 0.3, 0, 1);
      visuals[n.id].base.lerpVectors(scatter[n.id], home[n.id], easeOutCubic(a));
      visuals[n.id].targetScale = Math.max(easeOutBack(a), 0);
      if (growth.has(n.id)) growth.set(n.id, THREE.MathUtils.clamp((intro - arrival[n.id] - 0.3) / 0.12, 0, 1));
    });

    const showLabels = THREE.MathUtils.clamp((intro - 0.75) / 0.2, 0, 1) * (1 - local(p, 0.235, 0.27));
    labels.setOpacity(showLabels);

    let active = -1;
    phases.forEach((ph, i) => {
      if (p >= ph.start) active = i;
    });

    const states = new Array(nodes.length).fill("idle") as ("idle" | "visited" | "current")[];
    const edgeStates = new Map<number, "idle" | "trail" | "active">();
    let status: string | null = null;
    cursor.visible = false;

    if (active >= 0) {
      const ph = phases[active];
      const order = TREE_ORDERS[ph.kind];
      const q = local(p, ph.start, ph.end);
      const k = q * (order.length + 0.4);
      const j = Math.min(Math.floor(k), order.length - 1);
      const f = k >= order.length ? 1 : k - Math.floor(k);
      const arrived = f >= ARRIVE;

      for (let s = 0; s <= j; s++) {
        const from = s === 0 ? root : order[s - 1];
        const path = pathBetween(parentOf, from, order[s]);
        const moving = s === j && !arrived;
        for (let i = 1; i < path.length; i++) edgeStates.set(edgeKey(path[i - 1], path[i]), moving ? "active" : "trail");
        if (s === j) {
          pointOnPath(
            path.map((id) => home[id]),
            arrived ? 1 : f / ARRIVE,
            tmp,
          );
          cursor.position.copy(tmp);
        }
      }

      const visitedCount = arrived ? j + 1 : j;
      order.slice(0, visitedCount).forEach((id) => (states[id] = "visited"));
      const current = arrived ? order[j] : j > 0 ? order[j - 1] : null;
      if (current !== null) states[current] = "current";
      cursor.visible = p < ph.end + 0.004 && p < 0.23;

      const values = order.slice(0, visitedCount).map((id) => nodes[id].value);
      status = `${NAMES[ph.kind]}   ${values.length ? values.join("  ") : "starting at the root"}`;
      if (p >= 0.23) states.forEach((_, i) => (states[i] = "visited"));
    }

    nodes.forEach((n) => visuals[n.id].set(states[n.id], visuals[n.id].targetScale));
    edges.forEach((e, child) => e.set(edgeStates.get(child) ?? "idle"));
    return status;
  }

  function tick(k: number, dt: number, field: HoverField | null) {
    visuals.forEach((v) => v.update(k, dt, field));
    edges.forEach((e, child) => {
      const parent = nodes[child].parent as number;
      e.place(visuals[parent].object.position, visuals[child].object.position);
      e.grow(growth.get(child) ?? 0);
      e.update(k);
    });
  }

  return { group, labels, update, tick };
}
