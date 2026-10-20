import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { QUEUE_FRAMES, STACK_FRAMES } from "../../journey/data";
import type { LinearFrame } from "../../algorithms/linear";
import { ANCHORS, local, phase, smoother } from "../../journey/timeline";
import type { HoverField } from "./hover-field";
import { JOURNEY, LabelSet, NodeVisual, boxKit, nodeMaterial, type NodeKit, type NodeState } from "./visuals";

type Layout = {
  slot: (i: number) => THREE.Vector3;
  spawn: (count: number) => THREE.Vector3;
  exit: (from: THREE.Vector3) => THREE.Vector3;
};

function opText(frame: LinearFrame) {
  const op = frame.op;
  if (!op) return "";
  if (op.kind === "push" || op.kind === "enqueue") return `${op.kind}(${op.value})`;
  return `${op.kind}() returns ${frame.removed?.value}`;
}

export function createLinearChapter() {
  const group = new THREE.Group();
  const labels = new LabelSet();
  const A = new THREE.Vector3(...ANCHORS.linear);
  const floorY = A.y - 1.4;

  /* Stack: a vertical tube. */
  const stackX = A.x - 3.4;
  const tube = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 3.4, 1.5)),
    new THREE.LineBasicMaterial({ color: "#3a4355", transparent: true, opacity: 0.9 }),
  );
  tube.position.set(stackX, floorY + 1.7, A.z);
  group.add(tube);
  const stackBase = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.16, 1.7, 3, 0.05), nodeMaterial(JOURNEY.graphiteLight));
  stackBase.position.set(stackX, floorY - 0.08, A.z);
  group.add(stackBase);
  const stackLayout: Layout = {
    slot: (i) => new THREE.Vector3(stackX, floorY + 0.3 + i * 0.6, A.z),
    spawn: (count) => new THREE.Vector3(stackX, floorY + 0.3 + count * 0.6 + 3.2, A.z),
    exit: (from) => from.clone().add(new THREE.Vector3(0, 3.4, 0)),
  };

  /* Queue: a horizontal track. Items join at the back (right) and leave from the front (left). */
  const queueX = A.x + 0.6;
  const track = new THREE.Mesh(new RoundedBoxGeometry(6, 0.14, 1.4, 3, 0.05), nodeMaterial(JOURNEY.graphiteLight));
  track.position.set(queueX + 2.3, floorY - 0.07, A.z);
  group.add(track);
  const queueLayout: Layout = {
    slot: (i) => new THREE.Vector3(queueX + i * 1.15, floorY + 0.5, A.z),
    spawn: (count) => new THREE.Vector3(queueX + count * 1.15 + 3.2, floorY + 0.5, A.z),
    exit: (from) => from.clone().add(new THREE.Vector3(-3, 0.8, 0)),
  };

  const tags = [
    { text: "stack", at: new THREE.Vector3(stackX, floorY - 0.6, A.z + 0.9) },
    { text: "queue", at: new THREE.Vector3(queueX + 2.3, floorY - 0.6, A.z + 0.9) },
    { text: "front", at: new THREE.Vector3(queueX, floorY - 0.25, A.z + 1.0) },
    { text: "back", at: new THREE.Vector3(queueX + 4.6, floorY - 0.25, A.z + 1.0) },
  ];
  tags.forEach((t) => {
    const { obj } = labels.make(t.text, "small");
    obj.position.copy(t.at);
    group.add(obj);
  });

  const plateKit = boxKit(1.5, 0.5, 1.2, 0.1);
  const cubeKit = boxKit(0.9, 0.9, 0.9, 0.12);

  const makePool = (frames: LinearFrame[], kit: NodeKit, labelZ: number, seed: number) => {
    const ids = new Map<number, number>();
    frames.forEach((f) => f.items.forEach((it) => ids.set(it.id, it.value)));
    const pool = new Map<number, NodeVisual>();
    ids.forEach((value, id) => {
      const v = new NodeVisual(kit, seed + id);
      v.glowScale = 0.6;
      v.targetScale = 0;
      v.object.visible = false;
      const { obj, el } = labels.make(String(value));
      v.label = el;
      obj.position.set(0, 0, labelZ);
      v.object.add(obj);
      group.add(v.object);
      pool.set(id, v);
    });
    return pool;
  };
  const stackPool = makePool(STACK_FRAMES, plateKit, 0.61, 40);
  const queuePool = makePool(QUEUE_FRAMES, cubeKit, 0.46, 50);

  const P = phase("linear", "ops");
  const ops = STACK_FRAMES.length - 1;

  const apply = (frames: LinearFrame[], pool: Map<number, NodeVisual>, layout: Layout, j: number, f: number, isStack: boolean) => {
    const from = frames[j];
    const to = frames[j + 1];
    const e = smoother(f);
    pool.forEach((v, id) => {
      const a = from.items.findIndex((x) => x.id === id);
      const b = to.items.findIndex((x) => x.id === id);
      if (a < 0 && b < 0) {
        v.object.visible = false;
        return;
      }
      const start = a >= 0 ? layout.slot(a) : layout.spawn(from.items.length);
      const end = b >= 0 ? layout.slot(b) : layout.exit(layout.slot(a));
      v.base.lerpVectors(start, end, e);
      const leaving = b < 0;
      const entering = a < 0;
      const scale = leaving ? 1 - smoother(local(f, 0.55, 1)) : entering ? smoother(local(f, 0, 0.35)) : 1;
      const edge = isStack ? b === to.items.length - 1 : b === 0;
      const state: NodeState = leaving ? "special" : entering ? "current" : edge ? "visited" : "idle";
      v.set(state, scale);
      v.object.visible = scale > 0.03;
    });
  };

  function update(p: number): string | null {
    const q = local(p, P.start, P.end);
    const k = q * ops;
    const j = Math.min(Math.floor(k), ops - 1);
    const f = k >= ops ? 1 : k - Math.floor(k);
    apply(STACK_FRAMES, stackPool, stackLayout, j, q === 0 ? 0 : f, true);
    apply(QUEUE_FRAMES, queuePool, queueLayout, j, q === 0 ? 0 : f, false);
    labels.setOpacity(local(p, 0.83, 0.855) * (1 - local(p, 0.945, 0.97)));

    if (p < P.start) return "Both start empty";
    const s = STACK_FRAMES[j + 1];
    const qf = QUEUE_FRAMES[j + 1];
    return `Stack: ${opText(s)}      Queue: ${opText(qf)}`;
  }

  function tick(k: number, dt: number, field: HoverField | null) {
    stackPool.forEach((v) => v.update(k, dt, field));
    queuePool.forEach((v) => v.update(k, dt, field));
  }

  return { group, labels: [labels], update, tick };
}
