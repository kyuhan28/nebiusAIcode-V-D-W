import * as THREE from "three";
import { animate } from "animejs";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { addEnvironment, createComposer, createGridFloor, createRenderer, createStars, disposeObject } from "./core";
import { toyMaterial } from "./materials";
import { STATE_COLORS } from "../state-colors";
import type { ArrayVizState } from "../trace/array-demo";

const CELL = 1;
const GAP = 0.2;
const LIFT = 0.3;
const POINTER_Y = 1.35;

function tag(text: string, style: Partial<CSSStyleDeclaration>) {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, { userSelect: "none", whiteSpace: "nowrap", ...style });
  return el;
}

export function createArrayScene(container: HTMLElement, values: number[], onCellClick?: (index: number) => void) {
  const renderer = createRenderer(container);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 18, 60);
  const envMap = addEnvironment(renderer, scene);
  scene.add(createStars(700, 9));
  scene.add(createGridFloor(-1.6, 120));

  const cellX = (i: number) => (i - (values.length - 1) / 2) * (CELL + GAP);
  const box = new RoundedBoxGeometry(CELL, CELL, CELL, 4, 0.14);

  type Cell = { mesh: THREE.Mesh; value: HTMLDivElement; target: THREE.Color; glow: number; lift: number };
  const cells: Cell[] = values.map((v, i) => {
    const mesh = new THREE.Mesh(box, toyMaterial(STATE_COLORS.idle));
    mesh.position.set(cellX(i), 0, 0);
    mesh.userData.index = i;
    scene.add(mesh);

    const value = tag(String(v), { font: "600 20px system-ui, sans-serif", color: "#f4f4f5", transition: "color 200ms ease" });
    const valueLabel = new CSS2DObject(value);
    valueLabel.position.set(0, 0, CELL / 2);
    mesh.add(valueLabel);

    const index = new CSS2DObject(tag(String(i), { font: "500 13px system-ui, sans-serif", color: "#71717a" }));
    index.position.set(cellX(i), -0.95, 0);
    scene.add(index);

    return { mesh, value, target: new THREE.Color(STATE_COLORS.idle), glow: 0, lift: 0 };
  });

  const pointer = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 32), toyMaterial(STATE_COLORS.current, 0.5));
  cone.rotation.x = Math.PI;
  pointer.add(cone);
  const pointerLabel = new CSS2DObject(
    tag("i", { font: "italic 600 16px system-ui, sans-serif", color: STATE_COLORS.current }),
  );
  pointerLabel.position.set(0, 0.5, 0);
  pointer.add(pointerLabel);
  pointer.position.set(cellX(0), POINTER_Y, 0);
  pointer.visible = false;
  scene.add(pointer);

  const maxEl = tag("max", {
    font: "600 12px system-ui, sans-serif",
    color: "#ffffff",
    background: STATE_COLORS.best,
    padding: "2px 8px",
    borderRadius: "999px",
    opacity: "0",
    transition: "opacity 200ms ease",
  });
  const maxTag = new CSS2DObject(maxEl);
  maxTag.position.set(cellX(0), -1.32, 0);
  scene.add(maxTag);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.56;

  const resetView = () => {
    const halfW = (values.length * (CELL + GAP)) / 2 + 1;
    const halfH = 2.4;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfH / tanHalf, halfW / (tanHalf * camera.aspect));
    camera.position.set(dist * 0.18, dist * 0.28, dist);
    controls.target.set(0, 0.1, 0);
    controls.update();
  };

  const composer = createComposer(renderer, scene, camera, { strength: 0.6, radius: 0.5, threshold: 0.9 });
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
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = cells.map((c) => c.mesh);
  const pick = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.index as number) : null;
  };
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => {
    downAt = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
    downAt = null;
    if (moved > 5) return;
    const i = pick(e);
    if (i !== null && onCellClick) onCellClick(i);
  };
  const onMove = (e: PointerEvent) => {
    renderer.domElement.style.cursor = pick(e) !== null ? "pointer" : "grab";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  let lastCurrent: number | null = null;
  let lastBest: number | null = null;

  const setState = (state: ArrayVizState) => {
    cells.forEach((c, i) => {
      const isBest = i === state.best;
      const isCurrent = i === state.current;
      const color = isBest
        ? STATE_COLORS.best
        : isCurrent
          ? STATE_COLORS.current
          : state.visited.has(i)
            ? STATE_COLORS.visited
            : STATE_COLORS.idle;
      c.target.set(color);
      c.glow = isCurrent ? 0.85 : isBest ? 0.35 : 0;
      c.lift = isCurrent ? LIFT : 0;
      c.value.style.color = color === STATE_COLORS.current || color === STATE_COLORS.visited ? "#101014" : "#f4f4f5";
    });

    if (state.current === null) {
      pointer.visible = false;
    } else if (!pointer.visible) {
      pointer.position.x = cellX(state.current);
      pointer.visible = true;
    } else if (state.current !== lastCurrent) {
      animate(pointer.position, { x: cellX(state.current), duration: 450, ease: "out(3)" });
    }

    if (state.best === null) {
      maxEl.style.opacity = "0";
    } else {
      maxEl.style.opacity = "1";
      if (lastBest === null) {
        maxTag.position.x = cellX(state.best);
      } else if (state.best !== lastBest) {
        animate(maxTag.position, { x: cellX(state.best), duration: 450, ease: "out(3)" });
        const { mesh } = cells[state.best];
        animate(mesh.scale, { x: [1.25, 1], y: [1.25, 1], z: [1.25, 1], duration: 650, ease: "out(3)" });
      }
    }
    lastCurrent = state.current;
    lastBest = state.best;
  };

  let frame = 0;
  const start = performance.now();
  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const t = (now - start) / 1000;
    cells.forEach((c) => {
      const mat = c.mesh.material as THREE.MeshPhysicalMaterial;
      mat.color.lerp(c.target, 0.14);
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity += (c.glow - mat.emissiveIntensity) * 0.14;
      c.mesh.position.y += (c.lift - c.mesh.position.y) * 0.14;
    });
    pointer.position.y = POINTER_Y + Math.sin(t * 3) * 0.06;
    controls.update();
    composer.render();
    labels.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    setState,
    resetView,
    dispose() {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.domElement.removeEventListener("pointermove", onMove);
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
