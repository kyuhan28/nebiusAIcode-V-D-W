import * as THREE from "three";
import {
  addEnvironment,
  createComposer,
  createGridFloor,
  createRenderer,
  createStars,
  disposeObject,
  prefersReducedMotion,
} from "./core";
import { PALETTE, PALETTE_LIST, seededRandom } from "./materials";
import {
  addFrame,
  arrayRow,
  atom,
  graph,
  linkedList,
  matrix,
  perfectBinary,
  stack,
  tree,
  type Structure,
  type TreeSpec,
} from "./structures";

type Placement = {
  make: () => Structure;
  pos: [number, number, number];
  scale: number;
  rot?: [number, number];
  frame?: boolean;
  glow?: string;
};

const bst: TreeSpec = {
  children: [{ children: [{}, { children: [{}, {}] }] }, { children: [{ children: [{}] }, {}] }],
};
const trie: TreeSpec = {
  children: [{ children: [{}, {}] }, { children: [{ children: [{}] }] }, { children: [{}, {}, {}] }],
};

const PLACEMENTS: Placement[] = [
  { make: () => tree(perfectBinary(3), { color: PALETTE.violet, label: "Binary tree, in-order traversal", order: "in" }), pos: [-6.2, 1.5, 0], scale: 1.05, rot: [0.15, 0.1], frame: true },
  { make: () => linkedList(4, PALETTE.mint), pos: [-1.6, 3.7, -5], scale: 0.85, rot: [0.25, 0.1] },
  { make: () => arrayRow([3, 7, 2, 9, 5, 4, 8], PALETTE.butter, { bars: true, emissive: 0.08 }), pos: [1.4, 0.4, -2.5], scale: 0.9, rot: [0.18, -0.5] },
  { make: () => graph(8, PALETTE.cobalt, 11), pos: [5.0, 2.8, -4], scale: 1.1 },
  { make: () => stack(5, PALETTE.pink), pos: [8.8, -0.6, -1], scale: 0.95, rot: [0.5, 0.15] },
  { make: () => tree(trie, { color: PALETTE.orange, label: "Trie, walked letter by letter", radius: 0.22, xGap: 0.6, yGap: 0.85 }), pos: [9.2, 3.6, -7], scale: 0.95 },
  { make: () => matrix(3, 3, PALETTE.lilac), pos: [3.6, -1.1, 1.2], scale: 0.8, rot: [0.6, 0.35], frame: true },
  { make: () => tree(bst, { color: PALETTE.coral, label: "Binary search tree, in-order", order: "in", radius: 0.24, xGap: 0.62, yGap: 0.9 }), pos: [-10.5, 4.6, -2], scale: 0.8 },
  { make: () => linkedList(3, PALETTE.orange), pos: [-5.5, 5.2, -13], scale: 1, rot: [-0.3, 0] },
  { make: () => arrayRow([1, 2, 3, 4, 5, 6], PALETTE.cobalt), pos: [0.5, 5.8, -14], scale: 1.1, rot: [0.2, 0.2] },
  { make: () => graph(6, PALETTE.mint, 5), pos: [13, 1.0, -9], scale: 0.9 },
  { make: () => tree(perfectBinary(4), { color: PALETTE.butter, label: "Binary tree, in-order traversal", order: "in", radius: 0.2, xGap: 0.42, yGap: 0.8 }), pos: [14.5, -1.6, -6], scale: 0.9 },
];

const WAVE_GAP = 0.15;
const PULSE = 0.55;

export function createHeroScene(container: HTMLElement) {
  const reduced = prefersReducedMotion();
  const renderer = createRenderer(container);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 20, 68);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const lookAt = new THREE.Vector3(0, 0.6, -2);
  const envMap = addEnvironment(renderer, scene);
  scene.add(createGridFloor(-3.4));
  const stars = createStars();
  scene.add(stars);

  type Live = Structure & { base: THREE.Vector3; scale: number; rot: [number, number]; spin: number; phase: number; playStart: number };
  const rand = seededRandom(42);
  const pickables: THREE.Mesh[] = [];
  const live: Live[] = PLACEMENTS.map((p, index) => {
    const s = p.make();
    if (p.frame) addFrame(s);
    s.group.position.set(...p.pos);
    s.group.scale.setScalar(p.scale);
    s.group.rotation.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, 0);
    if (p.glow) {
      const light = new THREE.PointLight(p.glow, 2.5, 5);
      s.group.add(light);
    }
    s.waves.flat().forEach((m) => {
      m.userData.structure = index;
      pickables.push(m);
    });
    scene.add(s.group);
    return {
      ...s,
      base: new THREE.Vector3(...p.pos),
      scale: p.scale,
      rot: p.rot ?? [0, 0],
      spin: (rand() > 0.5 ? 1 : -1) * (0.06 + rand() * 0.1),
      phase: rand() * Math.PI * 2,
      playStart: -Infinity,
    };
  });

  const atoms = Array.from({ length: 46 }, (_, i) => {
    const mesh = atom(i, PALETTE_LIST[Math.floor(rand() * PALETTE_LIST.length)]);
    const base = new THREE.Vector3(rand() * 30 - 15, rand() * 6.5 - 1.6, rand() * 15 - 12);
    const scale = 0.12 + rand() * 0.22;
    mesh.position.copy(base);
    mesh.scale.setScalar(scale);
    mesh.rotation.set(rand() * 3, rand() * 3, 0);
    scene.add(mesh);
    return { mesh, base, scale, phase: rand() * Math.PI * 2, spin: 0.2 + rand() * 0.4 };
  });

  const composer = createComposer(renderer, scene, camera);

  const label = document.createElement("div");
  Object.assign(label.style, {
    position: "absolute",
    left: "0",
    top: "0",
    pointerEvents: "none",
    padding: "6px 12px",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#f4f4f5",
    fontFamily: "inherit",
    fontSize: "13px",
    fontWeight: "500",
    lineHeight: "1.2",
    whiteSpace: "nowrap",
    opacity: "0",
    transition: "opacity 160ms ease",
    transform: "translate(-9999px, 0)",
  } satisfies Partial<CSSStyleDeclaration>);
  container.appendChild(label);

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.position.z = camera.aspect < 1 ? 24 : camera.aspect < 1.4 ? 18 : 14;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let visible = true;
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  visibility.observe(container);

  const pointer = new THREE.Vector2(0, 0);
  const parallax = new THREE.Vector2(0, 0);
  const raycaster = new THREE.Raycaster();
  let pointerInside = false;
  let hovered = -1;
  let clientX = 0;
  let clientY = 0;

  const onPointerMove = (e: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    clientX = e.clientX - rect.left;
    clientY = e.clientY - rect.top;
    pointerInside = clientX >= 0 && clientY >= 0 && clientX <= rect.width && clientY <= rect.height;
    pointer.set((clientX / rect.width) * 2 - 1, -(clientY / rect.height) * 2 + 1);
  };
  window.addEventListener("pointermove", onPointerMove);

  const start = performance.now();
  let last = start;
  let frame = 0;

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    if (!visible) return;
    const t = (now - start) / 1000;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const motion = reduced ? 0 : 1;

    parallax.lerp(pointerInside ? pointer : new THREE.Vector2(0, 0), 0.04);
    camera.position.x = parallax.x * 1.1 * motion;
    camera.position.y = 1.4 + parallax.y * 0.5 * motion;
    camera.lookAt(lookAt);

    if (pointerInside) {
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      const next = hit ? (hit.object.userData.structure as number) : -1;
      if (next !== hovered) {
        hovered = next;
        if (hovered >= 0) {
          const s = live[hovered];
          const running = t < s.playStart + s.waves.length * WAVE_GAP + PULSE;
          if (!running) s.playStart = t;
          label.textContent = s.label;
        }
        label.style.opacity = hovered >= 0 ? "1" : "0";
      }
      if (hovered >= 0) label.style.transform = `translate(${clientX + 18}px, ${clientY + 14}px)`;
    } else if (hovered !== -1) {
      hovered = -1;
      label.style.opacity = "0";
    }

    live.forEach((s, i) => {
      const intro = reduced ? 1 : THREE.MathUtils.clamp((t - 0.15 - i * 0.08) / 1.1, 0, 1);
      const eased = 1 - Math.pow(1 - intro, 3);
      const g = s.group;
      g.position.y = s.base.y + Math.sin(t * 0.6 + s.phase) * 0.2 * motion - (1 - eased) * 1.8;
      g.scale.setScalar(s.scale * (0.001 + eased * 0.999));
      const spinBoost = hovered === i ? 3 : 1;
      g.rotation.y += dt * s.spin * spinBoost * motion;
      g.rotation.x = s.rot[0] + Math.sin(t * 0.4 + s.phase) * 0.08 * motion;

      s.waves.forEach((wave, k) => {
        const x = t - s.playStart - k * WAVE_GAP;
        const p = x >= 0 && x <= PULSE ? Math.sin((Math.PI * x) / PULSE) : 0;
        wave.forEach((mesh) => {
          const mat = mesh.material as THREE.MeshPhysicalMaterial;
          mat.emissiveIntensity = (mat.userData.baseEmissive as number) + p * 2.2;
          mesh.scale.setScalar(1 + p * 0.3);
        });
      });
    });

    atoms.forEach((a) => {
      a.mesh.position.y = a.base.y + Math.sin(t * 0.7 + a.phase) * 0.25 * motion;
      a.mesh.rotation.y += dt * a.spin * motion;
      a.mesh.rotation.x += dt * a.spin * 0.6 * motion;
    });
    stars.rotation.y = t * 0.004 * motion;

    composer.render();
  };
  frame = requestAnimationFrame(loop);

  return {
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      resizeObserver.disconnect();
      visibility.disconnect();
      disposeObject(scene);
      envMap.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      label.remove();
    },
  };
}
