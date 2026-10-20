import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addEnvironment, createComposer, createRenderer, createStars, disposeObject } from "./core";
import { createInfiniteGrid } from "./journey/grid";
import { JOURNEY, NodeVisual, boxKit, type NodeState } from "./journey/visuals";
import type { ArrayView } from "../trace/interpret";
import { attachWasd } from "./wasd";

const CELL = 1;
const GAP = 0.22;
const POINTER_Y = 1.35;

function label(text: string, style: Partial<CSSStyleDeclaration>) {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, { userSelect: "none", whiteSpace: "nowrap", pointerEvents: "none", ...style });
  return { el, obj: new CSS2DObject(el) };
}

/**
 * Draws one array from a real execution trace. The scene holds no algorithm logic; it only
 * shows the state it is given, so it cannot drift from what the program did.
 */
export function createTraceArrayScene(container: HTMLElement, length: number, fontFamily: string) {
  const renderer = createRenderer(container);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 20, 70);
  const envMap = addEnvironment(renderer, scene);
  scene.environmentIntensity = 0.6;
  scene.add(createStars(600, 13));
  const grid = createInfiniteGrid(-1.8);
  scene.add(grid.mesh);

  /* Long arrays and lists wrap into rows of 10, keeping index order, so every value stays readable. */
  const PER_ROW = length > 16 ? 10 : Math.max(length, 1);
  const ROWS = Math.ceil(length / PER_ROW);
  const ROW_H = 2.7;
  const slotX = (i: number) => ((i % PER_ROW) - (PER_ROW - 1) / 2) * (CELL + GAP);
  const slotY = (i: number) => ((ROWS - 1) / 2 - Math.floor(i / PER_ROW)) * ROW_H;
  const kit = boxKit(CELL, CELL, CELL, 0.14);
  {
    const count = label(`${length} element${length === 1 ? "" : "s"}`, { font: `500 14px ${fontFamily}`, color: "#6b7385" });
    count.obj.position.set(slotX(0) - 0.2, slotY(0) + 1.75, 0);
    scene.add(count.obj);
  }
  const cells = Array.from({ length }, (_, i) => {
    const v = new NodeVisual(kit, i + 7);
    v.glowScale = 0.8;
    v.base.set(slotX(i), slotY(i), 0);
    v.targetScale = 1;
    const value = label("", { font: `600 clamp(13px, 2.5vmin, 21px) ${fontFamily}`, color: JOURNEY.white, textShadow: "0 0 6px rgba(0,0,0,0.95)" });
    value.obj.position.set(0, 0, CELL / 2 + 0.01);
    v.label = value.el;
    v.object.add(value.obj);
    const index = label(String(i), { font: `500 14px ${fontFamily}`, color: "#6b7385" });
    index.obj.position.set(slotX(i), slotY(i) - 0.95, 0);
    scene.add(v.object, index.obj);
    return { v, value: value.el, offset: 0, offsetY: 0 };
  });

  /* One marker per index variable; markers on the same cell stack upward. */
  const coneGeo = new THREE.ConeGeometry(0.16, 0.34, 24).rotateX(Math.PI);
  const pointerMat = new THREE.MeshStandardMaterial({ color: JOURNEY.current, emissive: new THREE.Color(JOURNEY.current), emissiveIntensity: 0.8 });
  const pointers = new Map<string, { group: THREE.Group; targetX: number; targetY: number }>();
  const pointerFor = (name: string) => {
    let p = pointers.get(name);
    if (!p) {
      const group = new THREE.Group();
      group.add(new THREE.Mesh(coneGeo, pointerMat));
      const tag = label(name, { font: `italic 600 15px ${fontFamily}`, color: JOURNEY.current });
      tag.obj.position.set(0, 0.42, 0);
      group.add(tag.obj);
      scene.add(group);
      p = { group, targetX: 0, targetY: POINTER_Y };
      group.position.set(0, POINTER_Y, 0);
      pointers.set(name, p);
    }
    return p;
  };

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.maxPolarAngle = Math.PI * 0.56;

  const composer = createComposer(renderer, scene, camera, { strength: 0.5, radius: 0.4, threshold: 0.86 });
  const wasd = attachWasd(renderer.domElement, container, camera, controls);
  const resetView = () => {
    const halfW = (PER_ROW * (CELL + GAP)) / 2 + 1.2;
    const halfH = (ROWS * ROW_H) / 2 + 1;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(3 / tanHalf, halfH / tanHalf, halfW / (tanHalf * camera.aspect));
    camera.position.set(dist * 0.12, dist * 0.3, dist);
    controls.target.set(0, 0.2, 0);
    controls.update();
  };
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
  resetView();
  const ro = new ResizeObserver(() => {
    resize();
    resetView();
  });
  ro.observe(container);

  let lastSwap: string | null = null;

  function setState(view: ArrayView | null) {
    cells.forEach((c, i) => {
      const value = view?.values[i];
      c.value.textContent = value === undefined || value === null ? "" : String(value);
      const state: NodeState = !view
        ? "dim"
        : view.writes.includes(i)
          ? "special"
          : view.reads.includes(i)
            ? "current"
            : "idle";
      c.v.set(state, view && i < view.values.length ? 1 : 0.0001);
    });

    /* A swap: values travel from their old slots to their new ones. */
    const key = view?.swap ? view.swap.join(":") : null;
    if (view?.swap && key !== lastSwap) {
      const [a, b] = view.swap;
      cells[a].offset = slotX(b) - slotX(a);
      cells[b].offset = slotX(a) - slotX(b);
      cells[a].offsetY = slotY(b) - slotY(a);
      cells[b].offsetY = slotY(a) - slotY(b);
    }
    lastSwap = key;

    const used = new Set<string>();
    const perCell = new Map<number, number>();
    view?.pointers.forEach((p) => {
      const marker = pointerFor(p.name);
      const stack = perCell.get(p.index) ?? 0;
      perCell.set(p.index, stack + 1);
      marker.targetX = slotX(p.index);
      marker.targetY = slotY(p.index) + POINTER_Y + stack * 0.85;
      marker.group.visible = true;
      used.add(p.name);
    });
    pointers.forEach((p, name) => {
      if (!used.has(name)) p.group.visible = false;
    });
  }

  let frame = 0;
  let last = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const k = 1 - Math.exp(-dt * 10);
    cells.forEach((c, i) => {
      c.offset += (0 - c.offset) * (1 - Math.exp(-dt * 5));
      c.offsetY += (0 - c.offsetY) * (1 - Math.exp(-dt * 5));
      const travel = Math.min(Math.hypot(c.offset, c.offsetY), 1);
      c.v.base.set(slotX(i) + c.offset, slotY(i) + c.offsetY + Math.sin(travel * Math.PI) * 0.6, 0);
      c.v.update(k, dt, null);
    });
    pointers.forEach((p) => {
      p.group.position.x += (p.targetX - p.group.position.x) * k;
      p.group.position.y += (p.targetY + Math.sin(now / 320) * 0.04 - p.group.position.y) * k;
    });
    wasd.update(dt);
    controls.update();
    grid.update(camera, 1, 70);
    composer.render();
    labels.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    setState,
    resetView,
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
