import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const KEYS: Record<string, [number, number, number]> = {
  KeyW: [0, 0, 1],
  KeyS: [0, 0, -1],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyE: [0, 1, 0],
  KeyQ: [0, -1, 0],
};

/**
 * Walk through a scene: W/A/S/D move forward, left, back, and right along the ground; Q and E
 * move down and up; Shift goes faster. Camera and orbit target move together, so dragging still
 * looks around from wherever you are. Keys only apply while the canvas has focus, so typing in
 * the editor never moves the camera.
 */
export function attachWasd(
  canvas: HTMLElement,
  container: HTMLElement,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  onMove?: () => void,
) {
  canvas.tabIndex = 0;
  canvas.style.outline = "none";
  const held = new Set<string>();
  let fast = false;
  const velocity = new THREE.Vector3();
  const goal = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);

  const hint = document.createElement("div");
  Object.assign(hint.style, {
    position: "absolute",
    left: "16px",
    bottom: "12px",
    font: "500 12px system-ui, sans-serif",
    color: "#6b7385",
    pointerEvents: "none",
    userSelect: "none",
    transition: "color 200ms ease",
  } satisfies Partial<CSSStyleDeclaration>);
  container.appendChild(hint);
  const setHint = (focused: boolean) => {
    hint.textContent = focused
      ? "W A S D to move, Q and E for down and up, Shift for speed, drag to look"
      : "Click the scene to move around with W A S D";
    hint.style.color = focused ? "#9ee8ff" : "#6b7385";
  };
  setHint(false);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    fast = e.shiftKey;
    if (KEYS[e.code]) {
      held.add(e.code);
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    fast = e.shiftKey;
    held.delete(e.code);
  };
  const onPointerDown = () => canvas.focus({ preventScroll: true });
  const onFocus = () => setHint(true);
  const onBlur = () => {
    held.clear();
    setHint(false);
  };
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("keyup", onKeyUp);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("focus", onFocus);
  canvas.addEventListener("blur", onBlur);

  return {
    /** Call once per frame before controls.update(). */
    update(dt: number) {
      goal.set(0, 0, 0);
      if (held.size) {
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        right.crossVectors(forward, UP).normalize();
        for (const code of held) {
          const [x, y, z] = KEYS[code];
          goal.addScaledVector(right, x).addScaledVector(UP, y).addScaledVector(forward, z);
        }
        if (goal.lengthSq() > 0) {
          /* Speed scales with how far away you are looking, so it feels the same up close and far off. */
          const reach = camera.position.distanceTo(controls.target);
          goal.normalize().multiplyScalar(Math.max(3, reach * 0.7) * (fast ? 2.5 : 1));
        }
      }
      velocity.lerp(goal, 1 - Math.exp(-dt * 10));
      /* Come to a full stop instead of drifting forever by tiny amounts. */
      if (!held.size && velocity.lengthSq() < 0.0004) velocity.set(0, 0, 0);
      if (velocity.lengthSq() > 1e-6) {
        camera.position.addScaledVector(velocity, dt);
        controls.target.addScaledVector(velocity, dt);
        if (held.size) onMove?.();
      }
    },
    dispose() {
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("focus", onFocus);
      canvas.removeEventListener("blur", onBlur);
      hint.remove();
    },
  };
}
