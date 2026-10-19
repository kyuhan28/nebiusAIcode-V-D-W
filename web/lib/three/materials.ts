import * as THREE from "three";

export const PALETTE = {
  violet: "#7c5cff",
  pink: "#e8458b",
  orange: "#f08a4b",
  mint: "#4fd8b0",
  butter: "#f2c94c",
  cobalt: "#3a5bff",
  coral: "#ff6b6b",
  lilac: "#b9a7ff",
} as const;

export const PALETTE_LIST = Object.values(PALETTE);

export function toyMaterial(color: THREE.ColorRepresentation, emissive = 0) {
  const c = new THREE.Color(color);
  const material = new THREE.MeshPhysicalMaterial({
    color: c,
    roughness: 0.32,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.18,
    emissive: c.clone(),
    emissiveIntensity: emissive,
  });
  material.userData.baseEmissive = emissive;
  return material;
}

export function lighten(color: THREE.ColorRepresentation, amount: number) {
  return new THREE.Color(color).lerp(new THREE.Color("#ffffff"), amount);
}

export function seededRandom(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
