import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { ANCHORS, type Vec3 } from "../../journey/timeline";
import { seededRandom } from "../materials";
import type { HoverField } from "./hover-field";
import { easeOutBack, glassMaterial } from "./visuals";

type Rig = { sample(p: number, pos: THREE.Vector3, look: THREE.Vector3): void };

/** Dimmed versions of the journey palette, so the shapes read as atmosphere rather than content. */
const COLORS = ["#1b2452", "#203b8e", "#3f3282", "#1f6178", "#2b3142", "#3a4259"];
const GLOWS = ["#3a9fb8", "#6a52d8"];

/* The space each structure occupies (center and half-size, relative to its anchor), with room to spare. */
const KEEP_OUT: { anchor: Vec3; center: Vec3; half: Vec3 }[] = [
  { anchor: ANCHORS.tree, center: [0, 0, -1], half: [9.4, 4, 2.6] },
  { anchor: ANCHORS.sequence, center: [0, 1.6, -3.4], half: [11.2, 3.8, 4.6] },
  { anchor: ANCHORS.graph, center: [0.2, 0.3, 0], half: [6.4, 4, 3] },
  { anchor: ANCHORS.linear, center: [1.5, 0.6, 0], half: [6.6, 3.2, 1.8] },
];

/* Moments where the viewer lingers on a structure. Shapes are kept out of the middle of these views. */
/* Matches the scene's fog distance during the journey. */
const FOG_FAR = 78;

const DWELL = [0, 0.05, 0.1, 0.16, 0.21, 0.3, 0.34, 0.42, 0.5, 0.58, 0.64, 0.73, 0.78, 0.81, 0.88, 0.93];

type Shape = {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  scale: number;
  phase: number;
  axis: THREE.Vector3;
  spin: number;
  appear: number;
  hover: number;
  offset: THREE.Vector3;
};

export function createAmbient(rig: Rig, reducedMotion: boolean) {
  const group = new THREE.Group();
  const rand = seededRandom(73);

  const geometries = [
    new RoundedBoxGeometry(1, 1, 1, 4, 0.2),
    new THREE.SphereGeometry(0.55, 32, 20),
    new THREE.TorusGeometry(0.42, 0.16, 18, 48),
    new THREE.CapsuleGeometry(0.28, 0.62, 8, 16),
    new THREE.TorusGeometry(0.5, 0.05, 12, 64),
  ];
  const weights = [0.34, 0.2, 0.2, 0.16, 0.1];
  const pickGeometry = () => {
    let r = rand();
    for (let i = 0; i < weights.length; i++) {
      if ((r -= weights[i]) <= 0) return i;
    }
    return 0;
  };
  const materials = COLORS.map(
    (c) =>
      new THREE.MeshPhysicalMaterial({
        color: c,
        roughness: 0.34,
        metalness: 0.1,
        clearcoat: 0.7,
        clearcoatRoughness: 0.2,
        envMapIntensity: 0.6,
      }),
  );
  const glowMaterials = GLOWS.map(
    (c) => new THREE.MeshStandardMaterial({ color: c, emissive: new THREE.Color(c), emissiveIntensity: 0.55, roughness: 0.3 }),
  );

  /*
   * Precompute the lingering views and the camera route for placement checks, for both a
   * desktop camera and the wider, farther phone camera the scene switches to on tall screens.
   */
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const LENSES = [
    { fov: 42, aspect: 1.6, back: 1 },
    { fov: 55, aspect: 0.46, back: 2.33 },
  ];
  const makeView = (p: number, lens: (typeof LENSES)[number]) => {
    const cam = new THREE.PerspectiveCamera(lens.fov, lens.aspect, 0.1, 400);
    rig.sample(p, pos, look);
    cam.position.copy(look).addScaledVector(pos.sub(look), lens.back);
    cam.lookAt(look);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return {
      p,
      viewProj: new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      position: cam.position.clone(),
      forward: cam.getWorldDirection(new THREE.Vector3()),
      right: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize(),
      up: new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize(),
      distance: cam.position.distanceTo(look),
      tanHalf: Math.tan(THREE.MathUtils.degToRad(lens.fov / 2)),
      aspect: lens.aspect,
      footprints: [] as { minX: number; maxX: number; minY: number; maxY: number; depth: number }[],
    };
  };
  const desktopViews = DWELL.map((p) => makeView(p, LENSES[0]));
  const views = [...desktopViews, ...DWELL.map((p) => makeView(p, LENSES[1]))];
  const route = LENSES.flatMap((lens) =>
    Array.from({ length: 141 }, (_, i) => {
      rig.sample(i / 140, pos, look);
      return look.clone().addScaledVector(pos.sub(look), lens.back);
    }),
  );

  const ndc = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const boxes = KEEP_OUT.map((k) => {
    const center = new THREE.Vector3(...k.anchor).add(new THREE.Vector3(...k.center));
    return new THREE.Box3().setFromCenterAndSize(center, new THREE.Vector3(...k.half).multiplyScalar(2));
  });
  const fits = (p: THREE.Vector3, size: number) => {
    if (p.y < -3 + size) return false;
    if (boxes.some((b) => b.distanceToPoint(p) < 1 + size)) return false;
    if (route.some((r) => r.distanceTo(p) < 4.5 + size * 1.5)) return false;
    if (placedAt.some((q) => q.distanceTo(p) < 1.6 + size)) return false;
    for (const v of views) {
      const depth = rel.subVectors(p, v.position).dot(v.forward);
      if (depth <= 0 || depth > FOG_FAR) continue;
      ndc.copy(p).applyMatrix4(v.viewProj);
      if (ndc.z >= 1) continue;
      /* Never inside a structure's silhouette unless well behind it, where fog keeps it faint. */
      if (
        v.footprints.some(
          (f) => depth < f.depth + 12 && ndc.x > f.minX && ndc.x < f.maxX && ndc.y > f.minY && ndc.y < f.maxY,
        )
      )
        return false;
      /* Keep the middle of the view clear too, but only near the subject; farther out, the fog dims it. */
      if (depth < v.distance * 2.1 && Math.abs(ndc.x) < 0.58 && Math.abs(ndc.y) < 0.55) return false;
    }
    return true;
  };
  const placedAt: THREE.Vector3[] = [];

  /*
   * Each structure's silhouette on screen in each view, so shapes never overlap it. Extents are
   * measured at the structure's center depth; projecting the box's near corners in perspective
   * would inflate the footprint far beyond what is actually visible.
   */
  const corner = new THREE.Vector3();
  const boxCenter = new THREE.Vector3();
  views.forEach((v) => {
    v.footprints = boxes.flatMap((b) => {
      const centerDepth = rel.subVectors(b.getCenter(boxCenter), v.position).dot(v.forward);
      /* Only the structure this view is about; distant ones are mostly lost in fog. */
      if (centerDepth <= 0.5 || centerDepth > v.distance * 2.2) return [];
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).sub(v.position);
        const x = corner.dot(v.right) / (centerDepth * v.tanHalf * v.aspect);
        const y = corner.dot(v.up) / (centerDepth * v.tanHalf);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      return [{ minX: minX - 0.05, maxX: maxX + 0.05, minY: minY - 0.05, maxY: maxY + 0.05, depth: centerDepth }];
    });
  });

  const seenAtOpening = (p: THREE.Vector3) => {
    const v = views[0];
    const depth = rel.subVectors(p, v.position).dot(v.forward);
    if (depth <= 0 || depth > FOG_FAR) return false;
    ndc.copy(p).applyMatrix4(v.viewProj);
    return Math.abs(ndc.x) < 1.15 && Math.abs(ndc.y) < 1.15;
  };

  const shapes: Shape[] = [];
  const addShape = (mesh: THREE.Mesh, base: THREE.Vector3, scale: number, appear: number) => {
    mesh.position.copy(base);
    mesh.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
    mesh.scale.setScalar(0.0001);
    group.add(mesh);
    shapes.push({
      mesh,
      base,
      scale,
      phase: rand() * Math.PI * 2,
      axis: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
      spin: 0.15 + rand() * 0.35,
      appear,
      hover: 0,
      offset: new THREE.Vector3(),
    });
  };

  /*
   * For each lingering view, pick spots in the outer band of the screen, at depths at or
   * behind the structure, and project them into the world. Every spot is then checked
   * against all views, so a shape never sits over whatever is being explained.
   */
  let glowLeft = 4;
  let framesLeft = 3;
  desktopViews.forEach((v, vi) => {
    const want = vi === 0 ? 12 : 5;
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < want; attempt++) {
      const x = rand() * 1.94 - 0.97;
      const y = -0.4 + rand() * 1.32;
      if (Math.abs(x) < 0.66 && Math.abs(y) < 0.62) continue;
      const depth = v.distance * (0.8 + rand() * 1.1);
      const p = v.position
        .clone()
        .addScaledVector(v.forward, depth)
        .addScaledVector(v.right, x * depth * v.tanHalf * v.aspect)
        .addScaledVector(v.up, y * depth * v.tanHalf);
      const scale = (0.18 + Math.pow(rand(), 2) * 0.48) * (depth / 16);
      if (!fits(p, scale)) continue;

      const kind = pickGeometry();
      const glow = glowLeft > 0 && rand() < 0.1;
      if (glow) glowLeft--;
      const mesh = new THREE.Mesh(
        geometries[kind],
        glow ? glowMaterials[Math.floor(rand() * glowMaterials.length)] : materials[Math.floor(rand() * materials.length)],
      );
      if (kind === 0 && framesLeft > 0 && rand() < 0.3) {
        framesLeft--;
        addChromaticFrame(mesh);
      }
      /* Anything the opening view can see arrives after the tree has assembled. */
      addShape(mesh, p, scale, seenAtOpening(p) ? 2.8 + rand() * 1.8 : 0);
      placedAt.push(p);
      placed++;
    }
  });

  /* One large glass ring, partly off the left edge of the opening view. */
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.13, 24, 160), glassMaterial());
  (ring.material as THREE.MeshPhysicalMaterial).opacity = 0.5;
  addShape(ring, new THREE.Vector3(...ANCHORS.tree).add(new THREE.Vector3(-13, -0.6, 4)), 1, 3.2);
  shapes[shapes.length - 1].spin = 0.12;

  const push = new THREE.Vector3();
  const kh = { value: 0 };

  function update(t: number, dt: number, field: HoverField | null) {
    kh.value = 1 - Math.exp(-dt * 6);
    const motion = reducedMotion ? 0 : 1;
    shapes.forEach((s) => {
      const a = reducedMotion ? 1 : THREE.MathUtils.clamp((t - s.appear) / 0.9, 0, 1);
      const grow = a >= 1 ? 1 : Math.max(easeOutBack(a), 0);

      let target = 0;
      push.set(0, 0, 0);
      if (field && a > 0.5) target = field.influence(s.base, push);
      s.hover += (target - s.hover) * kh.value;
      s.offset.lerp(push, kh.value);

      s.mesh.position.copy(s.base).add(s.offset);
      s.mesh.position.y += Math.sin(t * 0.5 + s.phase) * 0.25 * motion;
      s.mesh.rotateOnAxis(s.axis, dt * s.spin * (motion + s.hover * 5));
      s.mesh.scale.setScalar(Math.max(s.scale * grow * (1 + s.hover * 0.15), 0.0001));
    });
  }

  return { group, update, count: shapes.length };
}

/** A wireframe box with a slight magenta and cyan split, like a lens fringe. */
function addChromaticFrame(mesh: THREE.Mesh) {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.3, 1.3, 1.3));
  const layers: [string, number, number][] = [
    ["#ffffff", 0, 0.22],
    ["#ff4fd8", 0.03, 0.2],
    ["#3ee6ff", -0.03, 0.2],
  ];
  layers.forEach(([color, offset, opacity]) => {
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    line.position.x = offset;
    mesh.add(line);
  });
}
