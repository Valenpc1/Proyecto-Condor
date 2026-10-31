// Película de 14,5 s: vuelo 3D sobre el portal de El Cóndor.
// Cada cuadro sale de renderFrame(t): no hay timers ni transiciones, todo se calcula desde el tiempo.
import { Muxer, ArrayBufferTarget } from './node_modules/mp4-muxer/build/mp4-muxer.mjs';

const W = 1440, H = 1152, FOCAL = 1880, DUR = 14.5, FPS = 60;
const TILT = (56 * Math.PI) / 180, DEG = Math.PI / 180;
const SUB = 16, SHUTTER = 0.7 / FPS;                  // 16 subcuadros en 0,7 de cuadro: desenfoque de movimiento
const CARD_TOP = 283, CARD_W = 1018;
const TITLE = { line: 'Todo lo que ofrece la villa,', tail: 'en un solo lugar.', brand: 'El Cóndor' };

const L = await (await fetch('capture/layout.json')).json();
const PAGE_W = L.page.w, PAGE_H = L.page.h, HERO_H = L.hero.h;

/* ───────────── matemática ───────────── */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const ss = (u) => { u = clamp(u); return u * u * (3 - 2 * u); };
const sstep = (a, b, x) => ss((x - a) / (b - a));
const iss = (u) => { u = clamp(u); return u ** 3 - u ** 4 / 2; };        // integral de ss en [0, u]
const easeOut = (u) => 1 - (1 - clamp(u)) ** 3;
const quadInOut = (u) => { u = clamp(u); return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) ** 2; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

/* ───────────── cámara: una sola curva de velocidad ───────────── */

// Distancia recorrida en unidades de crucero (integral de la velocidad).
function glideDist(t) {
  let s = 0.5 * 0.6 * iss(t / 0.6);                                                        // sale del reposo
  if (t > 0.6) s += 0.5 * (Math.min(t, 1.25) - 0.6);                                        // media velocidad
  if (t > 1.25) s += 0.5 * (Math.min(t, 1.6) - 1.25) + 0.5 * 0.35 * iss((t - 1.25) / 0.35); // dobla
  if (t > 1.6) s += Math.min(t, 7.3) - 1.6;                                                  // crucero
  if (t > 7.3) s += (Math.min(t, 8.3) - 7.3) - 0.88 * iss(t - 7.3);                          // frena hasta 0,12
  if (t > 8.3) s += 0.12 * (t - 8.3);
  return s;
}
// El texto de La villa cruza el centro a 1,6 s y el título del footer a 8,0 s.
const Y_INTRO = L.introText.y + L.introText.h / 2, Y_FOOT = L.footerTitle.y + L.footerTitle.h / 2;
const CRUISE = (Y_FOOT - Y_INTRO) / (glideDist(8.0) - glideDist(1.6));
const Y0 = Y_INTRO - CRUISE * glideDist(1.6);
const glideY = (t) => Y0 + CRUISE * glideDist(t);

// Ascenso: zoom en escala logarítmica con velocidad trapezoidal suave.
function riseG(t) {
  let g = 0.6 * iss((t - 7.75) / 0.6);
  if (t > 8.35) g += Math.min(t, 8.95) - 8.35;
  if (t > 8.95) { const u = clamp((t - 8.95) / 0.3); g += 0.3 * (u - iss(u)); }
  return g / 1.05;
}
const S_END = (H - 2 * 42) / PAGE_H;                  // la página entera, una franja centrada
const S_CARD = CARD_W / PAGE_W;
const D_END = FOCAL / S_END;
const RISE_LN = Math.log(D_END / 1800);
const PIN_K = -(H - 42 - H / 2) / FOCAL;              // borde inferior a 42 px del pie del cuadro

function pinBottom(d, phi) {
  const s = Math.sin(phi), c = Math.cos(phi), b = d * c;
  return PAGE_H + (b * (s + PIN_K * c)) / (c - PIN_K * s) - d * s;
}
function frameOf(x, y, d, phi) {
  const sp = Math.sin(phi), cp = Math.cos(phi);
  return { d, phi, pos: [x, y + d * sp, d * cp], fwd: [0, -sp, -cp], up: [0, -cp, sp], right: [1, 0, 0] };
}
function cameraAt(t) {
  if (t < 9.25) {
    let d = 1500 + 300 * ss(t / 8.2), y = glideY(t), phi = TILT;
    if (t > 7.75) {
      d *= Math.exp(RISE_LN * riseG(t));
      phi = TILT * (1 - sstep(8.15, 8.95, t));
      y = lerp(y, pinBottom(d, phi), sstep(8.3, 8.65, t));
    }
    // el hero está alineado a la izquierda: el vuelo encuadra un poco a la izquierda y se centra al subir
    return frameOf(lerp(640, PAGE_W / 2, sstep(7.9, 9.0, t)), y, d, phi);
  }
  let s, y;
  if (t < 9.47) {                                      // vista cenital, acercándose un 3,5 %
    s = S_END * Math.exp(Math.log(1.035) * sstep(9.25, 9.47, t));
    y = PAGE_H / 2;
  } else if (t < 9.97) {                               // picada: el borde superior queda clavado y luego baja a 283
    const u = (t - 9.47) / 0.5, s0 = S_END * 1.035;
    s = Math.exp(lerp(Math.log(s0), Math.log(S_CARD), quadInOut(u)));
    const top = lerp(H / 2 - (PAGE_H / 2) * s0, CARD_TOP, sstep(0.45, 1, u));
    y = (H / 2 - top) / s;
  } else {                                             // tarjeta final, acercándose un 2 %
    s = S_CARD * (1 + 0.02 * ss((t - 9.97) / (DUR - 9.97)));
    y = HERO_H / 2 + (H / 2 - (CARD_TOP + (HERO_H * S_CARD) / 2)) / s;
  }
  return frameOf(PAGE_W / 2, y, FOCAL / s, 0);
}
function project(cam, P) {
  const v = sub(P, cam.pos), z = dot(v, cam.fwd);
  return [W / 2 + (FOCAL * dot(v, cam.right)) / z, H / 2 - (FOCAL * dot(v, cam.up)) / z, z];
}
function unproject(cam, sx, sy, zWorld) {
  const dir = add(cam.fwd, add(mul(cam.right, (sx - W / 2) / FOCAL), mul(cam.up, -(sy - H / 2) / FOCAL)));
  const k = (zWorld - cam.pos[2]) / dir[2];
  return [cam.pos[0] + k * dir[0], cam.pos[1] + k * dir[1], zWorld];
}
function clipRows(cam, jx, jy) {
  const near = 4, far = 2e5, A = (far + near) / (far - near), B = (-2 * far * near) / (far - near);
  const r0 = add(mul(cam.right, (2 * FOCAL) / W), mul(cam.fwd, (2 * jx) / W));
  const r1 = add(mul(cam.up, (2 * FOCAL) / H), mul(cam.fwd, (-2 * jy) / H));
  const row = (r, k = 0) => [r[0], r[1], r[2], -dot(r, cam.pos) + k];
  return new Float32Array([...row(r0), ...row(r1), ...row(mul(cam.fwd, A), B), ...row(cam.fwd)]);
}

/* ───────────── piezas que se levantan ───────────── */

const KIND = {
  heroChip:    { rest: 3, z: 70, tilt: 30, at: [0.1, 1.35] },
  heroButton:  { rest: 6, z: 26, tilt: 18, at: [0.2, 1.3] },
  chip:        { rest: 4, z: 26, tilt: 14, pass: [620, 40] },
  flyer:       { rest: 12, z: 200, tilt: 54, pass: [780, 110] },
  photo:       { rest: 8, z: 30, tilt: 14, pass: [640, 0] },
  card:        { rest: 12, z: 34, tilt: 10, pass: [640, 20] },
  testimonial: { rest: 22, z: 112, tilt: 30, at: [5.45, 6.3], edge: 44 },
  button:      { rest: 6, z: 24, tilt: 16, pass: [600, 40] },
};
const OVERRIDE = { clima: { z: 64 }, horas: { z: 76 }, cat1: { z: 125, tilt: 46, pass: [780, 60] } };
const PIECES = L.pieces.map((p) => ({
  ...p, ...KIND[p.kind], ...(OVERRIDE[p.name] || {}),
  cx: p.x + p.w / 2, cy: p.y + p.h / 2, cw: p.w / 2, ch: p.h / 2, hw: p.w / 2 + p.pad, hh: p.h / 2 + p.pad,
  below: p.y > HERO_H,
}));

function pieceState(p, t) {
  const u = p.at ? sstep(p.at[0], p.at[1], t)
    : ss((p.pass[0] - (p.cy - glideY(Math.min(t, 7.75)))) / (p.pass[0] - p.pass[1]));
  let tilt = p.tilt * DEG * u;
  let z = Math.max(lerp(p.rest, p.z, u), p.ch * Math.sin(tilt) + 6);   // el borde de abajo nunca atraviesa la página
  const settle = sstep(7.8, 9.0, t);                                   // en el ascenso todo vuelve a apoyarse
  return { z: lerp(z, p.rest * 0.5, settle), tilt: lerp(tilt, 0, settle) };
}

/* ───────────── las cuatro baldosas del logo ───────────── */

const TILE_TEX_PAD = 0.06;                          // margen transparente dentro de la textura
const camHang = cameraAt(1.35), camCard = cameraAt(9.97), D_CARD = camCard.d;
const HANG = [
  { s: [96, 176], z: 170, size: 150, rot: -8 }, { s: [282, 52], z: 90, size: 120, rot: 7 },
  { s: [1164, 58], z: 110, size: 130, rot: -5 }, { s: [1352, 182], z: 220, size: 165, rot: 10 },
].map((h) => ({ ...h, w: unproject(camHang, h.s[0], h.s[1], h.z) }));
const START = [0, 1, 2, 3].map((i) => [L.ctaLink.x + L.ctaLink.w + 56 + i * 46, L.cta.y + L.cta.h / 2, 0.8]);
const END = [
  { s: [211, CARD_TOP], z: 150, size: 158, rot: -9, from: [0, -700, 820], at: 9.5 },             // esquina izquierda, apenas suave
  { s: [70, 1092], z: D_CARD * 0.55, size: 250, rot: 12, from: [-380, 300, 0], at: 9.85 },        // desenfoque grande abajo
  { s: [1229, CARD_TOP], z: 24, size: 150, rot: 8, from: [0, -700, 760], at: 9.55 },             // esquina derecha, nítida
  { s: [1378, 1112], z: D_CARD * 0.6, size: 270, rot: -10, from: [380, 320, 0], at: 9.9 },        // desenfoque grande abajo
].map((e) => ({ ...e, w: unproject(camCard, e.s[0], e.s[1], e.z) }));

function tileState(i, t) {
  if (t < 2.7) {                                     // despegan junto al botón y quedan colgando fuera de las esquinas
    const h = HANG[i], u = ss((t - 0.1 - 0.06 * i) / (1.25 - 0.06 * i));
    const p = [lerp(START[i][0], h.w[0], u), lerp(START[i][1], h.w[1], u), lerp(START[i][2], h.z, u) + Math.sin(Math.PI * u) * 70];
    p[1] += 300 * sstep(1.2, 2.4, t);                // acompañan a la cámara 300 px y salen por arriba
    return { p, size: lerp(32, h.size, ss(u * 1.1)), tilt: 50 * DEG * ss(u * 1.4), rot: h.rot * DEG * u };
  }
  if (i === 1 && t > 4.6 && t < 6.4) {               // una pasa cerca del lente por el borde izquierdo a los 5,4 s
    const u = (t - 4.95) / 0.9, cam = cameraAt(t);
    return { p: unproject(cam, lerp(300, -260, u), lerp(1260, 560, u), 380), size: 128, tilt: 38 * DEG, rot: (-14 + 20 * u) * DEG };
  }
  const e = END[i];
  if (t < e.at) return null;
  const u = easeOut((t - e.at) / 0.9);
  const drift = [3 * Math.sin(0.9 * t + i * 1.7), 2.5 * Math.cos(0.7 * t + i * 2.3)];
  const k = (D_CARD - e.z) / FOCAL;                  // px de pantalla → px de página a esa altura
  return {
    p: [e.w[0] + (e.from[0] * (1 - u) + drift[0]) * k, e.w[1] + (e.from[1] * (1 - u) + drift[1]) * k, e.z + e.from[2] * (1 - u)],
    size: e.size, tilt: 0, rot: e.rot * DEG,
  };
}

/* ───────────── foco: lo que cruza el centro del cuadro ───────────── */

function rayHit(cam, c, tilt, rot, cw, ch) {
  const n = [0, Math.sin(tilt), Math.cos(tilt)], den = dot(cam.fwd, n);
  if (Math.abs(den) < 1e-4) return Infinity;
  const k = dot(sub(c, cam.pos), n) / den, hit = add(cam.pos, mul(cam.fwd, k)), v = sub(hit, c);
  let a = v[0], b = dot(v, [0, Math.cos(tilt), -Math.sin(tilt)]);
  [a, b] = [Math.cos(rot) * a + Math.sin(rot) * b, -Math.sin(rot) * a + Math.cos(rot) * b];
  return Math.abs(a) <= cw && Math.abs(b) <= ch && k > 0 ? k : Infinity;
}
function focusRaw(t) {
  const cam = cameraAt(t);
  if (t >= 7.75) return cam.d;
  let best = cam.d;
  for (const p of PIECES) {
    const s = pieceState(p, t);
    best = Math.min(best, rayHit(cam, [p.cx, p.cy, s.z], s.tilt, 0, p.cw, p.ch));
  }
  for (let i = 0; i < 4; i++) {
    const s = tileState(i, t);
    if (s) best = Math.min(best, rayHit(cam, s.p, s.tilt, s.rot, s.size / 2, s.size / 2));
  }
  return best;
}
function focusAt(t) {                                // suavizado en el tiempo, sin estado
  let s = 0, w = 0;
  for (let k = -4; k <= 4; k++) { const wk = Math.exp(-(k * k) / 8); s += wk * focusRaw(t + k * 0.04); w += wk; }
  return s / w;
}

/* ───────────── el cierre: picada, máscara y desvanecido ───────────── */

function diveState(t) {
  const u = clamp((t - 9.47) / 0.5);
  return {
    haze: t < 9.47 ? 0 : sstep(0.1, 0.55, u),      // lo de abajo del hero se funde con el piso…
    cut: t < 9.47 ? 0 : sstep(0.8, 1, u),          // …y recién al final se vuelve transparente
    maskH: lerp(PAGE_H, HERO_H, t < 9.47 ? 0 : sstep(0.5, 0.85, u)),
    radius: lerp(24, 38 / S_CARD, t < 9.47 ? 0 : sstep(0.3, 1, u)),
  };
}

/* ───────────── WebGL ───────────── */

const canvas = document.getElementById('film');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: true });
if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Falta EXT_color_buffer_float');
const ANISO = gl.getExtension('EXT_texture_filter_anisotropic');
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
window.gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

const COMMON = `#version 300 es
precision highp float;
uniform vec2 uRes;
vec3 floorAt(vec2 fc) {
  vec2 p = (fc - 0.5 * uRes) / (0.5 * uRes);
  return mix(vec3(0.9765, 0.9843, 0.9843), vec3(0.9490, 0.9529, 0.9647), smoothstep(0.0, 1.0, length(p) / 1.41421));
}
float sdRR(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
`;
const VS_FULL = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const VS_HEAD = `#version 300 es
precision highp float;
uniform vec4 uRow[4];
out float vDepth;
vec4 toClip(vec4 p) { vDepth = dot(uRow[3], p); return vec4(dot(uRow[0], p), dot(uRow[1], p), dot(uRow[2], p), vDepth); }
vec2 corner() { return vec2(gl_VertexID & 1, gl_VertexID >> 1); }
`;
const OUT2 = 'layout(location = 0) out vec4 oColor;\nlayout(location = 1) out vec4 oDepth;\n';

const SHADERS = {
  floor: [VS_FULL, COMMON + OUT2 + `
uniform vec3 uCam, uFwd, uUp, uRight; uniform vec2 uJit; uniform vec4 uMask; // altoMáscara, radio, altoHero, desvanecido
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec3 dir = uFwd + ((fc.x - 0.5 * uRes.x - uJit.x) / ${FOCAL}.0) * uRight + ((fc.y - 0.5 * uRes.y + uJit.y) / ${FOCAL}.0) * uUp;
  float k = dir.z < -1e-5 ? -uCam.z / dir.z : 1e5;
  vec2 P = (uCam + k * dir).xy;
  vec2 c = vec2(${PAGE_W / 2}.0, uMask.x * 0.5), b = vec2(${PAGE_W / 2}.0, uMask.x * 0.5);
  float wide = sdRR(P - c - vec2(0.0, 22.0), b, uMask.y), near = sdRR(P - c - vec2(0.0, 4.0), b, uMask.y);
  float fade = 1.0 - uMask.w * smoothstep(uMask.z, uMask.z + 140.0, P.y);
  float a = 1.0 - (1.0 - 0.12 * exp(-pow(max(wide, 0.0) / 52.0, 2.0) * 0.5)) * (1.0 - 0.09 * exp(-pow(max(near, 0.0) / 9.0, 2.0) * 0.5));
  oColor = vec4(mix(floorAt(fc), vec3(0.102, 0.129, 0.200), a * fade), 1.0);
  oDepth = vec4(k, 0.0, 0.0, 1.0);
}`],
  page: [VS_HEAD + `
uniform vec4 uRect; out vec2 vPage;
void main() { vec4 p = vec4(uRect.xy + corner() * uRect.zw, 0.0, 1.0); vPage = p.xy; gl_Position = toClip(p); }`,
  COMMON + OUT2 + `
uniform sampler2D uTex; uniform vec4 uRect, uMask; in vec2 vPage; in float vDepth;
void main() {
  vec4 c = texture(uTex, (vPage - uRect.xy) / uRect.zw);
  float sd = sdRR(vPage - vec2(${PAGE_W / 2}.0, uMask.x * 0.5), vec2(${PAGE_W / 2}.0, uMask.x * 0.5), uMask.y);
  float a = clamp(0.5 - sd / max(fwidth(sd), 1e-3), 0.0, 1.0);
  c.rgb = mix(c.rgb, floorAt(gl_FragCoord.xy), smoothstep(uMask.z, uMask.z + 60.0, vPage.y) * uMask.w);
  oColor = vec4(c.rgb * a, a); oDepth = vec4(vDepth * a, 0.0, 0.0, a);
}`],
  piece: [VS_HEAD + `
uniform vec4 uC, uS; out vec2 vUv;   // uC: x, y, z, inclinación · uS: medio ancho, medio alto, giro
void main() {
  vec2 c = corner(), q = (c * 2.0 - 1.0) * uS.xy;
  q = vec2(cos(uS.z) * q.x - sin(uS.z) * q.y, sin(uS.z) * q.x + cos(uS.z) * q.y);
  vUv = c; gl_Position = toClip(vec4(uC.x + q.x, uC.y + q.y * cos(uC.w), uC.z - q.y * sin(uC.w), 1.0));
}`,
  COMMON + OUT2 + `
uniform sampler2D uTex; uniform vec2 uFade; in vec2 vUv; in float vDepth;
void main() {
  vec4 c = texture(uTex, vUv);
  c.rgb = mix(c.rgb, floorAt(gl_FragCoord.xy) * c.a, uFade.x); c *= 1.0 - uFade.y;
  oColor = c; oDepth = vec4(vDepth * c.a, 0.0, 0.0, c.a);
}`],
  edge: [VS_HEAD + `
uniform vec4 uC, uS; out float vT;    // uS: medio ancho útil, medio alto, espesor
void main() {
  vec2 c = corner(); float ct = cos(uC.w), st = sin(uC.w);
  float u = (c.x * 2.0 - 1.0) * uS.x, w = c.y * uS.z;
  vT = c.y; gl_Position = toClip(vec4(uC.x + u, uC.y + uS.y * ct - w * st, uC.z - uS.y * st - w * ct, 1.0));
}`,
  COMMON + OUT2 + `
uniform vec2 uFade; in float vT; in float vDepth;
void main() {
  vec4 c = vec4(mix(vec3(0.992, 0.984, 0.965), vec3(0.93, 0.92, 0.90), vT), 1.0);
  c.rgb = mix(c.rgb, floorAt(gl_FragCoord.xy), uFade.x); c *= 1.0 - uFade.y;
  oColor = c; oDepth = vec4(vDepth * c.a, 0.0, 0.0, c.a);
}`],
  shadow: [VS_HEAD + `
uniform vec4 uC, uS; out vec2 vUv;    // uS.w: radio de desenfoque en px de página
void main() {
  vec2 c = corner(); float ct = max(cos(uC.w), 0.05);
  vec2 half_ = vec2(uS.x, uS.y * ct) + uS.w * 1.6, q = (c * 2.0 - 1.0) * half_;
  vUv = vec2(q.x / uS.x, q.y / (uS.y * ct)) * 0.5 + 0.5;
  q = vec2(cos(uS.z) * q.x - sin(uS.z) * q.y, sin(uS.z) * q.x + cos(uS.z) * q.y);
  gl_Position = toClip(vec4(uC.xy + vec2(0.10 * uC.z, 4.0 + 0.36 * uC.z) + q, 0.0, 1.0));
}`,
  COMMON + 'out vec4 oColor;\n' + `
uniform sampler2D uTex; uniform vec4 uSh; uniform float uRot; in vec2 vUv; in float vDepth;   // uSh: desenfoque en uv (x, y), lod, opacidad
void main() {
  float a = 0.0;
  for (int i = 0; i < 16; i++) {
    float r = sqrt((float(i) + 0.5) / 16.0), t = float(i) * 2.39996 + uRot;
    vec2 uv = vUv + vec2(cos(t), sin(t)) * r * uSh.xy;
    a += textureLod(uTex, uv, uSh.z).a * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  }
  oColor = vec4(vec3(0.102, 0.129, 0.200), 1.0) * (a / 16.0) * uSh.w;
}`],
  tileMax: [VS_FULL, COMMON + 'out vec4 o;\n' + `
uniform sampler2D uDepth; uniform float uFocus;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) * 16; float m = 0.0;
  for (int y = 0; y < 16; y++) for (int x = 0; x < 16; x++) {
    float d = texelFetch(uDepth, b + ivec2(x, y), 0).r;
    m = max(m, d < uFocus ? 75.0 * (uFocus - d) / d : 0.0);
  }
  o = vec4(min(m, 120.0));
}`],
  dilate: [VS_FULL, COMMON + 'out vec4 o;\n' + `
uniform sampler2D uTile;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), s = textureSize(uTile, 0); float m = 0.0;
  for (int y = -8; y <= 8; y++) for (int x = -8; x <= 8; x++) m = max(m, texelFetch(uTile, clamp(p + ivec2(x, y), ivec2(0), s - 1), 0).r);
  o = vec4(m);
}`],
  dof: [VS_FULL, COMMON + 'out vec4 o;\n' + `
uniform sampler2D uColor, uDepth, uTile; uniform float uFocus, uRot;
float coc(float d) { return clamp(d < uFocus ? 75.0 * (uFocus - d) / d : 6.0 * (d - uFocus) / d, 0.0, 120.0); }
void main() {
  vec2 fc = gl_FragCoord.xy;
  float dp = texelFetch(uDepth, ivec2(fc), 0).r, cp = coc(dp);
  float R = max(cp, texture(uTile, fc / uRes).r);
  vec3 color = texelFetch(uColor, ivec2(fc), 0).rgb;
  if (R < 0.5) { o = vec4(color, 1.0); return; }
  float lod = log2(max(1.0, R * 0.28)), tot = 1.0;
  float rot = uRot + 6.2831853 * fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 40; i++) {                     // 40 tomas en un disco de ángulo áureo
    float r = R * sqrt((float(i) + 0.5) / 40.0), a = float(i) * 2.39996323 + rot;
    vec2 uv = (fc + vec2(cos(a), sin(a)) * r) / uRes;
    vec3 c = textureLod(uColor, uv, lod).rgb;
    float d = textureLod(uDepth, uv, min(lod, 1.0)).r, cs = coc(d);
    if (d > dp) cs = min(cs, cp * 2.0);              // lo de atrás no se derrama sobre lo nítido
    color += mix(color / tot, c, smoothstep(r - 0.5, r + 0.5, cs));
    tot += 1.0;
  }
  o = vec4(color / tot, 1.0);
}`],
  overlay: [VS_FULL, COMMON + 'out vec4 o;\nuniform sampler2D uTex;\nvoid main() { o = texture(uTex, vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y)); }'],
  accum: [VS_FULL, COMMON + 'out vec4 o;\nuniform sampler2D uTex; uniform float uK;\nvoid main() { o = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0) * uK; }'],
  final: [VS_FULL, COMMON + 'out vec4 o;\nuniform sampler2D uTex;\n' + `
void main() {
  vec3 c = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0).rgb;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  o = vec4(c + (n - 0.5) / 255.0, 1.0);
}`],
};

function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
const P = {};
for (const [name, [vs, fs]] of Object.entries(SHADERS)) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(prog));
  const u = {};
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const info = gl.getActiveUniform(prog, i), key = info.name.replace(/\[0\]$/, '');
    u[key] = gl.getUniformLocation(prog, info.name);
  }
  P[name] = { prog, u };
}
gl.bindVertexArray(gl.createVertexArray());

function texture(w, h, internal, { mips = false, filter = gl.LINEAR } = {}) {
  const t = gl.createTexture(), levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, levels, internal, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function imageTexture(src) {                        // premultiplicada, con mipmaps y anisotrópico 16x
  const t = texture(src.width, src.height, gl.RGBA8, { mips: true });
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.generateMipmap(gl.TEXTURE_2D);
  if (ANISO) gl.texParameterf(gl.TEXTURE_2D, ANISO.TEXTURE_MAX_ANISOTROPY_EXT, 16);
  return t;
}
const loadImage = async (file) => createImageBitmap(await (await fetch(`capture/${file}`)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'premultiply' });
function target(tex, extra) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (extra) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, extra, 0);
  return fb;
}

// Texturas de la captura
const pageTiles = await Promise.all(L.tiles.map(async (t) => ({ ...t, tex: imageTexture(await loadImage(t.file)) })));
for (const p of PIECES) p.tex = imageTexture(await loadImage(p.file));

// Baldosa del logo: el faro del sitio sobre coral.
await document.fonts.load('500 74px Geist');
await document.fonts.load('italic 82px "Instrument Serif"');
function drawMark(g, x, y, size, tower, lantern) {
  const k = size / 26;
  g.save(); g.translate(x, y); g.scale(k, k);
  g.fillStyle = tower; g.fill(new Path2D('M9 24 L11 8 H15 L17 24Z'));
  g.fillStyle = lantern; g.beginPath(); g.roundRect(10, 3, 6, 5, 1); g.fill();
  g.globalAlpha = 0.5; g.fillStyle = tower; g.fill(new Path2D('M2 11 L9 9 V6Z M24 11 L17 9 V6Z'));
  g.restore();
}
function logoTile(size) {
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d'), m = size * TILE_TEX_PAD, s = size - 2 * m;
  g.fillStyle = '#E4684C'; g.beginPath(); g.roundRect(m, m, s, s, s * 0.24); g.fill();
  drawMark(g, m + s * 0.17, m + s * 0.15, s * 0.66, '#FBF6EC', '#0E2B33');
  return c;
}
const tileTex = imageTexture(logoTile(512));

// Destinos de render
const sceneColor = texture(W, H, gl.RGBA8, { mips: true }), sceneDepth = texture(W, H, gl.RGBA16F, { mips: true });
const sceneFB = target(sceneColor, sceneDepth);
const tileA = texture(W / 16, H / 16, gl.R16F, { filter: gl.NEAREST }), tileB = texture(W / 16, H / 16, gl.R16F);
const tileFBA = target(tileA), tileFBB = target(tileB);
const dofTex = texture(W, H, gl.RGBA8), dofFB = target(dofTex);
const accTex = texture(W, H, gl.RGBA16F, { filter: gl.NEAREST }), accFB = target(accTex);
const ovCanvas = new OffscreenCanvas(W, H), ov = ovCanvas.getContext('2d');
const ovTex = texture(W, H, gl.RGBA8);

/* ───────────── dibujo de un subcuadro ───────────── */

function use(name, uniforms = {}) {
  const p = P[name]; gl.useProgram(p.prog);
  gl.uniform2f(p.u.uRes, W, H);
  for (const [k, v] of Object.entries(uniforms)) {
    const loc = p.u[k]; if (!loc) continue;
    if (v instanceof Float32Array) gl.uniform4fv(loc, v);
    else if (typeof v === 'number') gl.uniform1f(loc, v);
    else [, , gl.uniform2fv, gl.uniform3fv, gl.uniform4fv][v.length].call(gl, loc, v);
  }
  return p;
}
function bindTex(p, name, tex, unit) {
  gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u[name], unit);
}
const quad = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
const full = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

function drawScene(t, jx, jy, k = 0, flat = false) {
  const cam = cameraAt(t), rows = clipRows(cam, jx, jy), dv = diveState(t);
  const mask = [dv.maskH, dv.radius, HERO_H, dv.haze];
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFB);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.BLEND);
  use('floor', { uCam: cam.pos, uFwd: cam.fwd, uUp: cam.up, uRight: cam.right, uJit: [jx, jy], uMask: mask }); full();

  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const tile of pageTiles) {
    const rect = [0, tile.y, PAGE_W, tile.h];
    if (tile.y > dv.maskH + 4) continue;
    const p = use('page', { uRow: rows, uRect: rect, uMask: mask }); bindTex(p, 'uTex', tile.tex, 0); quad();
  }

  // Todo lo que flota: piezas de la página y baldosas del logo.
  const items = PIECES.map((p) => {
    const s = flat ? { z: 0.5, tilt: 0 } : pieceState(p, t);   // flat: piezas apoyadas, se mueven con la página
    const fade = p.below ? [dv.haze, dv.cut] : [0, 0];
    return { tex: p.tex, x: p.cx, y: p.cy, z: s.z, tilt: s.tilt, rot: 0, hw: p.hw, hh: p.hh, cw: p.cw, ch: p.ch, fade, edge: p.edge };
  });
  for (let i = 0; i < 4 && !flat; i++) {
    const s = tileState(i, t);
    if (!s) continue;
    const half = s.size / 2 / (1 - 2 * TILE_TEX_PAD);
    items.push({ tex: tileTex, x: s.p[0], y: s.p[1], z: s.p[2], tilt: s.tilt, rot: s.rot, hw: half, hh: half, cw: s.size / 2, ch: s.size / 2, fade: [0, 0] });
  }
  items.sort((a, b) => a.z - b.z);

  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);   // las sombras no escriben profundidad
  for (const it of items) {
    const blur = 7 + 0.5 * it.z, ct = Math.max(Math.cos(it.tilt), 0.05);
    const texPerPage = it.tex === tileTex ? 256 / it.hw : 2;   // texels por px de página
    const p = use('shadow', {
      uRow: rows, uC: [it.x, it.y, it.z, it.tilt], uS: [it.hw, it.hh, it.rot, blur],
      uSh: [blur / (2 * it.hw), blur / (2 * it.hh * ct), Math.log2(Math.max(1, 0.44 * blur * texPerPage)), 0.26 * (1 - it.fade[0])], uRot: k * 2.39996,
    });
    bindTex(p, 'uTex', it.tex, 0); quad();
  }
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  for (const it of items) {
    if (it.edge) use('edge', { uRow: rows, uC: [it.x, it.y, it.z, it.tilt], uS: [it.cw - 24, it.ch, it.edge, 0], uFade: it.fade }), quad();
    const p = use('piece', { uRow: rows, uC: [it.x, it.y, it.z, it.tilt], uS: [it.hw, it.hh, it.rot, 0], uFade: it.fade });
    bindTex(p, 'uTex', it.tex, 0); quad();
  }
  gl.disable(gl.BLEND);
}

function drawDof(t, k) {
  const focus = focusAt(t);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, sceneColor); gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, sceneDepth); gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindFramebuffer(gl.FRAMEBUFFER, tileFBA); gl.viewport(0, 0, W / 16, H / 16);
  let p = use('tileMax', { uFocus: focus }); bindTex(p, 'uDepth', sceneDepth, 0); full();
  gl.bindFramebuffer(gl.FRAMEBUFFER, tileFBB);
  p = use('dilate'); bindTex(p, 'uTile', tileA, 0); full();
  gl.bindFramebuffer(gl.FRAMEBUFFER, dofFB); gl.viewport(0, 0, W, H);
  p = use('dof', { uFocus: focus, uRot: k * 2.39996 });
  bindTex(p, 'uColor', sceneColor, 0); bindTex(p, 'uDepth', sceneDepth, 1); bindTex(p, 'uTile', tileB, 2); full();
}

/* ───────────── título de cierre (capa 2D por encima de la escena) ───────────── */

const LINE_FONT = '500 74px Geist', TAIL_FONT = 'italic 400 82px "Instrument Serif"', BADGE_FONT = '500 21px Geist';
function layoutWords(text, font, spacing) {
  ov.font = font; ov.letterSpacing = spacing;
  const words = text.split(' '), space = ov.measureText(' ').width, widths = words.map((w) => ov.measureText(w).width);
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + space * (words.length - 1)) / 2;
  return words.map((w, i) => { const r = { w, x }; x += widths[i] + space; return r; });
}
const LINE = layoutWords(TITLE.line, LINE_FONT, '-1.5px'), TAIL = layoutWords(TITLE.tail, TAIL_FONT, '0px');

function drawWords(words, font, spacing, color, baseline, start, step, t) {
  ov.font = font; ov.letterSpacing = spacing; ov.fillStyle = color;
  words.forEach((wd, i) => {
    const e = easeOut((t - start - i * step) / 0.34);
    if (e <= 0) return;
    ov.globalAlpha = e;
    ov.filter = e < 0.995 ? `blur(${(12 * (1 - e)).toFixed(2)}px)` : 'none';
    ov.fillText(wd.w, wd.x, baseline + 16 * (1 - e));
  });
  ov.globalAlpha = 1; ov.filter = 'none';
}
function drawOverlay(t) {
  ov.clearRect(0, 0, W, H);
  const b = sstep(10.02, 10.34, t);
  if (b > 0) {
    ov.font = BADGE_FONT; ov.letterSpacing = '0px';
    const tw = ov.measureText(TITLE.brand).width, bw = 10 + 28 + 11 + tw + 20, bh = 46, x = W / 2 - bw / 2, y = 44 + 6 * (1 - b);
    ov.globalAlpha = b;
    ov.save(); ov.shadowColor = 'rgba(26,33,51,0.10)'; ov.shadowBlur = 22; ov.shadowOffsetY = 6;
    ov.fillStyle = '#FFFFFF'; ov.beginPath(); ov.roundRect(x, y, bw, bh, bh / 2); ov.fill(); ov.restore();
    ov.fillStyle = '#E4684C'; ov.beginPath(); ov.roundRect(x + 10, y + 9, 28, 28, 8); ov.fill();
    drawMark(ov, x + 13, y + 11.5, 22, '#FBF6EC', '#0E2B33');
    ov.fillStyle = '#0E2B33'; ov.textBaseline = 'middle'; ov.fillText(TITLE.brand, x + 49, y + bh / 2 + 1); ov.textBaseline = 'alphabetic';
    ov.globalAlpha = 1;
  }
  drawWords(LINE, LINE_FONT, '-1.5px', '#0E2B33', 172, 10.12, 0.06, t);
  drawWords(TAIL, TAIL_FONT, '0px', '#8B8B92', 256, 10.36, 0.05, t);
  gl.bindTexture(gl.TEXTURE_2D, ovTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ovCanvas);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dofFB); gl.viewport(0, 0, W, H);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const p = use('overlay'); bindTex(p, 'uTex', ovTex, 0); full();
  gl.disable(gl.BLEND);
}

/* ───────────── un cuadro completo ───────────── */

function renderFrame(t, sub = SUB, flat = false) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, accFB); gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  for (let k = 0; k < sub; k++) {
    const ts = clamp(sub > 1 ? t + ((k + 0.5) / sub - 0.5) * SHUTTER : t, 0, DUR);
    const jx = sub > 1 ? halton(k + 1, 2) - 0.5 : 0, jy = sub > 1 ? halton(k + 1, 3) - 0.5 : 0;
    drawScene(ts, jx, jy, k, flat);
    drawDof(ts, k);
    if (ts > 9.95) drawOverlay(ts);
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFB); gl.viewport(0, 0, W, H);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const p = use('accum', { uK: 1 / sub }); bindTex(p, 'uTex', dofTex, 0); full();
    gl.disable(gl.BLEND);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
  const p = use('final'); bindTex(p, 'uTex', accTex, 0); full();
}

/* ───────────── control con flujo óptico sobre una vista previa a 30 fps ───────────── */

const DS = 4, GW = W / DS, GH = H / DS;
const pixels = new Uint8Array(W * H * 4);
function grabGray() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const g = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    let s = 0;
    for (let yy = 0; yy < DS; yy++) {
      const row = (H - 1 - (y * DS + yy)) * W;          // readPixels entrega las filas de abajo hacia arriba
      for (let xx = 0; xx < DS; xx++) { const i = (row + x * DS + xx) * 4; s += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]; }
    }
    g[y * GW + x] = s / (DS * DS);
  }
  return g;
}
// Cuánto se movió un bloque entre dos cuadros: búsqueda exhaustiva (SAD) y ajuste parabólico.
function blockShift(a, b, cx, cy, bw, bh, rx, ry0, ry1) {
  const x0 = cx - bw / 2, y0 = cy - bh / 2, sad = new Map();
  let best = Infinity, bx = 0, by = 0, sum = 0, n = 0;
  for (let dy = ry0; dy <= ry1; dy++) for (let dx = -rx; dx <= rx; dx++) {
    let s = 0;
    for (let y = 0; y < bh; y++) {
      const ra = (y0 + y) * GW + x0, rb = (y0 + y + dy) * GW + x0 + dx;
      for (let x = 0; x < bw; x++) s += Math.abs(a[ra + x] - b[rb + x]);
    }
    s /= bw * bh; sad.set(`${dx},${dy}`, s); sum += s; n++;
    if (s < best) { best = s; bx = dx; by = dy; }
  }
  const at = (dx, dy) => sad.get(`${dx},${dy}`) ?? best;
  const fit = (m, c, p) => { const d = m - 2 * c + p; return d > 1e-6 ? (0.5 * (m - p)) / d : 0; };
  const mean = sum / n;   // un bloque liso no dice nada: exige textura además de un mínimo claro
  return { cx, cy, dx: bx + fit(at(bx - 1, by), best, at(bx + 1, by)), dy: by + fit(at(bx, by - 1), best, at(bx, by + 1)), conf: mean > 2 ? 1 - best / mean : 0 };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
// Velocidad por la página medida en los píxeles y expansión horizontal: durante el vuelo la expansión
// nunca debe ser positiva (eso sería un zoom hacia adentro). Cada bloque se compara con el movimiento que
// produciría la cámara en ese punto, y se toma la mediana de 15 bloques alrededor del centro.
// Se mide con las piezas apoyadas: al levantarse tienen su propio movimiento y taparían el de la cámara.
async function flowCheck(fps = 30, until = 8.2) {
  const xs = [45, 115, 180, 245, 315], ys = [GH / 2 - 30, GH / 2, GH / 2 + 30], rows = [];
  let prev = null;
  for (let i = 0; i <= Math.round(until * fps); i++) {
    const t = i / fps;
    renderFrame(t, 2, true);
    const g = grabGray();
    if (prev) {
      const c0 = cameraAt(t - 1 / fps), c1 = cameraAt(t);
      const expect = (b) => { const P = unproject(c0, b.cx * DS, b.cy * DS, 0), s = project(c1, P); return [(s[0] - b.cx * DS) / DS, (s[1] - b.cy * DS) / DS]; };
      const blocks = ys.flatMap((cy) => xs.map((cx) => blockShift(prev, g, cx, cy, 56, 36, 8, -28, 6)))
        .filter((b) => b.conf > 0.15).map((b) => ({ ...b, e: expect(b) }));
      const ratios = blocks.filter((b) => Math.abs(b.e[1]) > 0.3).map((b) => b.dy / b.e[1]);
      const exp = (pick) => ys.map((cy) => blocks.filter((b) => b.cy === cy)).filter((r) => r.length >= 2)
        .map((r) => (pick(r.at(-1)) - pick(r[0])) / (r.at(-1).cx - r[0].cx));
      const pageSpeed = (glideY(t) - glideY(t - 1 / fps)) * fps, me = exp((b) => b.dx);
      if (ratios.length >= 3) {
        rows.push({
          t, blocks: blocks.length, expected: pageSpeed, measured: median(ratios) * pageSpeed,
          expansion: me.length ? median(me) : 0, expectedExpansion: me.length ? median(exp((b) => b.e[0])) : 0,
        });
      }
    }
    prev = g;
    if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { cruise: CRUISE, rows };
}

/* ───────────── datos para la banda de sonido ───────────── */

const speedAt = (t) => (glideY(t + 0.005) - glideY(t - 0.005)) / 0.01 / CRUISE;
function motionCues() {                            // cuándo se levanta cada pieza (mitad de su despegue)
  const timeAtY = (y) => { let a = 0, b = 8.3; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (glideY(m) < y) a = m; else b = m; } return (a + b) / 2; };
  return PIECES.map((p) => ({
    t: p.at ? (p.at[0] + p.at[1]) / 2 : timeAtY(p.cy - (p.pass[0] + p.pass[1]) / 2),
    kind: p.kind, pan: clamp((p.cx - 640) / 760, -1, 1), size: p.w * p.h,
  }));
}
function wordCenters(words, font, spacing) { ov.font = font; ov.letterSpacing = spacing; return words.map((w) => w.x + ov.measureText(w.w).width / 2); }

/* ───────────── MP4: H.264 con WebCodecs, 60 fps ───────────── */

async function pickEncoder() {
  for (const codec of ['avc1.640033', 'avc1.64002A', 'avc1.4D0033']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
      const config = { codec, width: W, height: H, bitrate: 36e6, framerate: FPS, hardwareAcceleration, avc: { format: 'avc' } };
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    }
  }
  throw new Error('Este Chrome no codifica H.264');
}
async function pickAudioEncoder() {
  for (const [codec, mux] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const config = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    if ((await AudioEncoder.isConfigSupported(config)).supported) return { config, mux };
  }
  return null;
}
// La banda de movimientos: se sintetiza, se guarda como WAV y se codifica en el mismo MP4.
async function encodeAudio(muxer, audio, wavFile) {
  const { renderSoundtrack, toWav } = await import('./sound.js');
  const buffer = await renderSoundtrack({
    duration: DUR, speedAt, cues: motionCues(),
    words: { line: wordCenters(LINE, LINE_FONT, '-1.5px'), tail: wordCenters(TAIL, TAIL_FONT, '0px') },
  });
  if (!(await fetch(wavFile, { method: 'POST', body: toWav(buffer) })).ok) throw new Error('No se pudo guardar el WAV');
  let failure = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
  encoder.configure(audio.config);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let i = 0; i < buffer.length; i += 1024) {
    const n = Math.min(1024, buffer.length - i), data = new Float32Array(n * 2);
    data.set(left.subarray(i, i + n), 0); data.set(right.subarray(i, i + n), n);
    const chunk = new AudioData({ format: 'f32-planar', sampleRate: buffer.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / buffer.sampleRate) * 1e6), data });
    encoder.encode(chunk); chunk.close();
  }
  await encoder.flush();
  if (failure) throw failure;
}
async function encodeVideo(file = 'out/flyover.mp4', { sound = true } = {}) {
  const config = await pickEncoder(), audio = sound ? await pickAudioEncoder() : null;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(), fastStart: 'in-memory',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    ...(audio ? { audio: { codec: audio.mux, numberOfChannels: 2, sampleRate: 48000 } } : {}),
  });
  if (audio) await encodeAudio(muxer, audio, file.replace(/\.mp4$/, '_audio.wav'));
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  encoder.configure(config);
  const frames = Math.round(DUR * FPS), t0 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    renderFrame(i / FPS);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(frame, { keyFrame: i % FPS === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
    if (i % 60 === 59) console.log(`cuadro ${i + 1}/${frames} · ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  }
  await encoder.flush();
  if (failure) throw failure;
  muxer.finalize();
  const bytes = muxer.target.buffer;
  if (!(await fetch(file, { method: 'POST', body: bytes })).ok) throw new Error('No se pudo guardar el MP4');
  return { codec: config.codec, audio: audio?.config.codec ?? 'sin audio', hardware: config.hardwareAcceleration, frames, bytes: bytes.byteLength, seconds: (performance.now() - t0) / 1000 };
}

window.film = {
  W, H, FPS, DUR, CRUISE, Y0,
  renderFrame,
  still: (t, sub = SUB) => { renderFrame(t, sub); return canvas.toDataURL('image/png'); },
  cameraAt, glideY, focusAt, flowCheck, encodeVideo,
};
window.ready = true;
