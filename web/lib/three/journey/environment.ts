import * as THREE from "three";

/**
 * The landing journey's night backdrop: a deep blue sky with a soft horizon glow, rippling
 * reflective water at grid level, and particles drifting over it. Procedural, no textures.
 */

const SKY_GLSL = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform vec3 uBelow;
  /* Sky color for a direction: dark overhead, a blue band at the horizon, brightest down the valley (-z). */
  vec3 skyColor(vec3 d) {
    float h = d.y;
    vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.16, h));
    c = mix(c, uZenith, smoothstep(0.16, 0.62, h));
    vec2 flat2 = normalize(d.xz + vec2(1e-5));
    float toward = max(dot(flat2, vec2(0.0, -1.0)), 0.0);
    float band = exp(-abs(h) * 9.0);
    c += uGlow * band * (0.22 + 0.78 * pow(toward, 3.0));
    if (h < 0.0) c = mix(c, uBelow, smoothstep(0.0, 0.2, -h));
    return c;
  }
`;

function skyUniforms() {
  return {
    uZenith: { value: new THREE.Color("#010311") },
    uMid: { value: new THREE.Color("#030820") },
    uHorizon: { value: new THREE.Color("#081544") },
    uGlow: { value: new THREE.Color("#132d86") },
    uBelow: { value: new THREE.Color("#010209") },
  };
}

/* ---------------- Water ---------------- */

function waterMaterial(waterY: number) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...skyUniforms(),
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uDeep: { value: new THREE.Color("#01030b") },
      uSpark: { value: new THREE.Color("#a9dcff") },
      uPath: { value: new THREE.Color("#5c9cff") },
      uWaterY: { value: waterY },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      uniform float uTime;
      uniform float uMotion;
      uniform vec3 uDeep;
      uniform vec3 uSpark;
      uniform vec3 uPath;
      varying vec3 vWorld;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      /* Ripple slope from a few drifting wave trains; calmer with distance to avoid shimmer. */
      vec2 slope(vec2 p, float t, float calm) {
        vec2 s = vec2(0.0);
        s += vec2(0.8, 0.35) * cos(dot(p, vec2(0.8, 0.35)) * 0.9 + t * 1.1) * 0.06;
        s += vec2(-0.4, 0.9) * cos(dot(p, vec2(-0.4, 0.9)) * 1.7 - t * 1.4) * 0.04;
        s += vec2(0.95, -0.3) * cos(dot(p, vec2(0.95, -0.3)) * 3.1 + t * 2.0) * 0.025;
        s += vec2(0.2, 1.0) * cos(dot(p, vec2(0.2, 1.0)) * 5.3 + t * 2.6) * 0.015;
        return s * calm;
      }
      void main() {
        vec3 toFrag = vWorld - cameraPosition;
        float dist = length(toFrag);
        vec3 v = toFrag / dist;
        float t = uTime * uMotion;
        float calm = 1.0 / (1.0 + dist * 0.015);
        vec2 s = slope(vWorld.xz, t, calm);
        vec3 n = normalize(vec3(-s.x, 1.0, -s.y));
        vec3 r = reflect(v, n);
        r.y = abs(r.y);
        float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
        /* Even looking straight down, water mirrors the dark sky overhead rather than going black. */
        vec3 color = mix(uDeep, skyColor(r) * 0.72, clamp(max(fresnel * 0.92, 0.16), 0.0, 1.0));
        /* A glittering path of light toward the bright horizon. */
        vec3 l = normalize(vec3(0.0, 0.1, -1.0));
        float spec = pow(max(dot(r, l), 0.0), 260.0) * 2.4 + pow(max(dot(r, l), 0.0), 36.0) * 0.18;
        color += uPath * spec;
        /* Sparkles: tiny glints that wink on and off across the surface. */
        vec2 grid2 = vWorld.xz * 3.0;
        vec2 cell = floor(grid2);
        float seed = h21(cell);
        vec2 jitter = vec2(h21(cell + 7.1), h21(cell + 3.7)) * 0.6 + 0.2;
        float dot2 = smoothstep(0.09, 0.0, length(fract(grid2) - jitter));
        float wink = sin(t * (1.5 + seed * 3.0) + seed * 40.0) * 0.5 + 0.5;
        float spark = step(0.988, seed) * dot2 * pow(wink, 6.0) * smoothstep(0.05, 0.5, fresnel + 0.15) * calm * 2.2;
        color += uSpark * spark;
        float alpha = mix(0.95, 0.52, clamp(fresnel, 0.0, 1.0));
        gl_FragColor = vec4(color, alpha);
        #include <colorspace_fragment>
      }
    `,
  });
}

/* ---------------- Particles ---------------- */

function particles(count: number, box: THREE.Vector3, floorY: number) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * box.x;
    pos[i * 3 + 1] = floorY + 0.2 + Math.pow(Math.random(), 2.2) * box.y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * box.z;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMotion: { value: 1 },
      uBox: { value: box },
      uScale: { value: 1 },
      uColorA: { value: new THREE.Color("#4f8dff") },
      uColorB: { value: new THREE.Color("#d6ecff") },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      uniform float uMotion;
      uniform vec3 uBox;
      uniform float uScale;
      varying float vSeed;
      varying float vTwinkle;
      void main() {
        float t = uTime * uMotion;
        vec3 p = position + vec3(sin(t * 0.1 + aSeed * 30.0) * 1.5, sin(t * 0.25 + aSeed * 12.0) * 0.6, t * (0.25 + aSeed * 0.5));
        /* Wrap around the camera, so motes surround it wherever the journey goes. */
        vec2 rel = p.xz - cameraPosition.xz;
        rel = mod(rel + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
        p.xz = cameraPosition.xz + rel;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vSeed = aSeed;
        vTwinkle = 0.45 + 0.55 * pow(sin(t * (0.8 + aSeed * 2.2) + aSeed * 50.0) * 0.5 + 0.5, 3.0);
        float fade = 1.0 - smoothstep(0.42, 0.5, max(abs(rel.x) / uBox.x, abs(rel.y) / uBox.z));
        gl_PointSize = uScale * (0.7 + aSeed * 1.6) * 64.0 / -mv.z * fade;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vSeed;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(mix(uColorA, uColorB, vSeed * vSeed) * a * vTwinkle * 0.9, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return { points, material: m };
}

export function createEnvironment(options: { waterY: number; reducedMotion: boolean }) {
  const { waterY, reducedMotion } = options;
  const group = new THREE.Group();

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms(),
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), skyMat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  group.add(sky);

  const waterMat = waterMaterial(waterY);
  waterMat.uniforms.uMotion.value = reducedMotion ? 0.15 : 1;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), waterMat);
  water.position.y = waterY - 0.02;
  water.renderOrder = 1;
  water.frustumCulled = false;
  group.add(water);

  const motes = particles(1400, new THREE.Vector3(170, 26, 170), waterY);
  motes.material.uniforms.uMotion.value = reducedMotion ? 0 : 1;
  motes.points.renderOrder = 3;
  group.add(motes.points);

  return {
    group,
    /** The sky dome, so a scene can hide it and show something else behind the landscape. */
    sky,
    /** The rippling water surface, so a scene can leave the floor as a plain grid. */
    water,
    /** Fog color for objects in the scene, so distant structures fade into the night. */
    fogColor: new THREE.Color("#030719"),
    update(time: number, camera: THREE.PerspectiveCamera, pixelRatio: number) {
      sky.position.copy(camera.position);
      water.position.x = camera.position.x;
      water.position.z = camera.position.z;
      waterMat.uniforms.uTime.value = time;
      motes.material.uniforms.uTime.value = time;
      motes.material.uniforms.uScale.value = pixelRatio;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
    },
  };
}
