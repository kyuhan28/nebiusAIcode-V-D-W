import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { connect } from "./core";
import { lighten, seededRandom, toyMaterial } from "./materials";

export type Structure = {
  group: THREE.Group;
  /** Meshes grouped into waves, in the order the structure's algorithm visits them. */
  waves: THREE.Mesh[][];
  label: string;
};

type Color = THREE.ColorRepresentation;

function node(geometry: THREE.BufferGeometry, color: Color, emissive = 0) {
  const mesh = new THREE.Mesh(geometry, toyMaterial(color, emissive));
  mesh.userData.baseScale = 1;
  return mesh;
}

function centerGroup(group: THREE.Group) {
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  group.children.forEach((child) => child.position.sub(center));
}

/* ---------- Trees and tries ---------- */

export type TreeSpec = { children?: TreeSpec[] };

type Placed = { x: number; depth: number; children: Placed[] };

function place(spec: TreeSpec, depth: number, cursor: { x: number }): Placed {
  const children = (spec.children ?? []).map((c) => place(c, depth + 1, cursor));
  let x: number;
  if (children.length === 0) {
    x = cursor.x;
    cursor.x += 1;
  } else {
    x = (children[0].x + children[children.length - 1].x) / 2;
  }
  return { x, depth, children };
}

export function perfectBinary(levels: number): TreeSpec {
  if (levels <= 1) return {};
  return { children: [perfectBinary(levels - 1), perfectBinary(levels - 1)] };
}

export function tree(
  spec: TreeSpec,
  opts: { color: Color; label: string; order?: "in" | "pre"; radius?: number; xGap?: number; yGap?: number; emissive?: number },
): Structure {
  const { color, label, order = "pre", radius = 0.3, xGap = 0.78, yGap = 1.05, emissive = 0 } = opts;
  const group = new THREE.Group();
  const root = place(spec, 0, { x: 0 });
  const sphere = new THREE.SphereGeometry(radius, 32, 24);
  const edgeMat = toyMaterial(lighten(color, 0.3));
  const waves: THREE.Mesh[][] = [];

  const build = (p: Placed): THREE.Mesh => {
    const mesh = node(sphere, color, emissive);
    mesh.position.set(p.x * xGap, -p.depth * yGap, 0);
    group.add(mesh);
    const kids = p.children.map(build);
    kids.forEach((kid) => group.add(connect(mesh.position, kid.position, radius * 0.16, edgeMat)));
    (mesh.userData as { kids: THREE.Mesh[] }).kids = kids;
    return mesh;
  };
  const rootMesh = build(root);

  const walk = (mesh: THREE.Mesh) => {
    const kids = (mesh.userData.kids ?? []) as THREE.Mesh[];
    if (order === "in" && kids.length > 0) {
      walk(kids[0]);
      waves.push([mesh]);
      kids.slice(1).forEach(walk);
    } else {
      waves.push([mesh]);
      kids.forEach(walk);
    }
  };
  walk(rootMesh);

  centerGroup(group);
  return { group, waves, label };
}

/* ---------- Linked list ---------- */

export function linkedList(count: number, color: Color, label = "Linked list, walked head to tail"): Structure {
  const group = new THREE.Group();
  const data = new RoundedBoxGeometry(0.62, 0.5, 0.5, 3, 0.1);
  const pointer = new RoundedBoxGeometry(0.32, 0.5, 0.5, 3, 0.1);
  const shaft = toyMaterial(lighten(color, 0.4));
  const pointerColor = lighten(color, 0.35);
  const cone = new THREE.ConeGeometry(0.09, 0.22, 16);
  const spacing = 1.55;
  const waves: THREE.Mesh[][] = [];

  for (let i = 0; i < count; i++) {
    const x = i * spacing;
    const cell = node(data, color);
    cell.position.set(x, 0, 0);
    const next = node(pointer, pointerColor);
    next.position.set(x + 0.5, 0, 0);
    group.add(cell, next);
    waves.push([cell, next]);

    const start = new THREE.Vector3(x + 0.68, 0, 0);
    const end = i < count - 1 ? new THREE.Vector3(x + spacing - 0.44, 0, 0) : new THREE.Vector3(x + 1.05, 0, 0);
    group.add(connect(start, end, 0.03, shaft));
    const head = new THREE.Mesh(cone, shaft);
    head.position.copy(end).add(new THREE.Vector3(0.1, 0, 0));
    head.rotation.z = -Math.PI / 2;
    group.add(head);
  }
  const nullRing = node(new THREE.TorusGeometry(0.15, 0.05, 16, 40), lighten(color, 0.6));
  nullRing.position.set((count - 1) * spacing + 1.4, 0, 0);
  group.add(nullRing);
  waves.push([nullRing]);

  centerGroup(group);
  return { group, waves, label };
}

/* ---------- Arrays ---------- */

export function arrayRow(values: number[], color: Color, opts: { bars?: boolean; emissive?: number; label?: string } = {}): Structure {
  const { bars = false, emissive = 0 } = opts;
  const label = opts.label ?? (bars ? "Array, mid bubble sort" : "Array, scanned left to right");
  const group = new THREE.Group();
  const size = 0.56;
  const gap = 0.08;
  const max = Math.max(...values);
  const waves: THREE.Mesh[][] = [];
  const cube = new RoundedBoxGeometry(size, size, size, 3, 0.08);

  values.forEach((v, i) => {
    const height = bars ? 0.4 + (v / max) * 2.2 : size;
    const geometry = bars ? new RoundedBoxGeometry(size, height, size, 3, 0.08) : cube;
    const tint = bars ? new THREE.Color(color).lerp(new THREE.Color("#ffffff"), (1 - v / max) * 0.2) : color;
    const mesh = node(geometry, tint, emissive);
    if (bars) {
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.roughness = 0.5;
      mat.clearcoatRoughness = 0.45;
    }
    mesh.position.set(i * (size + gap), height / 2, 0);
    group.add(mesh);
    waves.push([mesh]);
  });

  centerGroup(group);
  return { group, waves, label };
}

/* ---------- Stack ---------- */

export function stack(count: number, color: Color): Structure {
  const group = new THREE.Group();
  const plate = new RoundedBoxGeometry(1.3, 0.26, 0.9, 3, 0.08);
  const waves: THREE.Mesh[][] = [];
  for (let i = 0; i < count; i++) {
    const mesh = node(plate, lighten(color, (i % 2) * 0.25));
    mesh.position.set(0, i * 0.31, 0);
    group.add(mesh);
    waves.unshift([mesh]);
  }
  centerGroup(group);
  return { group, waves, label: "Stack, popped top to bottom" };
}

/* ---------- Graph ---------- */

export function graph(count: number, color: Color, seed: number, emissive = 0): Structure {
  const rand = seededRandom(seed);
  const group = new THREE.Group();
  const sphere = new THREE.SphereGeometry(0.22, 28, 20);
  const edgeMat = toyMaterial(lighten(color, 0.3));
  const points: THREE.Vector3[] = [];
  while (points.length < count) {
    const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).multiplyScalar(1.5);
    if (p.length() < 1.5 && points.every((q) => q.distanceTo(p) > 0.75)) points.push(p);
  }
  const meshes = points.map((p) => {
    const mesh = node(sphere, color, emissive);
    mesh.position.copy(p);
    group.add(mesh);
    return mesh;
  });

  const adjacency: number[][] = points.map(() => []);
  const seen = new Set<string>();
  points.forEach((p, i) => {
    points
      .map((q, j) => ({ j, d: p.distanceTo(q) }))
      .filter(({ j }) => j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        adjacency[i].push(j);
        adjacency[j].push(i);
        group.add(connect(points[i], points[j], 0.035, edgeMat));
      });
  });

  const waves: THREE.Mesh[][] = [];
  const visited = new Set<number>([0]);
  let frontier = [0];
  while (frontier.length > 0) {
    waves.push(frontier.map((i) => meshes[i]));
    const next: number[] = [];
    frontier.forEach((i) =>
      adjacency[i].forEach((j) => {
        if (!visited.has(j)) {
          visited.add(j);
          next.push(j);
        }
      }),
    );
    frontier = next;
  }
  meshes.forEach((m, i) => {
    if (!visited.has(i)) waves.push([m]);
  });

  centerGroup(group);
  return { group, waves, label: "Graph, breadth-first search" };
}

/* ---------- 2D matrix ---------- */

export function matrix(rows: number, cols: number, color: Color): Structure {
  const group = new THREE.Group();
  const size = 0.46;
  const gap = 0.08;
  const cube = new RoundedBoxGeometry(size, size, size, 3, 0.07);
  const waves: THREE.Mesh[][] = Array.from({ length: rows + cols - 1 }, () => []);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mesh = node(cube, lighten(color, ((r + c) % 2) * 0.22));
      mesh.position.set(c * (size + gap), -r * (size + gap), 0);
      group.add(mesh);
      waves[r + c].push(mesh);
    }
  }
  centerGroup(group);
  return { group, waves, label: "Grid, flood fill from the corner" };
}

/* ---------- Bounding frame with a slight color split ---------- */

export function addFrame(structure: Structure) {
  const { group } = structure;
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3()).addScalar(0.45);
  const center = box.getCenter(new THREE.Vector3());
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
  const layers: [string, number, number][] = [
    ["#ffffff", 0, 0.55],
    ["#ff4fd8", 0.035, 0.45],
    ["#3ee6ff", -0.035, 0.45],
  ];
  layers.forEach(([color, offset, opacity]) => {
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
    );
    line.position.copy(center).add(new THREE.Vector3(offset, 0, 0));
    group.add(line);
  });
}

/* ---------- Small single pieces that fill the space ---------- */

export function atom(kind: number, color: Color) {
  const geometries = [
    () => new THREE.SphereGeometry(0.5, 24, 16),
    () => new RoundedBoxGeometry(0.9, 0.9, 0.9, 3, 0.15),
    () => new THREE.TorusGeometry(0.42, 0.16, 16, 40),
    () => new THREE.CapsuleGeometry(0.3, 0.6, 8, 16),
  ];
  return node(geometries[kind % geometries.length](), color);
}
