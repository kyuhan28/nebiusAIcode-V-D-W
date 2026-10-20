import * as THREE from "three";
import { CAMERA_KEYS, smoother } from "../../journey/timeline";

/**
 * Turns scroll progress into a camera position and look target. Keyframes are joined
 * with centripetal Catmull-Rom curves; travel segments ease in and out.
 */
export function createCameraRig() {
  const posCurve = new THREE.CatmullRomCurve3(CAMERA_KEYS.map((k) => new THREE.Vector3(...k.pos)), false, "centripetal");
  const lookCurve = new THREE.CatmullRomCurve3(CAMERA_KEYS.map((k) => new THREE.Vector3(...k.look)), false, "centripetal");
  const last = CAMERA_KEYS.length - 1;

  const paramAt = (p: number) => {
    if (p <= CAMERA_KEYS[0].p) return 0;
    if (p >= CAMERA_KEYS[last].p) return 1;
    let i = 0;
    while (i < last - 1 && p > CAMERA_KEYS[i + 1].p) i++;
    const a = CAMERA_KEYS[i];
    const b = CAMERA_KEYS[i + 1];
    let f = (p - a.p) / (b.p - a.p);
    if (b.travel) f = smoother(f);
    return (i + f) / last;
  };

  return {
    sample(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
      const u = paramAt(p);
      posCurve.getPoint(u, pos);
      lookCurve.getPoint(u, look);
    },
  };
}
