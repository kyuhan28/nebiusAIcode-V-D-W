import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { seededRandom } from "./materials";

export function createRenderer(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);
  return renderer;
}

export function addEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envMap = pmrem.fromScene(room, 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = 0.45;
  room.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | undefined;
    if (mat) mat.dispose();
  });
  pmrem.dispose();

  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8f7bff, 0.8);
  rim.position.set(-6, 2, -6);
  scene.add(rim);
  return envMap;
}

export function createGridFloor(y: number, size = 160) {
  const grid = new THREE.GridHelper(size, size, 0x4a4a68, 0x2a2a3e);
  grid.position.y = y;
  const mat = grid.material as THREE.LineBasicMaterial;
  mat.transparent = true;
  mat.opacity = 0.9;
  mat.depthWrite = false;
  return grid;
}

export function createStars(count = 1400, seed = 7, look: { size?: number; opacity?: number } = {}) {
  const rand = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tints = [new THREE.Color("#ffffff"), new THREE.Color("#b9a7ff"), new THREE.Color("#9fe1cb"), new THREE.Color("#f5c4b3")];
  for (let i = 0; i < count; i++) {
    const r = 45 + rand() * 50;
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * 1.6 - 0.6);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    const tint = tints[Math.floor(rand() * tints.length)];
    const dim = 0.35 + rand() * 0.65;
    colors[i * 3] = tint.r * dim;
    colors[i * 3 + 1] = tint.g * dim;
    colors[i * 3 + 2] = tint.b * dim;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: look.size ?? 0.16,
    vertexColors: true,
    transparent: true,
    opacity: look.opacity ?? 0.9,
    fog: false,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  bloom = { strength: 0.45, radius: 0.5, threshold: 0.95 },
) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(size.clone(), bloom.strength, bloom.radius, bloom.threshold));
  composer.addPass(new OutputPass());
  return composer;
}

const UP = new THREE.Vector3(0, 1, 0);

export function connect(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const length = dir.length();
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    const withGeometry = obj as THREE.Mesh;
    if (withGeometry.geometry) geometries.add(withGeometry.geometry);
    const mat = withGeometry.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
    else if (mat) materials.add(mat);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
