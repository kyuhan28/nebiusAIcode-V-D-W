import * as THREE from "three";
import { animate } from "animejs";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addEnvironment, connect, createComposer, createGridFloor, createRenderer, createStars, disposeObject } from "./core";
import { toyMaterial } from "./materials";
import type { TreeNode, VizState } from "../trace/inorder-demo";
import { STATE_COLORS } from "../state-colors";


const X_GAP = 1.25;
const Y_GAP = 1.55;

export function createTreeScene(
  container: HTMLElement,
  nodes: Record<string, TreeNode>,
  rootId: string,
  onNodeClick?: (id: string) => void,
) {
  const renderer = createRenderer(container);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  container.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 18, 60);
  const envMap = addEnvironment(renderer, scene);
  scene.add(createStars(700, 3));

  const order: string[] = [];
  const depth: Record<string, number> = {};
  const walk = (id: string | undefined, d: number) => {
    if (!id) return;
    walk(nodes[id].left, d + 1);
    order.push(id);
    depth[id] = d;
    walk(nodes[id].right, d + 1);
  };
  walk(rootId, 0);
  const maxDepth = Math.max(...Object.values(depth));

  const sphere = new THREE.SphereGeometry(0.42, 40, 28);
  type Piece = { mesh: THREE.Mesh; label: HTMLDivElement; target: THREE.Color; glow: number };
  const pieces: Record<string, Piece> = {};
  order.forEach((id, i) => {
    const mesh = new THREE.Mesh(sphere, toyMaterial(STATE_COLORS.idle));
    mesh.position.set((i - (order.length - 1) / 2) * X_GAP, (maxDepth / 2 - depth[id]) * Y_GAP, 0);
    mesh.userData.id = id;
    scene.add(mesh);
    const label = document.createElement("div");
    label.textContent = String(nodes[id].value);
    Object.assign(label.style, {
      font: "600 15px system-ui, sans-serif",
      color: "#f4f4f5",
      transition: "color 200ms ease",
      userSelect: "none",
    });
    mesh.add(new CSS2DObject(label));
    pieces[id] = { mesh, label, target: new THREE.Color(STATE_COLORS.idle), glow: 0 };
  });

  type Edge = { mesh: THREE.Mesh; from: string; to: string; target: THREE.Color };
  const edges: Edge[] = [];
  order.forEach((id) => {
    (["left", "right"] as const).forEach((side) => {
      const child = nodes[id][side];
      if (!child) return;
      const mat = toyMaterial("#2c3042");
      const mesh = connect(pieces[id].mesh.position, pieces[child].mesh.position, 0.06, mat);
      scene.add(mesh);
      edges.push({ mesh, from: id, to: child, target: new THREE.Color("#2c3042") });
    });
  });

  const floorY = -(maxDepth / 2) * Y_GAP - 1.6;
  scene.add(createGridFloor(floorY, 120));

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.56;

  const home = new THREE.Vector3();
  const fit = () => {
    const halfW = ((order.length - 1) * X_GAP) / 2 + 1.4;
    const halfH = (maxDepth * Y_GAP) / 2 + 1.4;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(halfH / tanHalf, halfW / (tanHalf * camera.aspect));
    home.set(dist * 0.22, dist * 0.16, dist);
  };
  const resetView = () => {
    fit();
    camera.position.copy(home);
    controls.target.set(0, 0, 0);
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
  const composer = createComposer(renderer, scene, camera, { strength: 0.6, radius: 0.5, threshold: 0.9 });
  resize();
  resetView();
  const resizeObserver = new ResizeObserver(() => {
    resize();
  });
  resizeObserver.observe(container);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const meshes = Object.values(pieces).map((p) => p.mesh);
  const pick = (e: PointerEvent) => {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    return hit ? (hit.object.userData.id as string) : null;
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
    const id = pick(e);
    if (id && onNodeClick) onNodeClick(id);
  };
  const onMove = (e: PointerEvent) => {
    renderer.domElement.style.cursor = pick(e) ? "pointer" : "grab";
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);
  renderer.domElement.addEventListener("pointermove", onMove);

  let currentId: string | null = null;
  const focus = new THREE.Vector3();

  const setState = (state: VizState) => {
    Object.entries(pieces).forEach(([id, p]) => {
      const color =
        id === state.currentId
          ? STATE_COLORS.current
          : state.visited.has(id)
            ? STATE_COLORS.visited
            : state.onStack.has(id)
              ? STATE_COLORS.stack
              : STATE_COLORS.idle;
      p.target.set(color);
      p.glow = id === state.currentId ? 0.9 : state.visited.has(id) ? 0.15 : 0;
      p.label.style.color = color === STATE_COLORS.idle || color === STATE_COLORS.stack ? "#f4f4f5" : "#101014";
    });
    edges.forEach((e) => {
      const onPath = state.onStack.has(e.from) && (state.onStack.has(e.to) || e.to === state.currentId);
      e.target.set(onPath ? STATE_COLORS.stack : "#2c3042");
    });
    if (state.currentId && state.currentId !== currentId) {
      const { mesh } = pieces[state.currentId];
      animate(mesh.scale, { x: [1.4, 1], y: [1.4, 1], z: [1.4, 1], duration: 650, ease: "out(3)" });
    }
    currentId = state.currentId;
  };

  let frame = 0;
  const loop = () => {
    frame = requestAnimationFrame(loop);
    Object.values(pieces).forEach((p) => {
      const mat = p.mesh.material as THREE.MeshPhysicalMaterial;
      mat.color.lerp(p.target, 0.14);
      mat.emissive.copy(mat.color);
      mat.emissiveIntensity += (p.glow - mat.emissiveIntensity) * 0.14;
    });
    edges.forEach((e) => (e.mesh.material as THREE.MeshPhysicalMaterial).color.lerp(e.target, 0.14));
    if (currentId) focus.copy(pieces[currentId].mesh.position).multiplyScalar(0.3);
    else focus.set(0, 0, 0);
    controls.target.lerp(focus, 0.04);
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
