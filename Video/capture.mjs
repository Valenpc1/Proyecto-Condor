// Captura el portal a 1440px (escala 2): la página sin las piezas que se levantan, cada pieza sola
// sobre transparente con 28px de margen, y un layout.json con todas las posiciones.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = import.meta.dirname;
const OUT = path.join(DIR, 'capture');
const PAGE = pathToFileURL(path.join(DIR, '..', 'Framework', 'portal_el_condor.html')).href;
const PAD = 28;
const TILE = 2048;   // la página se guarda en franjas para no pasar el tamaño máximo de textura
// Las piezas de vidrio no tienen nada detrás al aislarlas: se les da un fondo parecido a lo que dejaban ver.
const BACKING = { clima: 'rgb(44 48 82 / .96)', horas: 'rgb(74 64 70 / .95)' };

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// El clima en vivo se pide con permiso: se concede antes de cargar para capturar la página con sus datos reales.
await page.addInitScript(() => localStorage.setItem('condor-consent', JSON.stringify({ weather: true, at: Date.now() })));
await page.goto(PAGE, { waitUntil: 'networkidle' });
await page.waitForSelector('#contacto');
await page.evaluate(() => document.fonts.ready);

// Un recorrido hasta abajo para que terminen las entradas con scroll.
await page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto';
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { scrollTo(0, y); await wait(90); }
  scrollTo(0, document.documentElement.scrollHeight); await wait(900);
  scrollTo(0, 0);
});
await page.waitForFunction(() => /vivo/.test(document.querySelector('[aria-label="Clima y mareas ahora"]')?.textContent || ''), null, { timeout: 8000 })
  .catch(() => console.warn('El clima no respondió: se captura con datos de ejemplo.'));
await page.waitForTimeout(1500);

const marked = await page.evaluate(() => {
  const q = (s) => [...document.querySelectorAll(s)];
  const list = [];
  const add = (el, kind, name) => { if (el) { el.setAttribute('data-layer', list.length); list.push({ kind, name }); } };
  add(document.querySelector('#inicio section[aria-label="Clima y mareas ahora"]'), 'heroChip', 'clima');
  add(document.querySelector('#inicio [aria-label="Momento del día"]'), 'heroChip', 'horas');
  add(document.querySelector('#inicio a[href="#directorio"]'), 'heroButton', 'cta');
  q('#villa li').forEach((el, i) => add(el, 'chip', `dato${i}`));
  q('#directorio article.cat').forEach((el, i) => add(el, i === 1 ? 'photo' : 'flyer', `cat${i}`));
  q('#galeria button[aria-label^="Ver foto"]').forEach((el, i) => add(el, 'photo', `gal${i}`));
  q('#novedades article').forEach((el, i) => add(el, el.classList.contains('bg-deep') ? 'testimonial' : 'card', `news${i}`));
  q('#instagram a[aria-label^="Ver en Instagram"]').forEach((el, i) => add(el, 'photo', `ig${i}`));
  add(document.querySelector('#contacto a[href*="wa.me"]'), 'button', 'whatsapp');
  return list;
});

// La página entera en un solo viewport: sin scroll, el encabezado queda transparente sobre el hero.
const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
await page.setViewportSize({ width: 1440, height: fullH });
await page.waitForTimeout(1500);

const layout = await page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
  const sel = (s) => box(document.querySelector(s));
  return {
    page: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    hero: sel('#inicio'),
    cta: sel('#inicio a[href="#directorio"]'),
    ctaLink: sel('#inicio a[href="#novedades"]'),
    introText: sel('#villa p'),
    footerTitle: sel('#contacto h2'),
    sections: Object.fromEntries(['villa', 'directorio', 'galeria', 'novedades', 'instagram', 'contacto'].map(id => [id, sel(`#${id}`)])),
    pieces: [...document.querySelectorAll('[data-layer]')].map(el => ({ i: +el.dataset.layer, ...box(el) })),
  };
});
layout.pieces = layout.pieces.sort((a, b) => a.i - b.i).map((p) => ({ ...p, ...marked[p.i], file: `piece_${p.i}.png`, pad: PAD }));

// 1) La página sin las piezas.
await page.addStyleTag({ content: '[data-layer]{visibility:hidden!important}' });
await page.waitForTimeout(300);
layout.tiles = [];
for (let y = 0; y < layout.page.h; y += TILE) {
  const h = Math.min(TILE, layout.page.h - y), file = `page_${layout.tiles.length}.png`;
  await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y, width: 1440, height: h } });
  layout.tiles.push({ y, h, file });
}

// 2) Cada pieza sola sobre transparente.
await page.addStyleTag({ content: `
  *{visibility:hidden!important} html,body{background:transparent!important}
  [data-layer-on],[data-layer-on] *{visibility:visible!important}` });
for (const p of layout.pieces) {
  await page.evaluate(({ i, bg }) => {
    const el = document.querySelector(`[data-layer="${i}"]`);
    el.setAttribute('data-layer-on', '');
    if (bg) Object.assign(el.style, { background: bg, backdropFilter: 'none', webkitBackdropFilter: 'none' });
  }, { i: p.i, bg: BACKING[p.name] });
  await page.screenshot({ path: path.join(OUT, p.file), omitBackground: true, clip: { x: p.x - PAD, y: p.y - PAD, width: p.w + PAD * 2, height: p.h + PAD * 2 } });
  await page.evaluate((i) => document.querySelector(`[data-layer="${i}"]`).removeAttribute('data-layer-on'), p.i);
}

await fs.writeFile(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 2));
await browser.close();
console.log(`Página ${layout.page.w}x${layout.page.h}, ${layout.tiles.length} franjas, ${layout.pieces.length} piezas.`);
