import * as THREE from "three";

/**
 * Measures how close the pointer is to points in the scene, in screen pixels, and
 * returns a push direction that moves them away from it in the camera's view plane.
 */
export class HoverField {
  readonly reducedMotion: boolean;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pointer = new THREE.Vector2();
  private active = false;
  private width = 1;
  private height = 1;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly ndc = new THREE.Vector3();
  private readonly toPoint = new THREE.Vector3();

  /** Influence radius and maximum push, in CSS pixels. */
  radius = 170;
  pushPixels = 34;

  constructor(camera: THREE.PerspectiveCamera, reducedMotion: boolean) {
    this.camera = camera;
    this.reducedMotion = reducedMotion;
    if (reducedMotion) this.pushPixels = 14;
  }

  setViewport(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  setPointer(x: number, y: number, inside: boolean) {
    this.pointer.set(x, y);
    this.active = inside;
  }

  /** Call once per frame after the camera has moved. */
  beginFrame() {
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    this.camera.getWorldDirection(this.forward);
  }

  /** Returns influence in [0, 1] and writes the world-space push into `out`. */
  influence(world: THREE.Vector3, out: THREE.Vector3) {
    out.set(0, 0, 0);
    if (!this.active) return 0;
    this.ndc.copy(world).project(this.camera);
    if (this.ndc.z > 1 || this.ndc.z < -1) return 0;
    const sx = ((this.ndc.x + 1) / 2) * this.width;
    const sy = ((1 - this.ndc.y) / 2) * this.height;
    const dx = sx - this.pointer.x;
    const dy = sy - this.pointer.y;
    const d = Math.hypot(dx, dy);
    if (d >= this.radius) return 0;
    const t = 1 - d / this.radius;
    const h = t * t * (3 - 2 * t);

    /* Convert a screen-space push into world units at this point's depth. */
    const depth = this.toPoint.subVectors(world, this.camera.position).dot(this.forward);
    const worldPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * depth) / this.height;
    const len = d || 1;
    const amount = h * this.pushPixels * worldPerPixel;
    out.addScaledVector(this.right, (dx / len) * amount).addScaledVector(this.up, (-dy / len) * amount);
    return h;
  }
}
