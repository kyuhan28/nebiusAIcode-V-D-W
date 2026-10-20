import * as THREE from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { HoverField } from "./hover-field";

/** Restrained palette: graphite surfaces, electric blue, cyan, violet, and white accents. */
export const JOURNEY = {
  graphite: "#283040",
  graphiteLight: "#2c3240",
  dim: "#11141a",
  edge: "#3a4a6a",
  visited: "#2f6bff",
  queued: "#1d6fa5",
  current: "#6fe9ff",
  special: "#8f6bff",
  white: "#e7e9ef",
} as const;

export type NodeState = "idle" | "dim" | "queued" | "visited" | "current" | "special";

/** Core color and glow per state. The glass shell stays dark; the core carries the meaning. */
const STATE_LOOK: Record<NodeState, { color: string; glow: number; ring: number; spin: number }> = {
  idle: { color: "#3446a0", glow: 0.35, ring: 0.5, spin: 0.35 },
  dim: { color: "#161b2a", glow: 0.04, ring: 0.12, spin: 0.15 },
  queued: { color: "#1d7fc0", glow: 0.8, ring: 0.9, spin: 0.7 },
  visited: { color: JOURNEY.visited, glow: 1.15, ring: 1.3, spin: 0.6 },
  current: { color: JOURNEY.current, glow: 2.3, ring: 2.4, spin: 2.6 },
  special: { color: JOURNEY.special, glow: 1.7, ring: 2, spin: 1.4 },
};

/** Dark, iridescent glass. Shared by every node of a kind. */
export function glassMaterial() {
  return new THREE.MeshPhysicalMaterial({
    color: "#070b1a",
    roughness: 0.1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 0.85,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [260, 520],
    sheen: 0.3,
    sheenColor: new THREE.Color("#5b7bff"),
    envMapIntensity: 1.6,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
}

/** A fresnel rim: brightest where the surface turns away from the viewer. */
function rimMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color("#3446a0") }, uStrength: { value: 0.6 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - clamp(abs(dot(normalize(vNormal), normalize(vView))), 0.0, 1.0), 2.4);
        gl_FragColor = vec4(uColor * uStrength * rim, rim);
      }
    `,
  });
}

/** Kept for structural parts such as plates and tracks. */
export function nodeMaterial(color: THREE.ColorRepresentation = JOURNEY.graphite) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.34,
    metalness: 0.25,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0,
  });
}

export type NodeKit = {
  shell: THREE.BufferGeometry;
  core: THREE.BufferGeometry;
  ring?: THREE.BufferGeometry;
  glass: THREE.MeshPhysicalMaterial;
};

/** Glass sphere with a glowing core; the orbit ring is optional (graphs keep it, trees do not). */
export function sphereKit(radius: number, withRing = true): NodeKit {
  return {
    shell: new THREE.SphereGeometry(radius, 48, 32),
    core: new THREE.SphereGeometry(radius * 0.6, 32, 20),
    ring: withRing ? new THREE.TorusGeometry(radius * 1.38, 0.016, 8, 120) : undefined,
    glass: glassMaterial(),
  };
}

export function boxKit(w: number, h: number, d: number, round: number): NodeKit {
  return {
    shell: new RoundedBoxGeometry(w, h, d, 4, round),
    core: new RoundedBoxGeometry(w * 0.6, h * 0.6, d * 0.6, 3, round * 0.6),
    glass: glassMaterial(),
  };
}

const TWO_PI = Math.PI * 2;
const tmpWorld = new THREE.Vector3();
const tmpColor = new THREE.Color();

/**
 * A node: glass shell, glowing core, and (for spheres) a tilted orbit ring.
 * Chapters set `base` (where the algorithm wants it) and `set()` (its state).
 * `update()` eases toward that, then layers the hover response on top.
 */
export class NodeVisual {
  /** Positioned at base + hover offset. Labels attach here so they never spin. */
  readonly object = new THREE.Group();
  /** Everything that spins on hover. */
  readonly spinner = new THREE.Group();
  readonly shell: THREE.Mesh;
  readonly core: THREE.Mesh;
  readonly coreMaterial: THREE.MeshStandardMaterial;
  private readonly rimMaterial = rimMaterial();
  private ringPivot: THREE.Group | null = null;
  private ringMaterial: THREE.MeshBasicMaterial | null = null;

  readonly base = new THREE.Vector3();
  /** Set when the node lives inside a moving parent, so hover can find its world position. */
  anchor: THREE.Object3D | null = null;
  targetScale = 1;
  glowScale = 1;
  /** The value label; it switches to dark text while the core is at its brightest. */
  label: HTMLElement | null = null;

  private targetColor = new THREE.Color(STATE_LOOK.idle.color);
  private targetGlow = STATE_LOOK.idle.glow;
  private targetRing = STATE_LOOK.idle.ring;
  private ringSpeed = STATE_LOOK.idle.spin;
  private ringGlow = STATE_LOOK.idle.ring;
  private scale = 0.0001;
  private hover = 0;
  private hovered = false;
  private spin = 0;
  private spinTarget = 0;
  private readonly offset = new THREE.Vector3();
  private readonly push = new THREE.Vector3();

  constructor(kit: NodeKit, seed = 0) {
    this.coreMaterial = new THREE.MeshStandardMaterial({
      color: STATE_LOOK.idle.color,
      emissive: new THREE.Color(STATE_LOOK.idle.color),
      emissiveIntensity: STATE_LOOK.idle.glow,
      roughness: 0.4,
    });
    this.core = new THREE.Mesh(kit.core, this.coreMaterial);
    this.shell = new THREE.Mesh(kit.shell, kit.glass);
    this.shell.renderOrder = 2;
    const rim = new THREE.Mesh(kit.shell, this.rimMaterial);
    rim.scale.setScalar(1.025);
    rim.renderOrder = 3;
    this.spinner.add(this.core, this.shell, rim);

    if (kit.ring) {
      this.ringMaterial = new THREE.MeshBasicMaterial({ color: STATE_LOOK.idle.color, transparent: true, opacity: 0.85 });
      const ring = new THREE.Mesh(kit.ring, this.ringMaterial);
      ring.rotation.x = Math.PI / 2;
      this.ringPivot = new THREE.Group();
      this.ringPivot.rotation.set(0.5 + ((seed * 0.37) % 0.6), seed * 1.7, 0.25 - ((seed * 0.53) % 0.5));
      this.ringPivot.add(ring);
      this.spinner.add(this.ringPivot);
    }
    this.object.add(this.spinner);
    this.object.scale.setScalar(0.0001);
  }

  /** tint overrides the state's color (e.g. one color per k-means cluster) but keeps its glow. */
  set(state: NodeState, scale = this.targetScale, tint?: string) {
    const look = STATE_LOOK[state];
    this.targetColor.set(tint ?? look.color);
    this.targetGlow = look.glow * this.glowScale;
    this.targetRing = look.ring;
    this.ringSpeed = look.spin;
    this.targetScale = scale;
    if (this.label) {
      const bright = state === "current";
      this.label.style.color = bright ? "#041016" : JOURNEY.white;
      this.label.style.textShadow = bright ? "0 0 4px rgba(255,255,255,0.6)" : "0 0 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)";
    }
  }

  update(k: number, dt: number, field: HoverField | null) {
    /* State easing */
    this.coreMaterial.color.lerp(this.targetColor, k);
    this.coreMaterial.emissive.copy(this.coreMaterial.color);
    this.scale += (this.targetScale - this.scale) * k;

    /* Hover: how close the pointer is, and which way to push away from it */
    let target = 0;
    this.push.set(0, 0, 0);
    if (field && this.object.visible && this.targetScale > 0.2) {
      tmpWorld.copy(this.base);
      if (this.anchor) tmpWorld.add(this.anchor.position);
      target = field.influence(tmpWorld, this.push);
    }
    const kh = 1 - Math.exp(-dt * 9);
    this.hover += (target - this.hover) * kh;
    this.offset.lerp(this.push, kh);

    if (field && !field.reducedMotion) {
      if (!this.hovered && this.hover > 0.55) {
        this.hovered = true;
        this.spinTarget += TWO_PI;
      } else if (this.hovered && this.hover < 0.2) {
        this.hovered = false;
      }
      this.spin += (this.spinTarget - this.spin) * (1 - Math.exp(-dt * 3.4));
      if (this.spinTarget > 1000) {
        this.spin -= this.spinTarget;
        this.spinTarget = 0;
      }
    }

    this.object.position.copy(this.base).add(this.offset);
    this.object.scale.setScalar(Math.max(this.scale * (1 + this.hover * 0.18), 0.0001));
    this.spinner.rotation.y = this.spin;
    this.coreMaterial.emissiveIntensity += (this.targetGlow + this.hover * 0.9 - this.coreMaterial.emissiveIntensity) * k;

    this.rimMaterial.uniforms.uColor.value.copy(this.coreMaterial.color);
    this.rimMaterial.uniforms.uStrength.value = 0.5 + this.coreMaterial.emissiveIntensity * 0.55;

    this.ringGlow += (this.targetRing + this.hover * 1.2 - this.ringGlow) * k;
    if (this.ringPivot && this.ringMaterial) {
      tmpColor.copy(this.coreMaterial.color).multiplyScalar(this.ringGlow);
      this.ringMaterial.color.copy(tmpColor);
      this.ringPivot.rotation.y += dt * (this.ringSpeed + this.hover * 4);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** A wire between two points: a thin core plus a soft additive sleeve that glows when lit. */
export class EdgeVisual {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshStandardMaterial;
  private readonly sleeveMaterial: THREE.MeshBasicMaterial;
  private length = 1;
  private targetColor = new THREE.Color(JOURNEY.edge);
  private targetGlow = 0.15;
  private targetSleeve = 0;

  constructor(geometry: THREE.BufferGeometry, from: THREE.Vector3, to: THREE.Vector3, sleeve?: THREE.BufferGeometry) {
    this.material = new THREE.MeshStandardMaterial({
      color: JOURNEY.edge,
      roughness: 0.5,
      metalness: 0.3,
      emissive: new THREE.Color(JOURNEY.edge),
      emissiveIntensity: 0.15,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.sleeveMaterial = new THREE.MeshBasicMaterial({
      color: JOURNEY.visited,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    if (sleeve) this.mesh.add(new THREE.Mesh(sleeve, this.sleeveMaterial));
    this.place(from, to);
  }

  place(from: THREE.Vector3, to: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(to, from);
    this.length = Math.max(dir.length(), 0.0001);
    this.mesh.position.copy(from);
    this.mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  }

  grow(amount: number) {
    this.mesh.visible = amount > 0.001;
    this.mesh.scale.set(1, this.length * amount, 1);
  }

  set(state: "idle" | "trail" | "active" | "special") {
    const look = {
      idle: [JOURNEY.edge, 0.15, 0],
      trail: [JOURNEY.visited, 0.9, 0.22],
      active: [JOURNEY.current, 1.5, 0.4],
      special: [JOURNEY.special, 1.3, 0.34],
    }[state] as [string, number, number];
    this.targetColor.set(look[0]);
    this.targetGlow = look[1];
    this.targetSleeve = look[2];
  }

  update(k: number) {
    this.material.color.lerp(this.targetColor, k);
    this.material.emissive.copy(this.material.color);
    this.material.emissiveIntensity += (this.targetGlow - this.material.emissiveIntensity) * k;
    this.sleeveMaterial.color.copy(this.material.color);
    this.sleeveMaterial.opacity += (this.targetSleeve - this.sleeveMaterial.opacity) * k;
  }
}

/** Unit-height cylinder with its base at the origin, shared by every edge. */
export function edgeGeometry(radius: number) {
  const g = new THREE.CylinderGeometry(radius, radius, 1, 10, 1);
  g.translate(0, 0.5, 0);
  return g;
}

/** A glowing orb that marks where an algorithm is "standing". */
export function createCursor(radius = 0.17) {
  const mat = new THREE.MeshStandardMaterial({
    color: "#c9f6ff",
    emissive: new THREE.Color("#9eefff"),
    emissiveIntensity: 2,
    roughness: 0.3,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  mesh.visible = false;
  return mesh;
}

/** Labels are HTML overlays positioned in 3D. Their opacity is managed per chapter. */
export class LabelSet {
  readonly elements: HTMLDivElement[] = [];
  private opacity = -1;

  make(text: string, kind: "value" | "small" | "tag" | "marker" = "value") {
    const el = document.createElement("div");
    el.textContent = text;
    const styles: Record<string, Partial<CSSStyleDeclaration>> = {
      value: {
        font: "600 clamp(10px, 2.1vmin, 15px) var(--journey-font, system-ui), sans-serif",
        color: JOURNEY.white,
        textShadow: "0 0 6px rgba(0,0,0,0.95), 0 0 2px rgba(0,0,0,0.9)",
      },
      small: { font: "500 clamp(10px, 1.95vmin, 13.5px) var(--journey-font, system-ui), sans-serif", color: "#7d8496" },
      tag: {
        font: "500 clamp(10px, 1.95vmin, 13.5px) var(--journey-font, system-ui), sans-serif",
        color: "#c9d2e3",
        padding: "3px 9px",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "999px",
        background: "rgba(8,10,14,0.7)",
      },
      marker: { font: "600 clamp(10px, 1.95vmin, 13.5px) var(--journey-font, system-ui), sans-serif", color: JOURNEY.current },
    };
    Object.assign(el.style, { userSelect: "none", whiteSpace: "nowrap", pointerEvents: "none", ...styles[kind] });
    this.elements.push(el);
    return { el, obj: new CSS2DObject(el) };
  }

  setOpacity(value: number) {
    const v = Math.round(value * 20) / 20;
    if (v === this.opacity) return;
    this.opacity = v;
    const css = String(v);
    this.elements.forEach((el) => {
      el.style.opacity = css;
      el.style.visibility = v === 0 ? "hidden" : "visible";
    });
  }
}

export function pointOnPath(points: THREE.Vector3[], t: number, out: THREE.Vector3) {
  if (points.length === 1) return out.copy(points[0]);
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let d = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] || i === lengths.length - 1) {
      return out.lerpVectors(points[i], points[i + 1], lengths[i] ? Math.min(d / lengths[i], 1) : 1);
    }
    d -= lengths[i];
  }
  return out.copy(points[points.length - 1]);
}

export const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeOutBack = (x: number) => {
  const c = 1.6;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};
