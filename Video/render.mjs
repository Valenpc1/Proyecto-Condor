// Abre film.html en Chrome con la GPU real.
//   node render.mjs stills [t ...]   stills de control
//   node render.mjs flow             flujo óptico sobre una vista previa a 30 fps
//   node render.mjs video            MP4 final (H.264, 60 fps) en out/flyover.mp4
//   node render.mjs verify           abre el MP4 y saca cuadros para revisarlo
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const DIR = import.meta.dirname;
const OUT = path.join(DIR, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4', '.wav': 'audio/wav' };
const [mode = 'stills', ...args] = process.argv.slice(2);

const server = http.createServer(async (req, res) => {
  const file = path.join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (req.method === 'POST') {                       // la película devuelve el MP4 por acá
    if (!file.startsWith(OUT + path.sep)) return res.writeHead(403).end();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.concat(chunks));
    return res.writeHead(200).end('ok');
  }
  if (!file.startsWith(DIR)) return res.writeHead(403).end();
  let body;
  try { body = await fs.readFile(file); } catch { return res.writeHead(404).end(); }
  const type = TYPES[path.extname(file)] || 'application/octet-stream', range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (range) {                                       // el reproductor de video pide el archivo por partes
    const start = +range[1], end = range[2] ? +range[2] : body.length - 1;
    return res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 })
      .end(body.subarray(start, end + 1));
  }
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length }).end(body);
}).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1152 }, deviceScaleFactor: 1 });
page.on('console', (m) => !/favicon|404/.test(m.text()) && console.log('[film]', m.text()));
page.on('pageerror', (e) => console.error('[film]', e.message));

if (mode === 'verify') {
  await fs.writeFile(path.join(OUT, 'verify.html'), '<!doctype html><video id="v" src="flyover.mp4" muted preload="auto"></video><canvas id="c" width="1440" height="1152"></canvas>');
  await page.goto(`${base}/out/verify.html`);
  const info = await page.evaluate(async () => {
    const v = document.getElementById('v');
    if (v.readyState < 1) await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error(v.error?.message || 'no se pudo abrir')); setTimeout(() => j(new Error('el MP4 no cargó')), 15000); });
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
  });
  console.log('MP4:', info);
  // Sincronía: dónde cae el golpe de la tarjeta (debería ser 9,97 s) en el WAV y en el audio del MP4.
  const onsets = await page.evaluate(async () => {
    const onset = async (url) => {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await res.arrayBuffer());
      const d = buf.getChannelData(0), a = Math.round(9.6 * buf.sampleRate), b = Math.round(10.4 * buf.sampleRate);
      let max = 0; for (let i = a; i < b; i++) max = Math.max(max, Math.abs(d[i]));
      for (let i = a; i < b; i++) if (Math.abs(d[i]) > 0.5 * max) return { t: i / buf.sampleRate, duration: buf.duration };
      return null;
    };
    return { wav: await onset('flyover_audio.wav'), mp4: await onset('flyover.mp4') };
  });
  console.log('Golpe en el WAV:', onsets.wav?.t.toFixed(4), 's · en el MP4:', onsets.mp4?.t.toFixed(4), 's · duración del audio del MP4:', onsets.mp4?.duration.toFixed(3), 's');
  await fs.mkdir(path.join(OUT, 'verify'), { recursive: true });
  for (const t of args.length ? args.map(Number) : [0.5, 2.5, 5.4, 8.0, 9.6, 12]) {
    const data = await page.evaluate(async (t) => {
      const v = document.getElementById('v'), c = document.getElementById('c');
      v.currentTime = t; await new Promise((r, j) => { v.onseeked = r; setTimeout(() => j(new Error(`no pudo ir a ${t} s`)), 15000); });
      c.getContext('2d').drawImage(v, 0, 0); return c.toDataURL('image/png');
    }, t);
    const file = path.join(OUT, 'verify', `mp4_${t.toFixed(2).replace('.', '_')}s.png`);
    await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`${t} s → ${path.relative(DIR, file)}`);
  }
} else {
  await page.goto(`${base}/film.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
  console.log('GPU:', await page.evaluate(() => window.gpu), '· crucero', await page.evaluate(() => Math.round(window.film.CRUISE)), 'px/s');
}

if (mode === 'stills') {
  const times = args.length ? args.map(Number) : [0, 1.6, 2.5, 5, 6.5, 9.3, 11];
  await fs.mkdir(path.join(OUT, 'stills'), { recursive: true });
  for (const t of times) {
    const t0 = Date.now();
    const data = await page.evaluate((t) => window.film.still(t), t);
    const file = path.join(OUT, 'stills', `still_${t.toFixed(2).replace('.', '_')}s.png`);
    await fs.writeFile(file, Buffer.from(data.split(',')[1], 'base64'));
    console.log(`${t.toFixed(2)} s → ${path.relative(DIR, file)} (${Date.now() - t0} ms)`);
  }
}

if (mode === 'flow') {
  const { cruise, rows } = await page.evaluate(() => window.film.flowCheck(30, 8.2), null, { timeout: 0 });
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'flow_check.csv'), 't,medido_px_s,esperado_px_s,expansion_por_cuadro,bloques\n'
    + rows.map((r) => [r.t.toFixed(3), r.measured.toFixed(1), r.expected.toFixed(1), r.expansion.toExponential(3), r.blocks].join(',')).join('\n'));
  const pick = (a, b) => rows.filter((r) => r.t > a && r.t <= b);
  const cruiseRows = pick(1.7, 7.3), ratios = cruiseRows.map((r) => r.measured / cruise).sort((a, b) => a - b);
  const pct = (p) => ratios[Math.floor(p * (ratios.length - 1))];
  // Una caída es una baja sostenida: el promedio de 5 cuadros por debajo del 85 % del crucero.
  const smooth = cruiseRows.map((_, i) => { const w = cruiseRows.slice(Math.max(0, i - 2), i + 3); return w.reduce((s, r) => s + r.measured, 0) / w.length; });
  const dips = smooth.filter((v) => v < 0.85 * cruise).length;
  let peak = 0, worstDrop = 0;
  for (const r of pick(0, 1.6)) { peak = Math.max(peak, r.measured); worstDrop = Math.max(worstDrop, peak - r.measured); }
  const zoomIn = rows.filter((r) => r.t <= 7.75 && r.expansion > 2e-3);
  console.log(`Flujo óptico: ${rows.length} pares de cuadros medidos (out/flow_check.csv)`);
  console.log(`  crucero 1,7–7,3 s: mediana ${(pct(0.5) * 100).toFixed(1)} %, p5 ${(pct(0.05) * 100).toFixed(1)} %, p95 ${(pct(0.95) * 100).toFixed(1)} % de ${Math.round(cruise)} px/s · caídas sostenidas: ${dips}`);
  console.log(`  arranque 0–1,6 s: mayor retroceso medido ${Math.round(worstDrop)} px/s`);
  console.log(`  zoom hacia adentro durante el vuelo: ${zoomIn.length ? zoomIn.map((r) => r.t.toFixed(2)).join(', ') : 'ninguno'}`);
}

if (mode === 'video') {
  const info = await page.evaluate(() => window.film.encodeVideo('out/flyover.mp4'), null, { timeout: 0 });
  console.log(`MP4 listo: out/flyover.mp4 · ${info.frames} cuadros · ${(info.bytes / 1e6).toFixed(1)} MB · ${info.codec} (${info.hardware}) + ${info.audio} · ${info.seconds.toFixed(0)} s`);
}

await browser.close();
server.close();
