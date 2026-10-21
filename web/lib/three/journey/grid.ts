import * as THREE from "three";

export type GridLook = {
  minor: string;
  major: string;
  cell: number;
  /** Opacity of minor and major lines before distance fading. */
  minorAlpha: number;
  majorAlpha: number;
};

/**
 * The white grid floor (landing page and visualizer): subtle and see-through, so it gives the
 * space a floor without competing with what sits on it. Minor lines are barely there.
 */
export const JOURNEY_GRID: GridLook = { minor: "#ffffff", major: "#ffffff", cell: 2, minorAlpha: 0.07, majorAlpha: 0.24 };
/**
 * An endless-looking floor grid. Lines are computed in world space, so the plane can
 * follow the camera without the lines sliding, and they fade out with distance.
 */
/**
 * The floor's height so that everything drawn stays above it: its usual height, or lower, keeping
 * `clearance` below the lowest point, when a tall table, matrix, tree, or long array reaches down.
 */
export function floorBelow(lowestY: number, usual: number, clearance: number): number {
  return Math.min(usual, lowestY - clearance);
}

export function createInfiniteGrid(y: number, look: GridLook = JOURNEY_GRID) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMinor: { value: new THREE.Color(look.minor) },
      uMajor: { value: new THREE.Color(look.major) },
      uMinorAlpha: { value: look.minorAlpha },
      uMajorAlpha: { value: look.majorAlpha },
      uCell: { value: look.cell },
      uFade: { value: 90 },
      uCamera: { value: new THREE.Vector3() },
      uReveal: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uMinor;
      uniform vec3 uMajor;
      uniform float uMinorAlpha;
      uniform float uMajorAlpha;
      uniform float uCell;
      uniform float uFade;
      uniform vec3 uCamera;
      uniform float uReveal;
      varying vec3 vWorld;

      float lines(vec2 coord) {
        vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
        return 1.0 - min(min(grid.x, grid.y), 1.0);
      }

      void main() {
        float minor = lines(vWorld.xz / uCell);
        float major = lines(vWorld.xz / (uCell * 5.0));
        float dist = distance(vWorld.xz, uCamera.xz);
        float fade = 1.0 - smoothstep(uFade * 0.2, uFade, dist);
        float reveal = smoothstep(0.0, 1.0, uReveal * 1.4 - dist / (uFade * 1.2));
        vec3 color = mix(uMinor, uMajor, major);
        float alpha = max(minor * uMinorAlpha, major * uMajorAlpha) * fade * reveal;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = -1;

  return {
    mesh,
    update(camera: THREE.Camera, reveal: number, fade: number) {
      mesh.position.x = camera.position.x;
      mesh.position.z = camera.position.z;
      material.uniforms.uCamera.value.copy(camera.position);
      material.uniforms.uReveal.value = reveal;
      material.uniforms.uFade.value = fade;
    },
  };
}
