// Banda de movimientos del fly-over, sintetizada con Web Audio: ruido filtrado y osciladores, sin muestras grabadas.
// Cada sonido sigue un momento de la película y el viento sigue la velocidad de la cámara.
export const RATE = 48000;

const prng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1; };
function noiseBuffer(ctx, seconds, seed) {
  const n = Math.ceil(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const r = prng(seed + c * 101), d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = r(); }
  return b;
}
function roomBuffer(ctx, seconds) {                 // cola de reverberación: ruido que decae
  const n = Math.ceil(seconds * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const r = prng(77 + c), d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = r() * (1 - i / n) ** 3.4; }
  return b;
}

// speedAt(t): velocidad de la cámara en fracción del crucero · cues: piezas que se levantan · words: x de cada palabra.
export async function renderSoundtrack({ duration, speedAt, cues, words }) {
  const ctx = new OfflineAudioContext(2, Math.round(duration * RATE), RATE);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.22;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(1, 0.35);
  master.gain.setValueAtTime(1, duration - 0.7); master.gain.linearRampToValueAtTime(0, duration);
  comp.connect(master).connect(ctx.destination);
  const dry = ctx.createGain(); dry.connect(comp);
  const verb = ctx.createConvolver(), wet = ctx.createGain();
  verb.buffer = roomBuffer(ctx, 2.6); wet.gain.value = 0.34; verb.connect(wet).connect(comp);
  const send = (node, amount) => { node.connect(dry); if (amount) { const g = ctx.createGain(); g.gain.value = amount; node.connect(g).connect(verb); } };

  const white = noiseBuffer(ctx, 4, 11);
  let offset = 0;
  const noise = (t, dur) => {
    const s = ctx.createBufferSource(); s.buffer = white; s.loop = true;
    s.start(t, (offset = (offset + 0.731) % 3.5)); s.stop(t + dur + 0.05);
    return s;
  };
  const filter = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };

  // Ráfaga de aire: una banda que barre de f0 a f1, con el pico de volumen en `peak` y paneo de p0 a p1.
  function whoosh({ peak, dur, f0, f1, q = 1.1, gain, p0 = 0, p1 = p0, room = 0.25, shape = 0.55 }) {
    const t = Math.max(0, peak - dur * shape), end = t + dur;
    const bp = filter('bandpass', f0, q), g = ctx.createGain(), pan = ctx.createStereoPanner();
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, end);
    g.gain.setValueAtTime(1e-4, t); g.gain.exponentialRampToValueAtTime(gain, Math.max(t + 0.01, peak)); g.gain.exponentialRampToValueAtTime(1e-4, end);
    pan.pan.setValueAtTime(p0, t); pan.pan.linearRampToValueAtTime(p1, end);
    noise(t, dur).connect(bp).connect(g).connect(pan); send(pan, room);
  }
  // Toque tonal corto que sube: despegue de una pieza chica.
  function blip({ t, f0, f1, dur = 0.09, gain = 0.07, pan = 0, room = 0.35 }) {
    const o = ctx.createOscillator(), g = ctx.createGain(), p = ctx.createStereoPanner();
    o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(1e-4, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    p.pan.value = pan; o.connect(g).connect(p); send(p, room); o.start(t); o.stop(t + dur + 0.02);
  }
  // Roce muy corto y agudo: cada palabra del título al aparecer.
  function tick({ t, freq, gain, pan = 0 }) {
    const bp = filter('bandpass', freq, 1.4), g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.setValueAtTime(1e-4, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.003); g.gain.exponentialRampToValueAtTime(1e-4, t + 0.05);
    p.pan.value = pan; noise(t, 0.06).connect(bp).connect(g).connect(p); send(p, 0.4);
  }
  // Golpe suave cuando la tarjeta aterriza: grave que cae, cuerpo apagado y un clic.
  function hit(t) {
    const sub = ctx.createOscillator(), sg = ctx.createGain();
    sub.frequency.setValueAtTime(118, t); sub.frequency.exponentialRampToValueAtTime(41, t + 0.38);
    sg.gain.setValueAtTime(1e-4, t); sg.gain.exponentialRampToValueAtTime(0.55, t + 0.006); sg.gain.exponentialRampToValueAtTime(1e-4, t + 1.7);
    sub.connect(sg); send(sg, 0.12); sub.start(t); sub.stop(t + 1.8);
    const lp = filter('lowpass', 900), bg = ctx.createGain();
    lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(160, t + 0.5);
    bg.gain.setValueAtTime(1e-4, t); bg.gain.exponentialRampToValueAtTime(0.3, t + 0.004); bg.gain.exponentialRampToValueAtTime(1e-4, t + 0.6);
    noise(t, 0.65).connect(lp).connect(bg); send(bg, 0.5);
    const hp = filter('highpass', 2600), cg = ctx.createGain();
    cg.gain.setValueAtTime(1e-4, t); cg.gain.exponentialRampToValueAtTime(0.16, t + 0.002); cg.gain.exponentialRampToValueAtTime(1e-4, t + 0.03);
    noise(t, 0.04).connect(hp).connect(cg); send(cg, 0.25);
  }

  // Viento del vuelo: sube y baja con la velocidad de la cámara, con un vaivén lento.
  const bedEnd = 9.7, steps = Math.ceil(bedEnd * 100), gCurve = new Float32Array(steps), fCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / 100, s = speedAt(Math.min(t, 8.3)) * (t > 8.3 ? Math.max(0, 1 - (t - 8.3) / 1.3) : 1);
    gCurve[i] = 0.016 + 0.13 * s; fCurve[i] = 360 + 1400 * s;
  }
  const bedLp = filter('lowpass', 400, 0.5), bedBp = filter('peaking', 900, 0.8), bedG = ctx.createGain();
  bedBp.gain.value = 4;
  bedLp.frequency.setValueCurveAtTime(fCurve, 0, bedEnd); bedG.gain.setValueCurveAtTime(gCurve, 0, bedEnd);
  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  lfo.frequency.value = 0.21; lfoDepth.gain.value = 0.018; lfo.connect(lfoDepth).connect(bedG.gain); lfo.start(0); lfo.stop(bedEnd);
  noise(0, bedEnd).connect(bedLp).connect(bedBp).connect(bedG); send(bedG, 0.12);

  // 0,1–1,35 s: las cuatro baldosas despegan junto al botón y vuelan a las esquinas de arriba.
  [-0.55, -0.35, 0.35, 0.55].forEach((p, i) => {
    const t = 0.1 + 0.06 * i;
    blip({ t: t + 0.02, f0: 480 + 45 * i, f1: 820 + 70 * i, gain: 0.06, pan: p * 0.4 });
    whoosh({ peak: t + 0.72, dur: 1.15, f0: 520, f1: 2600, q: 1.7, gain: 0.09, p0: 0, p1: p, room: 0.35 });
  });
  // 1,25–1,6 s: la cámara duplica la velocidad.
  whoosh({ peak: 1.55, dur: 0.8, f0: 220, f1: 900, q: 0.8, gain: 0.2, room: 0.15 });

  // Cada pieza que se levanta al pasar: ráfagas cortas, más fuertes cuanto más grande la pieza.
  for (const c of cues) {
    if (c.kind === 'flyer') {                       // las tarjetas que salen por los bordes a los 2,5 s
      const side = Math.sign(c.pan) || 1;
      whoosh({ peak: side < 0 ? 2.44 : 2.56, dur: 0.85, f0: 2200, f1: 260, q: 1, gain: 0.42, p0: side * 0.4, p1: side * 0.95, room: 0.2 });
    } else if (c.kind === 'testimonial') {          // el bloque de la Junta sube con su canto blanco
      whoosh({ peak: c.t + 0.2, dur: 1.05, f0: 260, f1: 1500, q: 1.3, gain: 0.15, p0: c.pan, room: 0.3 });
      blip({ t: 6.28, f0: 300, f1: 220, dur: 0.16, gain: 0.05, pan: c.pan, room: 0.4 });
    } else {
      const size = Math.min(1, Math.sqrt(c.size) / 500), r = prng(Math.round(c.t * 1000));
      whoosh({ peak: c.t, dur: 0.45 + 0.3 * size, f0: 700 + 300 * r(), f1: 2000 + 900 * r(), q: 1.8, gain: 0.035 + 0.08 * size, p0: c.pan * 0.6, p1: c.pan * 0.8, room: 0.3 });
    }
  }
  // 5,4 s: una baldosa pasa cerca del lente por el borde izquierdo.
  whoosh({ peak: 5.4, dur: 0.55, f0: 2600, f1: 380, q: 0.9, gain: 0.45, p0: -0.3, p1: -1, room: 0.15 });

  // 7,75–9,25 s: el ascenso. Aire que sube hasta el whoosh de 8,66 s.
  const riser = filter('bandpass', 260, 1.2), rg = ctx.createGain();
  riser.frequency.setValueAtTime(260, 7.55); riser.frequency.exponentialRampToValueAtTime(3200, 8.66);
  rg.gain.setValueAtTime(0.001, 7.55); rg.gain.linearRampToValueAtTime(0.22, 8.6); rg.gain.exponentialRampToValueAtTime(1e-4, 9.15);
  noise(7.55, 1.6).connect(riser).connect(rg); send(rg, 0.35);
  whoosh({ peak: 8.66, dur: 0.75, f0: 1800, f1: 300, q: 0.9, gain: 0.48, room: 0.3 });
  // 8,7–9,7 s: la página entera suspendida en el aire, antes de la picada.
  const hang = filter('lowpass', 900, 0.6), hg = ctx.createGain();
  hg.gain.setValueAtTime(1e-4, 8.7); hg.gain.exponentialRampToValueAtTime(0.05, 9.1); hg.gain.exponentialRampToValueAtTime(0.035, 9.45); hg.gain.exponentialRampToValueAtTime(1e-4, 9.8);
  noise(8.7, 1.1).connect(hang).connect(hg); send(hg, 0.4);

  // 9,80 s: la picada · 9,97 s: aterriza la tarjeta.
  whoosh({ peak: 9.8, dur: 0.62, f0: 3200, f1: 170, q: 0.9, gain: 0.55, room: 0.25, shape: 0.72 });
  hit(9.97);

  // 10,02 s: la etiqueta · 10,12 s en adelante: cada palabra del título.
  blip({ t: 10.03, f0: 880, f1: 1320, dur: 0.07, gain: 0.045 });
  words.line.forEach((x, i) => tick({ t: 10.17 + 0.06 * i, freq: 5200, gain: 0.016, pan: (x - 720) / 900 }));
  words.tail.forEach((x, i) => tick({ t: 10.41 + 0.05 * i, freq: 3300, gain: 0.014, pan: (x - 720) / 900 }));

  // Cola cálida bajo la tarjeta final, apenas audible.
  for (const [f, g] of [[55, 0.05], [110, 0.03], [164.8, 0.012]]) {
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.frequency.value = f; og.gain.setValueAtTime(1e-4, 9.97); og.gain.exponentialRampToValueAtTime(g, 10.6); og.gain.exponentialRampToValueAtTime(1e-4, duration);
    o.connect(og); send(og, 0.3); o.start(9.97); o.stop(duration);
  }

  const out = await ctx.startRendering();
  let peak = 0;                                      // normaliza a −1 dBFS
  for (let c = 0; c < 2; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  const k = peak > 0 ? 0.891 / peak : 1;
  for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return out;
}

// WAV de 16 bits para usar la pista por separado.
export function toWav(buffer) {
  const n = buffer.length, ch = buffer.numberOfChannels, view = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * ch * 2, true);
  const chans = [...Array(ch)].map((_, c) => buffer.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) view.setInt16(o, Math.max(-1, Math.min(1, chans[c][i])) * 32767, true);
  return view.buffer;
}
