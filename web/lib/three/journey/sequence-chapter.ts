import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BINARY_STEPS,
  BUCKETS,
  HASH_INSERTS,
  HASH_LOOKUP,
  INDEX_TARGET,
  LINEAR_STEPS,
  LOOKUP_KEY,
  SEARCH_TARGET,
  SEQUENCE,
} from "../../journey/data";
import { ANCHORS, local, phase, smoother } from "../../journey/timeline";
import type { HoverField } from "./hover-field";
import {
  EdgeVisual,
  JOURNEY,
  LabelSet,
  NodeVisual,
  boxKit,
  createCursor,
  edgeGeometry,
  nodeMaterial,
  pointOnPath,
  type NodeState,
} from "./visuals";

const N = SEQUENCE.length;
const LIST_GAP = 2.1;
const ARRAY_GAP = 1.04;
const BUCKET_GAP = 2.3;
const BUCKET_Z = -6.5;
const SLOT_GAP = 1.02;
const ARRIVE = 0.55;

const P = {
  traverse: phase("list", "traverse"),
  morph: phase("list", "morph"),
  index: phase("array", "index"),
  linear: phase("array", "linear"),
  binary: phase("array", "binary"),
  insert: phase("hash", "insert"),
  lookup: phase("hash", "lookup"),
};

function quad(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

export function createSequenceChapter() {
  const group = new THREE.Group();
  const itemLabels = new LabelSet();
  const arrayLabels = new LabelSet();
  const hashLabels = new LabelSet();
  const G = new THREE.Vector3(...ANCHORS.sequence);

  /* The list curves gently in depth so its links have real direction; the array is straight. */
  const listPos = (i: number) =>
    G.clone().add(new THREE.Vector3((i - (N - 1) / 2) * LIST_GAP, Math.sin(i * 0.8) * 0.18, Math.sin(i * 0.9) * 0.6));
  const arrayPos = (i: number) => G.clone().add(new THREE.Vector3((i - (N - 1) / 2) * ARRAY_GAP, 0, 0));
  const plateTop = (b: number) => G.clone().add(new THREE.Vector3((b - (BUCKETS - 1) / 2) * BUCKET_GAP, -0.45, BUCKET_Z));
  const slotPos = (b: number, s: number) =>
    G.clone().add(new THREE.Vector3((b - (BUCKETS - 1) / 2) * BUCKET_GAP, 0.15 + s * SLOT_GAP, BUCKET_Z));
  const gate = G.clone().add(new THREE.Vector3(0, 3.9, -3.2));

  /* Items: a glass data cell, plus a pointer cell that only exists while it is a linked list. */
  const cellKit = boxKit(0.9, 0.9, 0.9, 0.12);
  const ptrGeo = new RoundedBoxGeometry(0.38, 0.9, 0.9, 4, 0.1);
  const dotGeo = new THREE.SphereGeometry(0.075, 16, 12);
  const dotMat = new THREE.MeshStandardMaterial({ color: "#7fb0ff", emissive: new THREE.Color("#3d7bff"), emissiveIntensity: 1.6 });

  const items = SEQUENCE.map((value, i) => {
    const root = new THREE.Group();
    const cell = new NodeVisual(cellKit, i + 20);
    cell.glowScale = 0.8;
    cell.anchor = root;
    root.add(cell.object);
    const ptr = new THREE.Group();
    const ptrShell = new THREE.Mesh(ptrGeo, cellKit.glass);
    ptrShell.renderOrder = 2;
    const dot = new THREE.Mesh(dotGeo, dotMat);
    ptr.add(dot, ptrShell);
    ptr.position.x = 0.66;
    cell.object.add(ptr);
    const { obj, el } = itemLabels.make(String(value));
    cell.label = el;
    obj.position.set(0, 0, 0.46);
    cell.object.add(obj);
    root.position.copy(listPos(i));
    group.add(root);
    return { root, cell, ptr };
  });

  /* Arrows live in world space so they can follow cells that are pushed around. */
  const shaftGeo = edgeGeometry(0.028);
  const shaftSleeve = edgeGeometry(0.09);
  const coneGeo = new THREE.ConeGeometry(0.1, 0.24, 18);
  const arrows = SEQUENCE.map(() => {
    const shaft = new EdgeVisual(shaftGeo, new THREE.Vector3(), new THREE.Vector3(1, 0, 0), shaftSleeve);
    const head = new THREE.Mesh(coneGeo, shaft.material);
    group.add(shaft.mesh, head);
    return { shaft, head };
  });

  const nullRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.16, 0.045, 12, 36),
    new THREE.MeshStandardMaterial({ color: "#5f6b85", emissive: new THREE.Color("#2f6bff"), emissiveIntensity: 0.5 }),
  );
  nullRing.position.copy(listPos(N - 1)).add(new THREE.Vector3(LIST_GAP * 0.75, 0, 0));
  group.add(nullRing);
  const headTag = itemLabels.make("head", "tag");
  headTag.obj.position.copy(listPos(0)).add(new THREE.Vector3(0, 1.0, 0));
  group.add(headTag.obj);
  const nullTag = itemLabels.make("null", "small");
  nullTag.obj.position.copy(nullRing.position).add(new THREE.Vector3(0, -0.55, 0));
  group.add(nullTag.obj);
  let listness = 1;
  const arrowStates: ("idle" | "trail" | "active")[] = new Array(N).fill("idle");

  /* Array index labels and binary search markers. */
  SEQUENCE.forEach((_, i) => {
    const { obj } = arrayLabels.make(String(i), "small");
    obj.position.copy(arrayPos(i)).add(new THREE.Vector3(0, -0.85, 0));
    group.add(obj);
  });
  const markers = (["lo", "mid", "hi"] as const).map((name) => {
    const m = arrayLabels.make(name, "marker");
    group.add(m.obj);
    return m;
  });
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 1, 8).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ color: "#c9f6ff", emissive: new THREE.Color(JOURNEY.current), emissiveIntensity: 1.1 }),
  );
  beam.rotation.x = Math.PI;
  group.add(beam);
  const beamTag = arrayLabels.make(`arr[${INDEX_TARGET}]`, "tag");
  beamTag.obj.position.copy(arrayPos(INDEX_TARGET)).add(new THREE.Vector3(0, 1.35, 0));
  group.add(beamTag.obj);

  /* Hash map buckets, chain links, and the hash function gate. */
  const plateGeo = new RoundedBoxGeometry(1.4, 0.2, 1.3, 3, 0.06);
  const plates = Array.from({ length: BUCKETS }, (_, b) => {
    const plate = new THREE.Mesh(plateGeo, nodeMaterial(JOURNEY.graphiteLight));
    plate.position.copy(plateTop(b)).add(new THREE.Vector3(0, -0.1, 0));
    group.add(plate);
    const { obj } = hashLabels.make(`bucket ${b}`, "small");
    obj.position.copy(plateTop(b)).add(new THREE.Vector3(0, -0.6, 0.7));
    group.add(obj);
    return plate;
  });
  const linkGeo = edgeGeometry(0.03);
  const linkSleeve = edgeGeometry(0.09);
  const links = HASH_INSERTS.map((e) => {
    const prev = HASH_INSERTS.find((x) => x.bucket === e.bucket && x.slot === e.slot - 1);
    const link = new EdgeVisual(linkGeo, plateTop(e.bucket), slotPos(e.bucket, e.slot), linkSleeve);
    link.grow(0);
    group.add(link.mesh);
    return { link, prev: prev ? prev.item : -1, bucket: e.bucket, growth: 0 };
  });
  const gateMat = new THREE.MeshStandardMaterial({ color: "#8fa7d6", emissive: new THREE.Color(JOURNEY.current), emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.3 });
  const gateRing = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 16, 80), gateMat);
  gateRing.position.copy(gate);
  group.add(gateRing);
  const gateTag = hashLabels.make("hash(key) = key % 5", "tag");
  gateTag.obj.position.copy(gate).add(new THREE.Vector3(0, 1.55, 0));
  group.add(gateTag.obj);

  const cursor = createCursor();
  group.add(cursor);
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  const stepOf = (q: number, count: number) => {
    const k = q * (count + 0.4);
    const j = Math.min(Math.floor(k), count - 1);
    const f = k >= count ? 1 : k - Math.floor(k);
    return { j, f, arrived: f >= ARRIVE, move: Math.min(f / ARRIVE, 1) };
  };

  function update(p: number): string | null {
    const states: NodeState[] = new Array(N).fill("idle");
    let status: string | null = null;
    cursor.visible = false;

    /* ----- Where every item is ----- */
    const morph = smoother(local(p, P.morph.start, P.morph.end));
    listness = 1 - smoother(local(p, P.morph.start, P.morph.start + (P.morph.end - P.morph.start) * 0.5));
    arrowStates.fill("idle");
    const insertQ = local(p, P.insert.start, P.insert.end);
    let gateGlow = 0;

    items.forEach((it, i) => {
      if (p < P.insert.start) {
        it.root.position.lerpVectors(listPos(i), arrayPos(i), morph);
      } else {
        const e = HASH_INSERTS[i];
        const r = THREE.MathUtils.clamp(insertQ * N - i, 0, 1);
        const start = arrayPos(i);
        const end = slotPos(e.bucket, e.slot);
        if (r < 0.5) quad(start, tmp2.set(start.x, gate.y + 0.4, start.z), gate, smoother(r * 2), it.root.position);
        else quad(gate, tmp2.set(end.x, gate.y + 0.6, gate.z - 1.2), end, smoother((r - 0.5) * 2), it.root.position);
        gateGlow = Math.max(gateGlow, Math.exp(-Math.pow((r - 0.5) / 0.09, 2)));
        links[i].growth = THREE.MathUtils.clamp((r - 0.85) / 0.15, 0, 1);
      }
      it.ptr.scale.setScalar(Math.max(listness, 0.0001));
      it.ptr.visible = listness > 0.01;
    });
    if (p < P.insert.start) links.forEach((l) => (l.growth = 0));
    nullRing.scale.setScalar(Math.max(listness, 0.0001));
    nullRing.visible = listness > 0.01;

    const hashIn = smoother(local(p, P.insert.start - 0.015, P.insert.start + 0.004));
    plates.forEach((pl) => {
      pl.scale.setScalar(Math.max(hashIn, 0.0001));
      pl.visible = hashIn > 0.01;
    });
    gateRing.scale.setScalar(Math.max(hashIn, 0.0001));
    gateRing.visible = hashIn > 0.01;
    gateRing.rotation.z = p * 40;
    gateMat.emissiveIntensity = 0.3 + gateGlow * 2.4;

    /* ----- Labels ----- */
    itemLabels.setOpacity(local(p, 0.24, 0.27) * (1 - local(p, 0.67, 0.7)));
    arrayLabels.setOpacity(local(p, P.morph.end - 0.01, P.index.start) * (1 - local(p, P.insert.start - 0.01, P.insert.start + 0.004)));
    hashLabels.setOpacity(hashIn * (1 - local(p, 0.67, 0.7)));
    headTag.el.style.opacity = String(Math.round(listness * 20) / 20);
    nullTag.el.style.opacity = headTag.el.style.opacity;

    const inPhase = (ph: { start: number; end: number }, next?: { start: number }) =>
      p >= ph.start && (next ? p < next.start : true);

    /* ----- Linked list traversal ----- */
    if (inPhase(P.traverse, P.morph)) {
      const { j, arrived, move } = stepOf(local(p, P.traverse.start, P.traverse.end), N);
      for (let i = 0; i < (arrived ? j + 1 : j); i++) states[i] = "visited";
      const current = arrived ? j : j - 1;
      if (current >= 0) states[current] = "current";
      for (let a = 0; a < j - 1; a++) arrowStates[a] = "trail";
      if (j > 0) arrowStates[j - 1] = arrived ? "trail" : "active";
      if (arrived && j === N - 1) arrowStates[N - 1] = "trail";
      const from = j === 0 ? listPos(0).add(new THREE.Vector3(-1.5, 0, 0)) : listPos(j - 1);
      cursor.position.lerpVectors(from, listPos(j), move).add(tmp.set(0, 0, 0.75));
      cursor.visible = p <= P.traverse.end + 0.004;
      const reached = arrived ? j : j - 1;
      status =
        reached < 0
          ? "Start at head"
          : reached === N - 1
            ? `Reached the tail after ${N} hops. Its next pointer is null.`
            : `At ${SEQUENCE[reached]}. Follow next to ${SEQUENCE[reached + 1]}.`;
    }

    if (inPhase(P.morph, P.index)) {
      status = "Same values, now packed side by side with no pointers between them";
    }

    /* ----- Array: index access ----- */
    const beamDrop = p >= P.index.start && p < P.linear.start ? smoother(local(p, P.index.start, P.index.start + 0.01)) : 0;
    beam.visible = beamDrop > 0.01;
    beam.position.copy(arrayPos(INDEX_TARGET)).add(tmp.set(0, 6.5, 0));
    beam.scale.set(1, 6.05 * beamDrop, 1);
    beamTag.el.style.visibility = beamDrop > 0.5 ? "visible" : "hidden";
    if (inPhase(P.index, P.linear)) {
      if (beamDrop > 0.9) states[INDEX_TARGET] = "current";
      status = `arr[${INDEX_TARGET}] lands on ${SEQUENCE[INDEX_TARGET]} directly. No other cell is touched.`;
    }

    /* ----- Array: linear search ----- */
    if (inPhase(P.linear, P.binary)) {
      const { j, arrived, move } = stepOf(local(p, P.linear.start, P.linear.end), LINEAR_STEPS.length);
      const step = LINEAR_STEPS[j];
      for (let i = 0; i < j; i++) states[LINEAR_STEPS[i].index] = "visited";
      if (arrived) states[step.index] = step.found ? "special" : "current";
      const from = j === 0 ? arrayPos(0).add(tmp.set(-1.2, 0, 0)) : arrayPos(LINEAR_STEPS[j - 1].index);
      cursor.position.lerpVectors(from, arrayPos(step.index), move).add(tmp.set(0, 1.0, 0));
      cursor.visible = true;
      status = !arrived
        ? `Looking for ${SEARCH_TARGET}. Check index ${step.index}.`
        : step.found
          ? `arr[${step.index}] is ${SEARCH_TARGET}. Found after ${j + 1} checks.`
          : `arr[${step.index}] is ${step.value}, not ${SEARCH_TARGET}. Keep going.`;
    }

    /* ----- Array: binary search ----- */
    const showMarkers = inPhase(P.binary, P.insert);
    markers.forEach((m) => (m.el.style.visibility = showMarkers ? "visible" : "hidden"));
    if (showMarkers) {
      const { j, arrived, move } = stepOf(local(p, P.binary.start, P.binary.end), BINARY_STEPS.length);
      const step = BINARY_STEPS[j];
      const prev = BINARY_STEPS[Math.max(j - 1, 0)];
      for (let i = 0; i < N; i++) states[i] = i < step.lo || i > step.hi ? "dim" : "idle";
      if (arrived) states[step.mid] = step.result === "found" ? "special" : "current";
      const markerAt = (name: "lo" | "mid" | "hi", idx: number, prevIdx: number, row: number) => {
        const m = markers[["lo", "mid", "hi"].indexOf(name)];
        m.obj.position.lerpVectors(arrayPos(prevIdx), arrayPos(idx), j === 0 ? 1 : move).add(tmp.set(0, -1.25 - row * 0.32, 0));
      };
      markerAt("lo", step.lo, prev.lo, 0);
      markerAt("hi", step.hi, prev.hi, 0);
      markerAt("mid", step.mid, prev.mid, 1);
      cursor.position.lerpVectors(arrayPos(prev.mid), arrayPos(step.mid), j === 0 ? 1 : move).add(tmp.set(0, 1.0, 0));
      cursor.visible = true;
      const cmp =
        step.result === "found"
          ? `arr[${step.mid}] is ${SEARCH_TARGET}. Found in ${j + 1} checks instead of ${LINEAR_STEPS.length}.`
          : step.result === "right"
            ? `${step.value} is less than ${SEARCH_TARGET}, so drop the left half`
            : `${step.value} is greater than ${SEARCH_TARGET}, so drop the right half`;
      status = arrived ? `lo ${step.lo}, hi ${step.hi}, mid ${step.mid}: ${cmp}` : `lo ${step.lo}, hi ${step.hi}. Check the middle.`;
    }

    /* ----- Hash map: insert ----- */
    if (inPhase(P.insert, P.lookup)) {
      const flying = Math.min(Math.floor(insertQ * N), N - 1);
      HASH_INSERTS.forEach((e, i) => {
        const r = THREE.MathUtils.clamp(insertQ * N - i, 0, 1);
        states[i] = r >= 1 ? "visited" : r > 0 ? "current" : "idle";
      });
      const e = HASH_INSERTS[flying];
      const before = HASH_INSERTS.find((x) => x.bucket === e.bucket && x.slot === e.slot - 1);
      status =
        insertQ >= 1
          ? `${N} keys in ${BUCKETS} buckets. Collisions share a chain.`
          : `put(${e.key}): ${e.key} % ${BUCKETS} = ${e.bucket}, so bucket ${e.bucket}${before ? `, chained after ${before.key}` : ""}`;
    }

    /* ----- Hash map: lookup ----- */
    if (p >= P.lookup.start) {
      const q = local(p, P.lookup.start, P.lookup.end);
      const { bucket, probes } = HASH_LOOKUP;
      const approach = Math.min(q / 0.35, 1);
      const entryOf = (slot: number) => HASH_INSERTS.find((x) => x.bucket === bucket && x.slot === slot) as (typeof HASH_INSERTS)[number];
      const front = (v: THREE.Vector3) => v.add(tmp.set(0, 0, 0.8));
      if (q < 0.35) {
        pointOnPath([gate.clone().add(tmp2.set(0, 2.4, 2.6)), gate.clone(), front(plateTop(bucket))], approach, cursor.position);
        status = `get(${LOOKUP_KEY}): ${LOOKUP_KEY} % ${BUCKETS} = ${bucket}, so only bucket ${bucket} is searched`;
      } else {
        const { j, arrived, move } = stepOf((q - 0.35) / 0.65, probes.length);
        const probe = probes[j];
        for (let s = 0; s < j; s++) states[entryOf(probes[s].slot).item] = "visited";
        if (arrived) states[entryOf(probe.slot).item] = probe.match ? "special" : "current";
        const from = j === 0 ? front(plateTop(bucket)) : front(slotPos(bucket, probes[j - 1].slot));
        cursor.position.lerpVectors(from, front(slotPos(bucket, probe.slot)), move);
        status = !arrived
          ? `Walk the chain in bucket ${bucket}`
          : probe.match
            ? `Found ${LOOKUP_KEY} after ${j + 1} comparisons, without touching the other buckets`
            : `Compare ${probe.key}: not ${LOOKUP_KEY}, follow the chain`;
      }
      cursor.visible = p <= P.lookup.end + 0.006;
    }

    items.forEach((it, i) => it.cell.set(states[i]));
    links.forEach((l, i) =>
      l.link.set(states[i] === "special" ? "special" : states[i] === "visited" && p >= P.lookup.start ? "trail" : "idle"),
    );
    arrows.forEach((a, i) => a.shaft.set(arrowStates[i]));
    return status;
  }

  const cellWorld = (i: number, out: THREE.Vector3) => out.copy(items[i].root.position).add(items[i].cell.object.position);
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  function tick(k: number, dt: number, field: HoverField | null) {
    items.forEach((it) => it.cell.update(k, dt, field));

    arrows.forEach((a, i) => {
      const show = listness > 0.01;
      a.shaft.mesh.visible = show;
      a.head.visible = show;
      if (!show) return;
      cellWorld(i, from).add(tmp.set(0.87, 0, 0));
      if (i < N - 1) cellWorld(i + 1, to).add(tmp.set(-0.5, 0, 0));
      else to.copy(nullRing.position).add(tmp.set(-0.22, 0, 0));
      dir.subVectors(to, from).normalize();
      to.addScaledVector(dir, -0.2);
      a.shaft.place(from, to);
      a.shaft.grow(listness);
      a.shaft.mesh.scale.x = a.shaft.mesh.scale.z = listness;
      a.head.position.copy(from).lerp(to, listness).addScaledVector(dir, 0.1 * listness);
      a.head.quaternion.setFromUnitVectors(UP, dir);
      a.head.scale.setScalar(Math.max(listness, 0.0001));
      a.shaft.update(k);
    });

    links.forEach((l, i) => {
      if (l.prev >= 0) cellWorld(l.prev, from).add(tmp.set(0, 0.47, 0));
      else from.copy(plateTop(l.bucket));
      cellWorld(i, to).add(tmp.set(0, -0.47, 0));
      l.link.place(from, to);
      l.link.grow(l.growth);
      l.link.update(k);
    });
  }

  return { group, labels: [itemLabels, arrayLabels, hashLabels], update, tick };
}
