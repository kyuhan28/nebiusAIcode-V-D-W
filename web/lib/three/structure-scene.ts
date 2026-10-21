import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addEnvironment, createComposer, createRenderer, disposeObject } from "./core";
import { createIdentifierLabel } from "./identifier-label";
import { createInfiniteGrid, floorBelow } from "./journey/grid";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EdgeVisual, JOURNEY, NodeVisual, boxKit, edgeGeometry, nodeMaterial, sphereKit } from "./journey/visuals";
import type { StructureView } from "../trace/structures";
import { attachWasd } from "./wasd";

type Entry = { v: NodeVisual; sub: HTMLDivElement; target: THREE.Vector3; alive: boolean; exiting?: boolean };

/* Stack and queue spacing, matching the intro's tube and track. */
const PLATE_GAP = 0.61;
const CUBE_GAP = 1.2;
const seqCapacity = (view: StructureView) => Math.max(view.capacity ?? 0, view.nodes.length, 4);
const tubeHeight = (cap: number) => cap * PLATE_GAP + 0.5;

/* Matrix cells are evenly spaced like array cells, with room for row and column indices. */
const GRID_GAP = 1.12;

/* Map tables: rows of key -> value, wrapping into more column pairs for big maps. */
const ROW_GAP = 1.05;
const GROUP_WIDTH = 6.4;
const mapShape = (entries: number) => {
  const groups = Math.max(1, Math.ceil(entries / 12));
  return { groups, perGroup: Math.max(1, Math.ceil(entries / groups)) };
};
/**
 * Removes an object and the HTML of every label inside it. three.js only cleans up a label's
 * element when the label itself is removed, so labels on a removed node would otherwise be
 * left floating where the node used to be.
 */
function removeWithLabels(parent: THREE.Object3D, obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove();
  });
  parent.remove(obj);
}

type EdgeEntry = { e: EdgeVisual; head: THREE.Mesh | null; from: string; to: string; label: CSS2DObject | null; alive: boolean };

function tag(text: string, style: Partial<CSSStyleDeclaration>) {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, { userSelect: "none", whiteSpace: "nowrap", pointerEvents: "none", ...style });
  return { el, obj: new CSS2DObject(el) };
}

const graphCache = new Map<string, Map<string, THREE.Vector3>>();
/* The previous layout, so adding an edge nudges the graph instead of rebuilding it. One per layer. */
export type GraphMemory = { last: Map<string, [number, number]> };
const defaultMemory: GraphMemory = { last: new Map() };

/**
 * Lays out each connected component on its own with a fixed edge length, then places the
 * components side by side. Scaling everything to fit at once crushed each component into a
 * clump whenever the graph had more than one. Cached per graph shape.
 */
export function graphLayout(view: StructureView, memory: GraphMemory = defaultMemory): Map<string, THREE.Vector3> {
  const lastGraph = memory.last;
  const key = view.nodes.map((n) => n.id).join(",") + "|" + view.edges.map((e) => `${e.from}-${e.to}`).join(",");
  const cached = graphCache.get(key);
  if (cached) return cached;
  const ids = view.nodes.map((x) => x.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const parent = ids.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links: [number, number][] = [];
  for (const e of view.edges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    links.push([a, b]);
    parent[find(a)] = find(b);
  }
  const groups = new Map<number, number[]>();
  ids.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  const edgeLen = view.edges.some((e) => e.label) ? 3.4 : 2.6;
  const placed: { members: number[]; pts: [number, number][]; w: number; h: number }[] = [];
  for (const members of [...groups.values()].sort((a, b) => a[0] - b[0])) {
    const local = new Map(members.map((m, i) => [m, i]));
    const mine = links.filter(([a]) => local.has(a)).map(([a, b]) => [local.get(a)!, local.get(b)!] as [number, number]);
    const n = members.length;
    /* Start on a circle in depth-first order: walking along paths and around cycles puts each
       edge between neighbors on the circle, so layouts open up without crossings. */
    const adjL = members.map(() => [] as number[]);
    for (const [a, b] of mine) { adjL[a].push(b); adjL[b].push(a); }
    const orderL: number[] = [];
    const seenL = new Set<number>([0]);
    const walk = (u: number) => {
      orderL.push(u);
      for (const w of adjL[u].sort((x, y) => x - y)) if (!seenL.has(w)) { seenL.add(w); walk(w); }
    };
    walk(0);
    const p: [number, number][] = members.map(() => [0, 0]);
    orderL.forEach((li, k) => {
      const a = (k / Math.max(n, 1)) * Math.PI * 2;
      p[li] = [Math.cos(a), Math.sin(a)];
    });
    if (n > 1) {
      let temp = 0.6;
      for (let it = 0; it < 300; it++) {
        const d = p.map(() => [0, 0]);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          let dx = p[i][0] - p[j][0], dy = p[i][1] - p[j][1];
          if (Math.hypot(dx, dy) < 1e-4) { dx = Math.cos(i + j * 1.3) * 1e-3; dy = Math.sin(i + j * 1.3) * 1e-3; }
          const dist = Math.max(Math.hypot(dx, dy), 0.01);
          const f = 1 / dist;
          d[i][0] += (dx / dist) * f; d[i][1] += (dy / dist) * f;
          d[j][0] -= (dx / dist) * f; d[j][1] -= (dy / dist) * f;
        }
        for (const [a, b] of mine) {
          const dx = p[a][0] - p[b][0], dy = p[a][1] - p[b][1];
          const dist = Math.max(Math.hypot(dx, dy), 0.01);
          const f = dist * dist;
          d[a][0] -= (dx / dist) * f; d[a][1] -= (dy / dist) * f;
          d[b][0] += (dx / dist) * f; d[b][1] += (dy / dist) * f;
        }
        for (let i = 0; i < n; i++) {
          const len = Math.max(Math.hypot(d[i][0], d[i][1]), 0.01);
          p[i][0] += (d[i][0] / len) * Math.min(len, temp);
          p[i][1] += (d[i][1] / len) * Math.min(len, temp);
        }
        temp *= 0.985;
      }
      /* Scale so a typical edge has the target length, so every component reads at the same size. */
      const lens = mine.map(([a, b]) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1])).sort((x, y) => x - y);
      const typical = lens.length ? lens[Math.floor(lens.length / 2)] : 1;
      const scale = edgeLen / Math.max(typical, 0.05);
      const cx = p.reduce((s2, q) => s2 + q[0], 0) / n, cy = p.reduce((s2, q) => s2 + q[1], 0) / n;
      for (const q of p) { q[0] = (q[0] - cx) * scale; q[1] = (q[1] - cy) * scale; }
      /* Turn (and if needed mirror) the fresh layout to best match the previous step, so the graph
         keeps its orientation instead of spinning as edges are added. */
      const shared = members.map((m, i) => [i, lastGraph.get(ids[m])] as const).filter((x): x is readonly [number, [number, number]] => !!x[1]);
      if (shared.length >= 2) {
        const qx = shared.reduce((t, [, q]) => t + q[0], 0) / shared.length, qy = shared.reduce((t, [, q]) => t + q[1], 0) / shared.length;
        const px0 = shared.reduce((t, [i]) => t + p[i][0], 0) / shared.length, py0 = shared.reduce((t, [i]) => t + p[i][1], 0) / shared.length;
        let best: { err: number; flip: number; c: number; s: number } | null = null;
        for (const flip of [1, -1]) {
          let sxx = 0, sxy = 0;
          for (const [i, q] of shared) {
            const ax = p[i][0] - px0, ay = (p[i][1] - py0) * flip, bx = q[0] - qx, by = q[1] - qy;
            sxx += ax * bx + ay * by;
            sxy += ax * by - ay * bx;
          }
          const th = Math.atan2(sxy, sxx), c = Math.cos(th), sn = Math.sin(th);
          let err = 0;
          for (const [i, q] of shared) {
            const ax = p[i][0] - px0, ay = (p[i][1] - py0) * flip;
            err += (ax * c - ay * sn - (q[0] - qx)) ** 2 + (ax * sn + ay * c - (q[1] - qy)) ** 2;
          }
          if (!best || err < best.err - 1e-6) best = { err, flip, c, s: sn };
        }
        for (const q of p) {
          const ax = q[0] - px0, ay = (q[1] - py0) * best!.flip;
          q[0] = ax * best!.c - ay * best!.s;
          q[1] = ax * best!.s + ay * best!.c;
        }
      }
    } else p[0] = [0, 0];
    const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
    placed.push({ members, pts: p, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  /* Place components left to right, wrapping into rows, with clear gaps between them. */
  const gap = 2.4, rowMax = 22;
  const out = new Map<string, THREE.Vector3>();
  let x = 0, y = 0, rowH = 0;
  const rows: { items: { c: (typeof placed)[number]; x: number; y: number }[]; w: number }[] = [{ items: [], w: 0 }];
  for (const c of placed) {
    if (x > 0 && x + c.w > rowMax) { y -= rowH + gap; x = 0; rowH = 0; rows.push({ items: [], w: 0 }); }
    rows.at(-1)!.items.push({ c, x: x + c.w / 2, y });
    x += c.w + gap;
    rows.at(-1)!.w = x - gap;
    rowH = Math.max(rowH, c.h);
  }
  const totalH = -y;
  const next = new Map<string, [number, number]>();
  for (const row of rows) for (const { c, x: ox, y: oy } of row.items) {
    const xs = c.pts.map((q) => q[0]), ys = c.pts.map((q) => q[1]);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    c.members.forEach((m, i) => {
      const px = ox - row.w / 2 + (c.pts[i][0] - mx), py = oy + totalH / 2 + (c.pts[i][1] - my);
      out.set(ids[m], new THREE.Vector3(px, py, Math.sin(m * 1.7) * 0.5));
      /* Remember where each vertex really is, so separate components never share a starting point. */
      next.set(ids[m], [px, py]);
    });
  }
  memory.last = next;
  graphCache.set(key, out);
  return out;
}

/** Where each node should sit for a given kind of structure. Exported for tests. */
export function layout(view: StructureView, memory?: GraphMemory): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>();
  const n = view.nodes.length;
  if (view.kind === "tree" && view.tree) {
    const maxDepth = Math.max(0, ...Object.values(view.tree).map((t) => t.depth));
    const count = Object.keys(view.tree).length;
    for (const [id, t] of Object.entries(view.tree)) pos.set(id, new THREE.Vector3((t.x - (count - 1) / 2) * 1.35, (maxDepth / 2 - t.depth) * 1.65, -t.depth * 0.4));
  } else if (view.kind === "list") {
    const linked = view.nodes.filter((x) => x.state !== "special");
    linked.forEach((node, i) => pos.set(node.id, new THREE.Vector3((i - (linked.length - 1) / 2) * 2.1, 0, 0)));
    view.nodes.filter((x) => x.state === "special").forEach((node, i) => pos.set(node.id, new THREE.Vector3(((linked.length - 1) / 2) * 2.1 + i * 2.1, -1.9, 0.6)));
  } else if (view.kind === "graph") {
    return graphLayout(view, memory);
  } else if (view.kind === "stack") {
    /* Plates stack from the bottom of the tube upward. */
    const bottom = -tubeHeight(seqCapacity(view)) / 2;
    view.nodes.forEach((node, i) => pos.set(node.id, new THREE.Vector3(0, bottom + 0.33 + i * PLATE_GAP, 0)));
  } else if (view.kind === "queue") {
    /* Cubes line up from the front (left) toward the back (right). */
    const x0 = -((seqCapacity(view) - 1) * CUBE_GAP) / 2;
    view.nodes.forEach((node, i) => pos.set(node.id, new THREE.Vector3(x0 + i * CUBE_GAP, 0, 0)));
  } else if (view.kind === "map") {
    const keys = view.order ?? [];
    const { groups, perGroup } = mapShape(keys.length);
    keys.forEach((k, e) => {
      const g = Math.floor(e / perGroup), r = e % perGroup;
      const x0 = (g - (groups - 1) / 2) * GROUP_WIDTH;
      const y = ((perGroup - 1) / 2 - r) * ROW_GAP - 0.3;
      pos.set(`k:${k}`, new THREE.Vector3(x0 - 1.6, y, 0));
      pos.set(`v:${k}`, new THREE.Vector3(x0 + 1.75, y, 0));
    });
  } else if (view.kind === "array") {
    const n = view.nodes.length, per = n > 16 ? 10 : Math.max(n, 1);
    view.nodes.forEach((node, i) => pos.set(node.id, new THREE.Vector3(((i % per) - (per - 1) / 2) * 1.2, -Math.floor(i / per) * 2.0, 0)));
  } else if (view.kind === "set") {
    /* Elements in rows of six inside the board; spacing leaves room for bucket labels. */
    const n = view.nodes.length, cols = Math.min(6, Math.max(n, 1)), rows = Math.ceil(n / cols);
    view.nodes.forEach((node, i) => pos.set(node.id, new THREE.Vector3(((i % cols) - (cols - 1) / 2) * 2.0, ((rows - 1) / 2 - Math.floor(i / cols)) * 1.6, 0)));
  } else if (view.kind === "grid" && view.grid) {
    /* Row r is the r-th row from the top and column c the c-th from the left, like the Java array. */
    const { rows, cols } = view.grid;
    for (const node of view.nodes) {
      const [r, c] = node.id.slice(1).split(",").map(Number);
      pos.set(node.id, new THREE.Vector3((c - (cols - 1) / 2) * GRID_GAP, ((rows - 1) / 2 - r) * GRID_GAP, 0));
    }
  } else if (view.kind === "points") {
    /* Real coordinates, scaled to a comfortable size; y stays up. */
    const ps = view.nodes.filter((x) => x.pos).map((x) => x.pos!);
    const minX = Math.min(...ps.map((p) => p[0])), maxX = Math.max(...ps.map((p) => p[0]));
    const minY = Math.min(...ps.map((p) => p[1])), maxY = Math.max(...ps.map((p) => p[1]));
    const scale = 10 / Math.max(maxX - minX, maxY - minY, 1e-6);
    for (const node of view.nodes) {
      if (!node.pos) continue;
      pos.set(node.id, new THREE.Vector3((node.pos[0] - (minX + maxX) / 2) * scale, (node.pos[1] - (minY + maxY) / 2) * scale, node.id.startsWith("c") ? 0.3 : 0));
    }
  } else {
    const cols = Math.min(4, Math.max(1, n));
    view.nodes.forEach((node, i) => pos.set(node.id, new THREE.Vector3(((i % cols) - (cols - 1) / 2) * 2.7, -Math.floor(i / cols) * 1.5, 0)));
  }
  return pos;
}

/**
 * Draws a tree, linked list, graph, or map from a recorded execution. Node identity is stable
 * across steps, so nodes glide to new positions as the structure changes.
 */
export function createStructureScene(container: HTMLElement, fontFamily: string) {
  const renderer = createRenderer(container);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 24, 80);
  const envMap = addEnvironment(renderer, scene);
  scene.environmentIntensity = 0.6;
  /* The same white grid floor as the landing page, under the structures. */
  const FLOOR_Y = -4.2;
  const grid = createInfiniteGrid(FLOOR_Y);
  scene.add(grid.mesh);
  /* Where the floor is heading: it drops under tall content, see keepAboveFloor. */
  let floorGoal = FLOOR_Y;
  const stillFloor = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const spheres = sphereKit(0.44);
  const treeSpheres = sphereKit(0.44, false);
  const cells = boxKit(0.92, 0.92, 0.45, 0.1);
  const dots = sphereKit(0.26, false);
  const centroids = sphereKit(0.42, false);
  const plates = boxKit(1.5, 0.5, 1.2, 0.1);
  const mapKeys = boxKit(2.2, 0.78, 0.7, 0.12);
  const mapValues = boxKit(1.5, 0.78, 0.7, 0.12);
  const cubes = boxKit(0.9, 0.9, 0.9, 0.12);

  const boxes = boxKit(1.15, 0.8, 0.8, 0.12);
  const edgeGeo = edgeGeometry(0.035);
  const sleeveGeo = edgeGeometry(0.11);
  const coneGeo = new THREE.ConeGeometry(0.11, 0.26, 18);

  const pointerMat = new THREE.MeshStandardMaterial({ color: JOURNEY.current, emissive: new THREE.Color(JOURNEY.current), emissiveIntensity: 0.8 });
  const pointerCone = new THREE.ConeGeometry(0.15, 0.32, 24).rotateX(Math.PI);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.6;
  const composer = createComposer(renderer, scene, camera, { strength: 0.5, radius: 0.4, threshold: 0.86 });

  const bounds = new THREE.Box3();
  const camGoal = new THREE.Vector3(0, 2, 14);
  const lookGoal = new THREE.Vector3();
  let fitPending = true;
  /*
   * The camera is framed once, when the first content appears; after that it is the user's.
   * Steps never move it; only Reset view (resetView) frames the scene again.
   */
  let framed = false;
  /* Set once the user drags, zooms, or walks; until then, resizing keeps the first framing fitted. */
  let userMoved = false;

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labels.setSize(w, h);
    composer.setSize(w, h);
  };
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    /* Until the user takes the camera, keep the starting view fitted to the panel's new shape. */
    if (framed && !userMoved) fit(true);
  });
  ro.observe(container);
  /* Stop auto-framing once the user takes the camera, by dragging or by walking. */
  controls.addEventListener("start", () => {
    fitPending = false;
    userMoved = true;
  });
  const wasd = attachWasd(renderer.domElement, container, camera, controls, () => {
    fitPending = false;
    userMoved = true;
  });

  /* ---------------- One layer per data structure ---------------- */
  type Layer = ReturnType<typeof makeLayer>;
  function makeLayer() {
    const root = new THREE.Group();
    scene.add(root);
    const offset = new THREE.Vector3();
    const graphMemory: GraphMemory = { last: new Map() };
    let title = "";
  /* The tube or track, rebuilt only when the kind or capacity changes. */
  let decor: { key: string; group: THREE.Group; box: THREE.Box3 } | null = null;
  const clearDecor = () => {
    if (!decor) return;
    removeWithLabels(root, decor.group);
    decor.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
    });
    decor = null;
  };
  /** Returns true when the tube or track was (re)built, so the camera reframes only then. */
  const decorFor = (view: StructureView): boolean => {
    if (view.kind !== "stack" && view.kind !== "queue" && view.kind !== "map" && view.kind !== "grid" && view.kind !== "set") {
      clearDecor();
      return false;
    }
    const cap = seqCapacity(view);
    const shape = mapShape((view.order ?? []).length);
    const setShape = view.kind === "set" ? `${Math.min(6, Math.max(view.nodes.length, 1))}:${Math.ceil(view.nodes.length / Math.min(6, Math.max(view.nodes.length, 1)))}` : "";
    const key = view.kind === "set" ? `set:${setShape}:${view.note}` : view.kind === "map" ? `map:${shape.groups}:${shape.perGroup}:${view.buckets ? "b" : ""}` : view.kind === "grid" ? `grid:${view.grid?.lengths.join(",")}` : `${view.kind}:${cap}`;
    if (decor?.key === key) return false;
    clearDecor();
    const group = new THREE.Group();
    const caption = (text: string, x: number, y: number, z: number) => {
      const t = tag(text, { font: `500 14px ${fontFamily}`, color: "#7d8aa6", letterSpacing: "0.04em" });
      t.obj.position.set(x, y, z);
      group.add(t.obj);
    };
    if (view.kind === "set") {
      const n = view.nodes.length, cols = Math.min(6, Math.max(n, 1)), rows = Math.max(1, Math.ceil(n / cols));
      const w = cols * 2.0 + 1.2, h = rows * 1.6 + 1.4;
      const board = new THREE.Mesh(
        new RoundedBoxGeometry(w, h, 0.12, 3, 0.05),
        new THREE.MeshStandardMaterial({ color: "#0a0f1e", metalness: 0.3, roughness: 0.55, transparent: true, opacity: 0.82 }),
      );
      board.position.set(0, 0.25, -0.6);
      group.add(board);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, 0.12)), new THREE.LineBasicMaterial({ color: "#2b3a5c" }));
      frame.position.copy(board.position);
      group.add(frame);
      caption(view.note ?? "", 0, h / 2 + 0.55, 0);
    } else if (view.kind === "grid" && view.grid) {
      /* Row indices down the left side and column indices across the top, zero-based like Java. */
      const { rows, cols } = view.grid;
      const left = (-(cols - 1) / 2) * GRID_GAP - 0.95, top = ((rows - 1) / 2) * GRID_GAP + 0.85;
      for (let r = 0; r < rows; r++) caption(String(r), left, ((rows - 1) / 2 - r) * GRID_GAP, 0);
      for (let c = 0; c < cols; c++) caption(String(c), (c - (cols - 1) / 2) * GRID_GAP, top, 0);
      caption("row", left, top, 0);
    } else if (view.kind === "map") {
      /* A dark glass board floating in space, with column headers and faint row lines. */
      const { groups, perGroup } = shape;
      /* Leave room on the left for the bucket column when the map has real bucket indices. */
      const w = groups * GROUP_WIDTH + 0.4 + (view.buckets ? 1.7 : 0);
      const top = ((perGroup - 1) / 2) * ROW_GAP - 0.3 + ROW_GAP / 2;
      const bottom = top - perGroup * ROW_GAP;
      const h = top - bottom + 1.1;
      const cy = (top + 0.9 + bottom) / 2;
      const board = new THREE.Mesh(
        new RoundedBoxGeometry(w, h, 0.12, 3, 0.05),
        new THREE.MeshStandardMaterial({ color: "#0a0f1e", metalness: 0.3, roughness: 0.55, transparent: true, opacity: 0.82 }),
      );
      board.position.set(view.buckets ? -0.85 : 0, cy, -0.6);
      group.add(board);
      const frame = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, 0.12)),
        new THREE.LineBasicMaterial({ color: "#2b3a5c", transparent: true, opacity: 0.9 }),
      );
      frame.position.copy(board.position);
      group.add(frame);
      const lines: number[] = [];
      for (let g = 0; g < groups; g++) {
        const x0 = (g - (groups - 1) / 2) * GROUP_WIDTH;
        for (let r = 0; r <= perGroup; r++) {
          const y = top - r * ROW_GAP;
          lines.push(x0 - 3, y, -0.52, x0 + 3, y, -0.52);
        }
        if (g > 0) lines.push(x0 - GROUP_WIDTH / 2, top + 0.7, -0.52, x0 - GROUP_WIDTH / 2, bottom, -0.52);
        caption("key", x0 - 1.6, top + 0.42, 0);
        if (view.buckets) caption("bucket", x0 - 3.45, top + 0.42, 0);
        caption("value", x0 + 1.75, top + 0.42, 0);
      }
      const rule = new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(lines, 3)),
        new THREE.LineBasicMaterial({ color: "#1a2440", transparent: true, opacity: 0.9 }),
      );
      group.add(rule);
    } else if (view.kind === "stack") {
      const h = tubeHeight(cap);
      const tube = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, h, 1.5)),
        new THREE.LineBasicMaterial({ color: "#3a4355", transparent: true, opacity: 0.9 }),
      );
      group.add(tube);
      const base = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.16, 1.7, 3, 0.05), nodeMaterial(JOURNEY.graphiteLight));
      base.position.y = -h / 2 - 0.08;
      group.add(base);
      caption("top of the stack", 0, h / 2 + 0.35, 0);
    } else {
      const len = cap * CUBE_GAP + 1.6;
      const track = new THREE.Mesh(new RoundedBoxGeometry(len, 0.14, 1.4, 3, 0.05), nodeMaterial(JOURNEY.graphiteLight));
      track.position.y = -0.52;
      group.add(track);
      /* Arrows along the track show the direction of travel: toward the front. */
      const arrowMat = new THREE.MeshBasicMaterial({ color: "#2a3448" });
      for (let i = 0; i < Math.max(2, Math.floor(cap / 2)); i++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), arrowMat);
        cone.rotation.z = Math.PI / 2;
        cone.position.set(-len / 2 + 0.9 + i * ((len - 1.8) / Math.max(1, Math.floor(cap / 2) - 1 || 1)), -0.43, 0.62);
        group.add(cone);
      }
      caption("front: leaves here", -len / 2 + 0.2, -0.95, 0.6);
      caption("back: joins here", len / 2 - 0.2, -0.95, 0.6);
    }
    /* Measured before it joins the layer, so the box is in the layer's own coordinates. */
    const box = new THREE.Box3().setFromObject(group);
    root.add(group);
    decor = { key, group, box };
    return true;
  };
  const nodes = new Map<string, Entry>();
  const edges = new Map<string, EdgeEntry>();
  let kind: StructureView["kind"] | null = null;
  const pointers = new Map<string, { group: THREE.Group; target: THREE.Vector3 }>();

    /* The structure's floating identifier ("scores : Map<String, Integer>") and its loop badge. */
    const titleTag = createIdentifierLabel(fontFamily);
    const badgeTag = tag("", { font: `500 13px ${fontFamily}`, color: "#9ee8ff" });
    /* Anchor by the left edge: the label renderer centers labels on their point otherwise. */
    badgeTag.obj.center.set(0, 0.5);
    root.add(titleTag.obj, badgeTag.obj);

    /** Everything this layer occupies, in its own coordinates; withTitle reserves room for the title. */
    function localBounds(withTitle = true) {
      const box = new THREE.Box3();
      nodes.forEach((n) => n.alive && box.expandByPoint(n.target));
      if (decor) box.union(decor.box);
      /* Pointer markers float above their nodes; keep titles clear of them. */
      pointers.forEach((p) => p.group.visible && box.expandByPoint(p.target.clone().add(new THREE.Vector3(0, 0.55, 0))));
      if (!box.isEmpty()) {
        box.expandByScalar(0.6);
        if (title && withTitle) box.max.y += badgeTag.obj.visible ? 2.0 : 1.4;
      }
      return box;
    }
    function nodeFor(id: string, isBox: boolean) {
      let entry = nodes.get(id);
      if (entry) return entry;
      const kit =
        kind === "set" ? mapValues
        : kind === "map" ? (id.startsWith("k:") ? mapKeys : mapValues)
        : kind === "stack" ? plates
      : kind === "array" ? cubes
        : kind === "queue" ? cubes
        : kind === "grid" ? cells
        : kind === "points" ? (id.startsWith("c") ? centroids : dots)
        : isBox ? boxes : kind === "tree" ? treeSpheres : spheres;
      const v = new NodeVisual(kit, nodes.size + 3);
      v.glowScale = isBox ? 0.75 : 1;
      const value = tag("", { font: `600 clamp(13px, 2.3vmin, 19px) ${fontFamily}`, color: JOURNEY.white, textShadow: "0 0 6px rgba(0,0,0,0.95)" });
      value.obj.position.set(0, 0, kind === "map" ? 0.37 : kind === "stack" ? 0.62 : kind === "queue" || kind === "array" ? 0.47 : kind === "grid" ? 0.24 : isBox ? 0.42 : 0);
      v.label = value.el;
      v.object.add(value.obj);
      const sub = tag("", { font: `500 14px ${fontFamily}`, color: "#9aa3b5" });
      /* Bucket labels sit left of map keys; everything else keeps its label underneath. */
      if (kind === "map" && id.startsWith("k:")) sub.obj.position.set(-1.85, 0, 0);
      else sub.obj.position.set(0, isBox ? -0.7 : -0.78, 0);
      v.object.add(sub.obj);
      root.add(v.object);
      entry = { v, sub: sub.el, target: new THREE.Vector3(), alive: true };
      nodes.set(id, entry);
      return entry;
    }

    function setView(view: StructureView | null): boolean {
      if (!["stack", "queue", "map", "grid", "set"].includes((view?.kind ?? kind) as string)) clearDecor();
      if (view && kind !== null && view.kind !== kind) {
        nodes.forEach((n) => removeWithLabels(root, n.v.object));
        nodes.clear();
        edges.forEach((e) => { root.remove(e.e.mesh); if (e.head) root.remove(e.head); if (e.label) removeWithLabels(root, e.label); });
        edges.clear();
      }
      kind = view?.kind ?? kind;
      const before = nodes.size;
      nodes.forEach((n) => (n.alive = false));
      edges.forEach((e) => (e.alive = false));
      if (!view) return false;

      const isBox = view.kind === "list" || view.kind === "map" || view.kind === "grid" || view.kind === "stack" || view.kind === "queue" || view.kind === "set" || view.kind === "array";
      const rebuilt = decorFor(view);
      const pos = layout(view, graphMemory);
      for (const n of view.nodes) {
        const entry = nodeFor(n.id, isBox);
        entry.alive = true;
        entry.exiting = false;
        entry.target.copy(pos.get(n.id) ?? new THREE.Vector3());
        if (entry.v.object.scale.x < 0.01) {
          /* New plates drop into the tube from above; new cubes slide in from the back of the track. */
          const spawn = view.kind === "stack" ? new THREE.Vector3(0, 2.6, 0) : view.kind === "queue" ? new THREE.Vector3(2.6, 0, 0) : view.kind === "map" ? new THREE.Vector3(2.2, 0, 0) : new THREE.Vector3(0, 1.2, 0);
          entry.v.base.copy(entry.target).add(spawn);
        }
        if (entry.v.label) entry.v.label.textContent = n.label;
        entry.sub.textContent = n.sub ?? "";
        entry.v.set(n.state, 1, n.tint);
      }
      /* Popped plates lift out of the top; dequeued cubes slide off the front. */
      if (view.kind === "stack" || view.kind === "queue" || view.kind === "map") {
        const cap = seqCapacity(view);
        nodes.forEach((n) => {
          if (n.alive || n.exiting) return;
          n.exiting = true;
          if (view.kind === "stack") n.target.set(0, tubeHeight(cap) / 2 + 1.4, 0);
          else if (view.kind === "queue") n.target.set(-((cap - 1) * CUBE_GAP) / 2 - 2.4, 0, 0);
          else n.target.add(new THREE.Vector3(2.6, 0, 0));
        });
      }
      for (const ed of view.edges) {
        const key = view.kind === "graph" && !view.directed ? [ed.from, ed.to].sort().join("|") : `${ed.from}>${ed.to}`;
        let entry = edges.get(key);
        if (!entry) {
          const e = new EdgeVisual(edgeGeo, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), sleeveGeo);
          root.add(e.mesh);
          const head = view.kind === "list" || view.directed ? new THREE.Mesh(coneGeo, e.material) : null;
          if (head) root.add(head);
          const label = ed.label ? tag(ed.label, { font: `500 14px ${fontFamily}`, color: "#7d8aa6" }).obj : null;
          if (label) root.add(label);
          entry = { e, head, from: ed.from, to: ed.to, label, alive: true };
          edges.set(key, entry);
        }
        entry.from = ed.from;
        entry.to = ed.to;
        entry.alive = true;
        entry.e.set(ed.state);
      }

      const used = new Set<string>();
      const stack = new Map<string, number>();
      for (const p of view.pointers) {
        const host = pos.get(p.nodeId);
        if (!host) continue;
        let marker = pointers.get(p.name);
        if (!marker) {
          const group = new THREE.Group();
          group.add(new THREE.Mesh(pointerCone, pointerMat));
          const t = tag(p.name, { font: `italic 600 15px ${fontFamily}`, color: JOURNEY.current });
          t.obj.position.set(0, 0.4, 0);
          group.add(t.obj);
          root.add(group);
          marker = { group, target: new THREE.Vector3() };
          group.position.copy(host).add(new THREE.Vector3(0, 1.2, 0));
          pointers.set(p.name, marker);
        }
        const level = stack.get(p.nodeId) ?? 0;
        stack.set(p.nodeId, level + 1);
        marker.target.copy(host).add(new THREE.Vector3(0, (isBox ? 0.95 : 1.05) + level * 0.8, 0));
        marker.group.visible = true;
        used.add(p.name);
      }
      pointers.forEach((m, name) => (m.group.visible = used.has(name)));
      /* Title and loop badge above the layer's top-left corner. */
      const box = localBounds(false);
      titleTag.set(title);
      badgeTag.el.textContent = view.badge ?? "";
      badgeTag.obj.visible = !!view.badge;
      const top = Number.isFinite(box.max.y) ? box.max.y : 0;
      const left = Number.isFinite(box.min.x) ? box.min.x : 0;
      /* The label's bottom-left corner sits just above the structure (and its badge, when looping). */
      titleTag.obj.position.set(left, top + (view.badge ? 1.3 : 0.75), 0);
      badgeTag.obj.position.set(left, top + 0.95, 0);
      /* Reframe when the shape changes: a new tube or board, or a different number of nodes. */
      if (view.kind === "stack" || view.kind === "queue" || view.kind === "grid") return rebuilt;
      return before === 0 || Math.abs(nodes.size - before) > 0;
    }


    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    function update(dt: number, k: number) {
      root.position.lerp(offset, k);
    nodes.forEach((n, id) => {
        if (!n.alive) n.v.targetScale = 0;
        n.v.base.lerp(n.target, k);
        n.v.update(k, dt, null);
        if (!n.alive && n.v.object.scale.x < 0.02) {
          removeWithLabels(root, n.v.object);
          nodes.delete(id);
        }
      });
      edges.forEach((e, key) => {
        const from = nodes.get(e.from);
        const to = nodes.get(e.to);
        const show = e.alive && !!from && !!to;
        e.e.mesh.visible = show;
        if (e.head) e.head.visible = show;
        if (e.label) e.label.visible = show;
        if (!show) {
          if (!e.alive) {
            root.remove(e.e.mesh);
            if (e.head) root.remove(e.head);
            if (e.label) removeWithLabels(root, e.label);
            edges.delete(key);
          }
          return;
        }
        a.copy(from!.v.object.position);
        b.copy(to!.v.object.position);
        dir.subVectors(b, a).normalize();
        const inset = kind === "list" ? 0.62 : kind === "points" ? 0.3 : 0.46;
        /* Map arrows run from the key cell's right edge to the value cell's left edge. */
        a.addScaledVector(dir, kind === "map" ? 1.14 : inset);
        b.addScaledVector(dir, -(kind === "map" ? 0.8 : inset) - (e.head ? 0.14 : 0));
        e.e.place(a, b);
        e.e.grow(1);
        e.e.update(k);
        if (e.head) {
          e.head.position.copy(b).addScaledVector(dir, 0.1);
          e.head.quaternion.setFromUnitVectors(UP, dir);
        }
        /* Directed labels sit nearer their source, so opposite edges (1 to 3, 3 to 1) don't collide. */
        if (e.label) e.label.position.lerpVectors(from!.v.object.position, to!.v.object.position, e.head ? 0.36 : 0.5).add(new THREE.Vector3(0, 0.25, 0));
      });
      pointers.forEach((p) => p.group.position.lerp(p.target, k));
    }

    return {
      root,
      offset,
      localBounds,
      update,
      setView(view: StructureView | null, name = "") {
        title = name;
        return setView(view);
      },
      dispose() {
        removeWithLabels(scene, root);
      },
    };
  }

  const layers = new Map<string, Layer>();
  /* Lay layers out left to right, wrapping into rows, each centered on its own bounds. */
  function arrange() {
    const list = [...layers.values()];
    const gap = 3.2, rowMax = 34;
    let x = 0, y = 0, rowH = 0;
    const rows: { items: { l: Layer; box: THREE.Box3; x: number }[]; w: number; y: number; h: number }[] = [{ items: [], w: 0, y: 0, h: 0 }];
    for (const l of list) {
      const box = l.localBounds();
      if (box.isEmpty()) box.set(new THREE.Vector3(-1, -1, 0), new THREE.Vector3(1, 1, 0));
      const w = box.max.x - box.min.x, h = box.max.y - box.min.y + 1.6;
      if (x > 0 && x + w > rowMax) { y -= rowH + gap; x = 0; rowH = 0; rows.push({ items: [], w: 0, y, h: 0 }); }
      const row = rows.at(-1)!;
      row.items.push({ l, box, x });
      x += w + gap;
      row.w = x - gap;
      rowH = Math.max(rowH, h);
      row.h = rowH;
    }
    for (const row of rows) for (const it of row.items) {
      const cx = (it.box.min.x + it.box.max.x) / 2, cy = (it.box.min.y + it.box.max.y) / 2;
      it.l.offset.set(it.x - row.w / 2 + (it.box.max.x - it.box.min.x) / 2 - cx, row.y - cy, 0);
    }
  }

  /*
   * The floor stays under everything drawn. When a tall table, matrix, or tree reaches down to it, it
   * drops to stay 1 unit below the lowest point. It never rises during a run, so it does not bob as a
   * structure grows and shrinks; it returns to its usual height when the scene is cleared.
   */
  const contentBox = new THREE.Box3();
  function keepAboveFloor() {
    if (layers.size === 0) { floorGoal = FLOOR_Y; return; }
    contentBox.makeEmpty();
    layers.forEach((l) => {
      const box = l.localBounds();
      if (!box.isEmpty()) contentBox.union(box.clone().translate(l.offset));
    });
    if (!contentBox.isEmpty()) floorGoal = Math.min(floorGoal, floorBelow(contentBox.min.y, FLOOR_Y, 1));
  }

  function setViews(list: { key: string; title?: string; view: StructureView | null }[]) {
    const keys = new Set(list.map((x) => x.key));
    layers.forEach((l, key) => {
      if (!keys.has(key)) { l.dispose(); layers.delete(key); }
    });
    for (const item of list) {
      let l = layers.get(item.key);
      if (!l) { l = makeLayer(); layers.set(item.key, l); }
      l.setView(item.view, item.title ?? "");
    }
    arrange();
    keepAboveFloor();
    /* Only the first content is framed automatically; from then on the camera stays where it is. */
    if (!framed) framed = fit(true);
  }
  function setView(view: StructureView | null, title = "") {
    setViews(view ? [{ key: "main", title, view }] : []);
  }

  /**
   * Frames everything currently in the scene. The first framing is instant and leaves extra room,
   * since structures usually grow as the program runs; Reset view glides to a snug fit.
   * Returns false when there is nothing to frame yet.
   */
  const fit = (first = false): boolean => {
    bounds.makeEmpty();
    layers.forEach((l) => {
      const box = l.localBounds();
      if (!box.isEmpty()) bounds.union(box.clone().translate(l.offset));
    });
    if (bounds.isEmpty()) return false;
    /* A wider margin when several layers share the view, so labels at the edges stay inside. */
    const size = bounds.getSize(new THREE.Vector3()).addScalar(layers.size > 1 ? 4 : 2.4);
    if (first) size.multiplyScalar(1.35);
    bounds.getCenter(lookGoal);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(size.y / 2 / tanHalf, size.x / 2 / (tanHalf * camera.aspect), 7);
    camGoal.copy(lookGoal).add(new THREE.Vector3(dist * 0.12, dist * 0.22, dist));
    if (first) {
      camera.position.copy(camGoal);
      controls.target.copy(lookGoal);
      fitPending = false;
    } else fitPending = true;
    return true;
  };

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let frame = 0;
  let last = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const k = 1 - Math.exp(-dt * 8);
    layers.forEach((l) => l.update(dt, k));
    wasd.update(dt);
    if (fitPending) {
      camera.position.lerp(camGoal, 1 - Math.exp(-dt * 3));
      controls.target.lerp(lookGoal, 1 - Math.exp(-dt * 3));
      if (camera.position.distanceTo(camGoal) < 0.05) fitPending = false;
    }
    controls.update();
    grid.update(camera, 1, 80);
    /* Glide to the floor's new height (straight there with reduced motion). */
    grid.mesh.position.y += (floorGoal - grid.mesh.position.y) * (stillFloor ? 1 : 1 - Math.exp(-dt * 4));
    composer.render();
    labels.render(scene, camera);
  };
  camera.position.copy(camGoal);
  frame = requestAnimationFrame(loop);

  return {
    setView,
    setViews,
    resetView: () => {
      userMoved = false;
      fit();
    },
    camera,
    dispose() {
      cancelAnimationFrame(frame);
      ro.disconnect();
      wasd.dispose();
      controls.dispose();
      disposeObject(scene);
      envMap.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labels.domElement.remove();
    },
  };
}
