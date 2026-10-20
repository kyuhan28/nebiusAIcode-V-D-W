import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { addEnvironment, createComposer, createRenderer, createStars, disposeObject } from "../core";
import { ANCHORS, FINALE_START, chapterAt, local } from "../../journey/timeline";
import { JOURNEY } from "./visuals";
import { createCameraRig } from "./camera-rig";
import { createInfiniteGrid } from "./grid";
import { HoverField } from "./hover-field";
import { createAmbient } from "./ambient";
import { createEnvironment } from "./environment";
import { createTreeChapter } from "./tree-chapter";
import { createSequenceChapter } from "./sequence-chapter";
import { createGraphChapter } from "./graph-chapter";
import { createLinearChapter } from "./linear-chapter";

export type JourneyOptions = {
  reducedMotion: boolean;
  onStatus?: (status: string) => void;
};

export function createJourneyScene(container: HTMLElement, options: JourneyOptions) {
  const renderer = createRenderer(container);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  container.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  /* Night landscape: sky, mountains, water, and particles. Fog fades structures into the same navy. */
  const env = createEnvironment({ waterY: -3.6, reducedMotion: options.reducedMotion });
  scene.add(env.group);
  scene.background = env.fogColor.clone();
  const fog = new THREE.Fog(env.fogColor, 26, 80);
  scene.fog = fog;
  const envMap = addEnvironment(renderer, scene);
  scene.environmentIntensity = 0.6;

  const grid = createInfiniteGrid(-3.6);
  /* The grid lies on the water, tinted to match the night. */
  {
    const u = (grid.mesh.material as THREE.ShaderMaterial).uniforms;
    u.uMinor.value.set("#1a2a5e");
    u.uMajor.value.set("#3554a8");
    grid.mesh.renderOrder = 2;
  }
  scene.add(grid.mesh);
  /* The route the camera travels, drawn on the floor and revealed in the finale. */
  const routeCurve = new THREE.CatmullRomCurve3(
    [ANCHORS.tree, ANCHORS.sequence, ANCHORS.graph, ANCHORS.linear].map((a) => new THREE.Vector3(a[0], -3.55, a[2])),
    false,
    "centripetal",
  );
  const routeMat = new THREE.LineDashedMaterial({ color: JOURNEY.visited, dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0 });
  const route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routeCurve.getPoints(240)), routeMat);
  route.computeLineDistances();
  scene.add(route);

  const stars = createStars(900, 21);
  (stars.material as THREE.PointsMaterial).opacity = 0.55;
  scene.add(stars);

  const tree = createTreeChapter();
  const sequence = createSequenceChapter();
  const graph = createGraphChapter();
  const linear = createLinearChapter();
  scene.add(tree.group, sequence.group, graph.group, linear.group);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 2000);
  const field = new HoverField(camera, options.reducedMotion);
  const rig = createCameraRig();
  const ambient = createAmbient(rig, options.reducedMotion);
  scene.add(ambient.group);
  const composer = createComposer(renderer, scene, camera, { strength: 0.42, radius: 0.32, threshold: 0.86 });

  /*
   * Tall screens see far less horizontally. Widen the lens a little and back off just enough
   * to keep the widest structure in frame, then shift the picture up so it
   * clears the captions at the bottom.
   */
  const BASE_FOV = 42;
  const REFERENCE_ASPECT = 1.45;
  let distanceScale = 1;
  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 55 : BASE_FOV;
    const tanBase = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    const tanNow = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    distanceScale = Math.max(1, (tanBase * REFERENCE_ASPECT) / (tanNow * camera.aspect));
    if (camera.aspect < 1) camera.setViewOffset(w, h, 0, h * 0.14, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    composer.setSize(w, h);
    field.setViewport(w, h);
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let visible = true;
  const visibility = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting));
  visibility.observe(container);

  const pointer = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  /* Mouse only: touch "hover" would fire while scrolling and push nodes around. */
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === "touch") {
      field.setPointer(0, 0, false);
      return;
    }
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    field.setPointer(x, y, x >= 0 && y >= 0 && x <= rect.width && y <= rect.height);
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  };
  const onLeave = (e: PointerEvent) => {
    if (!e.relatedTarget) field.setPointer(0, 0, false);
  };
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.addEventListener("pointerout", onLeave);

  let target = 0;
  let shown = 0;
  let lastStatus = "";
  const start = performance.now();
  let last = start;
  let frame = 0;
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const right = new THREE.Vector3();

  const loop = (now: number) => {
    frame = requestAnimationFrame(loop);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible) return;
    const t = (now - start) / 1000;

    shown += (target - shown) * (1 - Math.exp(-dt * (options.reducedMotion ? 30 : 3.2)));
    if (Math.abs(target - shown) < 1e-5) shown = target;
    const intro = options.reducedMotion ? 1 : THREE.MathUtils.clamp((t - 0.4) / 2.8, 0, 1);

    /* Camera: follow the rig, back off on tall screens, add a little pointer parallax. */
    rig.sample(shown, pos, look);
    offset.subVectors(pos, look).multiplyScalar(distanceScale);
    pos.copy(look).add(offset);
    if (!options.reducedMotion) {
      parallax.lerp(pointer, 1 - Math.exp(-dt * 2));
      right.crossVectors(offset, camera.up).normalize();
      pos.addScaledVector(right, parallax.x * 0.5).addScaledVector(camera.up, -parallax.y * 0.3);
    }
    camera.position.copy(pos);
    camera.lookAt(look);

    const finale = local(shown, FINALE_START, 1);
    fog.near = THREE.MathUtils.lerp(26, 150, finale);
    fog.far = THREE.MathUtils.lerp(80, 360, finale);
    env.update(t, camera, renderer.getPixelRatio());
    grid.update(camera, options.reducedMotion ? 1 : THREE.MathUtils.clamp(t / 1.8, 0, 1), THREE.MathUtils.lerp(90, 360, finale));
    stars.rotation.y = options.reducedMotion ? 0 : t * 0.003;
    routeMat.opacity = finale * 0.9;
    route.visible = finale > 0.01;

    /* Only draw structures near the current part of the journey; the finale shows everything. */
    const all = shown > 0.9;
    tree.group.visible = all || shown < 0.33;
    sequence.group.visible = all || (shown > 0.18 && shown < 0.76);
    graph.group.visible = all || shown > 0.6;
    linear.group.visible = shown > 0.78;

    const statuses: Record<string, string | null> = {};
    statuses.tree = tree.update(shown, intro);
    const seq = sequence.update(shown);
    statuses.list = statuses.array = statuses.hash = seq;
    statuses.graph = graph.update(shown);
    statuses.linear = linear.update(shown);

    const chapter = chapterAt(shown);
    const status = chapter ? (statuses[chapter.id] ?? "") : "";
    if (status !== lastStatus) {
      lastStatus = status;
      options.onStatus?.(status);
    }

    const k = 1 - Math.exp(-dt * 9);
    field.beginFrame();
    ambient.update(t, dt, field);
    tree.tick(k, dt, field);
    sequence.tick(k, dt, field);
    graph.tick(k, dt, field);
    linear.tick(k, dt, field);

    composer.render();
    labelRenderer.render(scene, camera);
  };
  frame = requestAnimationFrame(loop);

  return {
    setProgress(p: number) {
      target = THREE.MathUtils.clamp(p, 0, 1);
    },
    /** Skip the easing, for jumps where gliding through every chapter would be distracting. */
    jumpTo(p: number) {
      target = shown = THREE.MathUtils.clamp(p, 0, 1);
    },
    dispose() {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("pointerout", onLeave);
      resizeObserver.disconnect();
      visibility.disconnect();
      disposeObject(scene);
      envMap.dispose();
      env.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    },
  };
}
