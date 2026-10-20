/**
 * The galaxy sky behind the app, generated once per size and then left alone: a WebGL pass paints
 * deep space, the Milky Way, its dust lanes, and the nebula clouds; a 2D pass scatters the stars,
 * thickest along the band. The result lands in an ordinary 2D canvas and the WebGL context is
 * released at once, so nothing is redrawn per frame and no GPU context stays open.
 */

/** Where the band runs, in a frame with x in [0, aspect] and y in [0, 1] from the bottom. */
export const BAND = { coreX: 0.56, coreY: 0.43, angle: 9, width: 0.17 };

const VERT = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uSeed;
uniform vec4 uBand;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21) + uSeed);
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  vec2 d = p - vec2(uBand.x * aspect, uBand.y);
  float ang = radians(uBand.z);
  /* q.x runs along the band, q.y across it. */
  vec2 q = vec2(cos(ang) * d.x + sin(ang) * d.y, -sin(ang) * d.x + cos(ang) * d.y);

  /* Irregular edges: the band is pushed around by a slow warp field. */
  vec2 w = vec2(fbm(q * 1.8 + 3.1), fbm(q * 1.8 + 7.7));
  float across = q.y + (w.x - 0.5) * 0.2 + (w.y - 0.5) * 0.06 * q.x;
  float width = uBand.w * (0.8 + 0.5 * fbm(vec2(q.x * 1.3, 4.0)));
  float band = exp(-pow(across / width, 2.0));
  float halo = exp(-pow(across / (width * 2.8), 2.0));
  float along = exp(-pow(q.x / (0.95 * aspect), 2.0));
  vec2 c = q * vec2(1.55, 3.4);
  float core = exp(-dot(c, c) * 3.2);
  float coreWide = exp(-dot(q * vec2(0.85, 2.0), q * vec2(0.85, 2.0)) * 2.4);

  float n1 = fbm(q * vec2(3.0, 5.5) + w * 1.6);
  float n2 = fbm(q * vec2(6.0, 9.0) + 11.0 + w * 2.2);
  float n3 = fbm(p * 1.1 + 2.0);
  float dust = smoothstep(0.48, 0.76, fbm(q * vec2(4.5, 11.0) + w * 2.6 + 5.0)) * band;
  float rift = smoothstep(0.55, 0.85, fbm(q * vec2(2.0, 14.0) + 9.0)) * exp(-pow((across + 0.015) / (width * 0.35), 2.0));

  /* Deep space: near-black navy overhead, blue-indigo through the middle, violet dusk low down. */
  vec3 top = vec3(0.008, 0.013, 0.040);
  vec3 mid = vec3(0.026, 0.032, 0.085);
  vec3 low = vec3(0.070, 0.050, 0.120);
  vec3 col = mix(low, mid, smoothstep(0.0, 0.40, uv.y));
  col = mix(col, top, smoothstep(0.52, 1.0, uv.y));
  col += vec3(0.020, 0.016, 0.050) * (n3 - 0.45);

  /* Granular star clouds: fine-scale brightness that makes the band read as countless stars. */
  float grain = noise(q * 140.0) * 0.55 + noise(q * 60.0 + 3.0) * 0.45;
  float clump = smoothstep(0.35, 0.95, n1) * (0.55 + 0.9 * grain);

  vec3 blueWhite = vec3(0.50, 0.58, 0.82);
  vec3 lav = vec3(0.30, 0.30, 0.56);
  vec3 violet = vec3(0.11, 0.12, 0.30);
  vec3 rose = vec3(0.70, 0.40, 0.42);
  vec3 magenta = vec3(0.44, 0.20, 0.40);
  vec3 peach = vec3(1.0, 0.64, 0.38);

  /* The Milky Way: a faint violet halo, blue-white star clouds inside it, warm toward the core. */
  col += violet * halo * along * 0.30;
  /* Blue-white star clouds away from the core, warming to rose and peach as they reach it. */
  vec3 cloudTint = mix(mix(lav, blueWhite, n2), mix(rose, peach, 0.35), smoothstep(0.15, 0.7, coreWide));
  col += cloudTint * band * along * clump * 0.42;
  col += mix(rose, magenta, n2 * 0.7) * band * smoothstep(0.52, 0.85, n1) * coreWide * 0.42;
  col += rose * coreWide * 0.05;
  col += peach * core * (0.3 + 0.55 * smoothstep(0.4, 0.8, n1)) * (0.7 + 0.5 * grain);
  col += vec3(1.0, 0.86, 0.68) * pow(core, 4.0) * 0.32;

  /* Dust lanes and the dark rift take light away rather than adding color. */
  col *= 1.0 - dust * 0.8;
  col *= 1.0 - rift * 0.6;

  /* Low warm clouds on the right, like the lit cloud bank in the reference. */
  vec2 rc = (p - vec2(0.88 * aspect, 0.18)) * vec2(0.9, 1.6);
  float region = exp(-dot(rc, rc) * 5.0);
  float cloud = smoothstep(0.45, 0.72, fbm(p * vec2(3.5, 6.5) + w * 1.4 + 20.0));
  float lit = smoothstep(0.55, 0.85, fbm(p * vec2(5.0, 9.0) + 31.0));
  col = mix(col, vec3(0.10, 0.07, 0.13), region * cloud * 0.6);
  col += mix(vec3(0.36, 0.18, 0.30), vec3(0.92, 0.56, 0.46), lit) * region * cloud * lit * 0.42;

  /* A soft vignette and a dark floor so edges and the bottom fall into space. */
  float vig = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.15, 1.0)));
  col *= mix(0.5, 1.0, vig);
  col *= mix(0.55, 1.0, smoothstep(0.0, 0.16, uv.y));

  col += (hash(gl_FragCoord.xy + 0.5) - 0.5) / 255.0;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;

/** Paints the nebula into a fresh 2D canvas. Returns null when WebGL2 is unavailable. */
export function renderNebula(width: number, height: number, seed = 0.37): HTMLCanvasElement | null {
  const gl = document.createElement("canvas");
  gl.width = width;
  gl.height = height;
  const ctx = gl.getContext("webgl2", { antialias: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
  if (!ctx) return null;
  try {
    const program = ctx.createProgram()!;
    for (const [type, src] of [[ctx.VERTEX_SHADER, VERT], [ctx.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = ctx.createShader(type)!;
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      if (!ctx.getShaderParameter(sh, ctx.COMPILE_STATUS)) return null;
      ctx.attachShader(program, sh);
    }
    ctx.linkProgram(program);
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) return null;
    ctx.useProgram(program);
    const buf = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buf);
    ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW);
    const loc = ctx.getAttribLocation(program, "p");
    ctx.enableVertexAttribArray(loc);
    ctx.vertexAttribPointer(loc, 2, ctx.FLOAT, false, 0, 0);
    ctx.uniform2f(ctx.getUniformLocation(program, "uRes"), width, height);
    ctx.uniform1f(ctx.getUniformLocation(program, "uSeed"), seed);
    ctx.uniform4f(ctx.getUniformLocation(program, "uBand"), BAND.coreX, BAND.coreY, BAND.angle, BAND.width);
    ctx.viewport(0, 0, width, height);
    ctx.drawArrays(ctx.TRIANGLES, 0, 3);
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    out.getContext("2d")!.drawImage(gl, 0, 0);
    return out;
  } finally {
    /* One frame is all it is for: hand the GPU context back right away. */
    ctx.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/* ---------------- Stars ---------------- */

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How close a point (x, y from the top, both 0..1) is to the band: 1 on its axis, 0 far away. */
export function bandDensity(x: number, y: number, aspect: number) {
  const dx = (x - BAND.coreX) * aspect, dy = (1 - y) - BAND.coreY;
  const a = (BAND.angle * Math.PI) / 180;
  const along = Math.cos(a) * dx + Math.sin(a) * dy;
  const across = -Math.sin(a) * dx + Math.cos(a) * dy;
  return Math.exp(-((across / (BAND.width * 1.6)) ** 2)) * Math.exp(-((along / (1.1 * aspect)) ** 2));
}

const TINTS = ["244,246,255", "214,224,255", "255,236,214", "255,220,230", "232,226,255"];

export type Star = { x: number; y: number; r: number; a: number; tint: string };

/** Thousands of stars: mostly faint pinpricks, a few brighter ones, faint clusters along the band. */
export function makeStars(width: number, height: number, seed = 11): Star[] {
  const rand = rng(seed);
  const aspect = width / height;
  const stars: Star[] = [];
  const target = Math.round((width * height) / 120);
  for (let tries = 0; stars.length < target && tries < target * 4; tries++) {
    const x = rand(), y = rand();
    const dens = bandDensity(x, y, aspect);
    if (rand() > 0.32 + 0.68 * dens) continue;
    const roll = rand();
    /* Brightness falls off steeply, as in a photograph: many faint, some clear, very few bright. */
    const bright = roll > 0.994;
    const mid = !bright && roll > 0.78;
    stars.push({
      x: x * width, y: y * height,
      r: bright ? 1.0 + rand() * 0.5 : mid ? 0.55 + rand() * rand() * 0.45 : 0.4 + rand() * 0.3,
      a: bright ? 0.85 + rand() * 0.15 : mid ? 0.45 + rand() * 0.55 : 0.2 + rand() * rand() * 0.7,
      tint: TINTS[Math.floor(rand() * (rand() < 0.6 ? 2 : TINTS.length))],
    });
  }
  /* Distant clusters: tight, faint clumps strung along the band. */
  for (let c = 0; c < 9; c++) {
    let cx = 0, cy = 0;
    for (let k = 0; k < 40; k++) {
      cx = rand(); cy = rand();
      if (bandDensity(cx, cy, aspect) > 0.45) break;
    }
    const spread = 0.008 + rand() * 0.018;
    for (let k = 0; k < 70; k++) {
      const g = () => (rand() + rand() + rand() - 1.5) * spread;
      stars.push({ x: (cx + g() / aspect) * width, y: (cy + g()) * height, r: 0.3 + rand() * 0.35, a: 0.2 + rand() * 0.35, tint: TINTS[1] });
    }
  }
  return stars;
}

export function drawStars(ctx: CanvasRenderingContext2D, stars: Star[], scale: number, boost = 1) {
  for (const s of stars) {
    const r = s.r * scale;
    const a = Math.min(1, s.a * boost);
    if (s.r > 1) {
      /* Brighter stars get a soft halo rather than a hard disc. */
      const g = ctx.createRadialGradient(s.x * scale, s.y * scale, 0, s.x * scale, s.y * scale, r * 2.6);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.25, `rgba(${s.tint},${a * 0.7})`);
      g.addColorStop(1, `rgba(${s.tint},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(s.x * scale - r * 2.6, s.y * scale - r * 2.6, r * 5.2, r * 5.2);
    } else if (r < 0.75) {
      /* Pinpricks: a single soft pixel is cheaper than an arc and looks the same. */
      ctx.fillStyle = `rgba(${s.tint},${a * Math.min(1, r * 1.9)})`;
      ctx.fillRect(s.x * scale - 0.5, s.y * scale - 0.5, 1, 1);
    } else {
      ctx.fillStyle = `rgba(${s.tint},${a})`;
      ctx.beginPath();
      ctx.arc(s.x * scale, s.y * scale, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The whole static sky: nebula (or nothing, if WebGL is missing) and every star. */
export function renderSky(width: number, height: number, scale: number) {
  const W = Math.round(width * scale), H = Math.round(height * scale);
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;
  /* The nebula is soft, so it is painted at CSS resolution and scaled; stars stay crisp. */
  const nebula = renderNebula(Math.round(width), Math.round(height));
  if (nebula) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(nebula, 0, 0, W, H);
  }
  const stars = makeStars(width, height);
  drawStars(ctx, stars, scale);
  return { canvas: out, stars, nebula: !!nebula };
}

/** The brighter stars, split into groups that brighten and dim out of step with each other. */
export function renderTwinkle(width: number, height: number, stars: Star[], groups: number): HTMLCanvasElement[] {
  const rand = rng(97);
  const pick = stars.filter((s) => s.a > 0.5 || s.r > 0.8);
  return Array.from({ length: groups }, (_, g) => {
    const c = document.createElement("canvas");
    c.width = Math.round(width);
    c.height = Math.round(height);
    const ctx = c.getContext("2d")!;
    drawStars(ctx, pick.filter(() => Math.floor(rand() * groups) === g), 1, 1.6);
    return c;
  });
}
