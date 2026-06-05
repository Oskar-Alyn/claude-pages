// Capture Open Graph preview images for each sim by running it headless in your
// installed Chrome, hiding the on-screen controls, letting the simulation
// develop, then screenshotting the canvas at 1200x630 (the OG / Twitter
// "summary_large_image" size). The landing page gets a montage of them all.
//
// Usage:  node scripts/capture-og.mjs            (capture every sim + montage)
//         node scripts/capture-og.mjs flow-field  (just one, by file stem)
//         node scripts/capture-og.mjs montage      (rebuild only the index montage)
//
// Drives your system Chrome via playwright-core, so there is no large browser
// download — install with `npm install`.

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'og');

// OG / Twitter "summary_large_image" recommended size (1.91:1).
const WIDTH = 1200;
const HEIGHT = 630;

// Per-sim recipe:
//   dwell  — ms to let the sim run before each snapshot
//   mode   — 'plain': one shot
//            'best':  randomize N times, keep the liveliest frame (for sims
//                     whose look depends on a lucky random seed)
//   tries  — how many randomize attempts for 'best'
//   state  — a partial state object deep-merged via the sim's share-URL hash
//            (#base64-json) on load, to pick a more photogenic preset than the
//            code default. Excitable's default "Scatter" reads as flat noise at
//            thumbnail size; sparse "Grid" nuclei on a coarse field wind into
//            legible spiral waves instead.
//
// Order here is also the montage order.
const SIMS = {
  'boids':              { dwell: 5000,  mode: 'plain' },
  'flow-field':         { dwell: 4500,  mode: 'plain' },
  'particle-life':      { dwell: 9000,  mode: 'best', tries: 6 },
  'reaction-diffusion': { dwell: 8500,  mode: 'plain' },
  'slime-mold':         { dwell: 16000, mode: 'plain', // networks take a while
                          // Default "Disc" makes a small centered blob; Scatter
                          // across a full-frame region grows edge-to-edge veins.
                          state: { params: { count: 18000 },
                                   pattern: { name: 'Scatter', regionSize: 1 } } },
};

// Overlays to strip so the preview is pure simulation, not UI chrome.
const HIDE_CSS = `
  .fab-toolbar, .settings-menu, .rec-indicator, .hide-banner,
  .backdrop, .modal, .toast, .controls, .panel, .help, .hint
  { display: none !important; visibility: hidden !important; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// In-page UI toggles. We must show the UI to click the Randomize FAB, then hide
// it again before each screenshot — so hiding has to be reversible.
async function showUI(page) {
  await page.evaluate(() => {
    document.getElementById('og-hide')?.remove();
    document.body.classList.remove('ui-hidden');
  });
}
async function hideUI(page, css) {
  await page.evaluate((c) => {
    if (!document.getElementById('og-hide')) {
      const s = document.createElement('style');
      s.id = 'og-hide';
      s.textContent = c;
      document.head.appendChild(s);
    }
    document.body.classList.add('ui-hidden');
  }, css);
}

// Score how much of the frame the simulation actually fills: reward both the
// fraction of lit pixels and how widely they spread across the frame. A blob
// attractor or a near-empty particle field scores low; a full coral or galaxy
// scores high.
function liveliness() {
  const c = document.querySelector('#canvas');
  const tw = 240, th = Math.max(1, Math.round((tw * c.height) / c.width));
  const t = document.createElement('canvas');
  t.width = tw; t.height = th;
  const x = t.getContext('2d');
  x.drawImage(c, 0, 0, tw, th);
  const d = x.getImageData(0, 0, tw, th).data;
  let lit = 0, minx = tw, maxx = 0, miny = th, maxy = 0;
  for (let i = 0, p = 0; i < tw * th; i++, p += 4) {
    if (d[p] + d[p + 1] + d[p + 2] > 60) {
      lit++;
      const px = i % tw, py = (i / tw) | 0;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
    }
  }
  const frac = lit / (tw * th);
  const spread = maxx >= minx ? ((maxx - minx) * (maxy - miny)) / (tw * th) : 0;
  return Math.min(frac * 4, 1) * 0.4 + spread * 0.6;
}

async function captureSim(page, stem, recipe) {
  const { dwell, mode } = recipe;
  // A share-URL hash (#base64-json) lets us pick a more photogenic preset; the
  // sim deep-merges it into state on load. Encode it the same way the sims do.
  const hash = recipe.state
    ? '#' + Buffer.from(JSON.stringify(recipe.state)).toString('base64')
    : '';
  const url = pathToFileURL(join(ROOT, `${stem}.html`)).href + hash;
  await page.goto(url, { waitUntil: 'load' });
  const canvas = page.locator('#canvas');
  await canvas.waitFor({ state: 'visible', timeout: 10000 });

  if (mode === 'best') {
    const tries = recipe.tries ?? 4;
    let bestBuf = null, bestScore = -Infinity;
    for (let i = 0; i < tries; i++) {
      await showUI(page);
      await page.click('#fab-randomize');
      await sleep(dwell);
      await hideUI(page, HIDE_CSS);
      await sleep(150);
      const score = await page.evaluate(liveliness);
      const buf = await canvas.screenshot();
      process.stdout.write(`[${score.toFixed(2)}]`);
      if (score > bestScore) { bestScore = score; bestBuf = buf; }
    }
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(OUT, `${stem}.png`), bestBuf);
    return;
  }

  // plain
  await hideUI(page, HIDE_CSS);
  await sleep(dwell);
  await canvas.screenshot({ path: join(OUT, `${stem}.png`) });
}

async function buildMontage(page) {
  process.stdout.write('• index  (montage) … ');
  // Relative src + an HTML file written into og/ so the page shares the
  // thumbnails' file:// origin (setContent's opaque origin can't load them).
  const tiles = Object.keys(SIMS)
    .map((s) => `<div class="t"><img src="${s}.png"></div>`)
    .join('');
  const montage = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:#05070b;overflow:hidden}
    .g{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);
       gap:6px;width:100%;height:100%;box-sizing:border-box;padding:6px}
    .t{overflow:hidden;border-radius:10px;background:#141414}
    .t img{width:100%;height:100%;object-fit:cover;display:block}
  </style><div class="g">${tiles}</div>`;
  const { writeFile, rm } = await import('node:fs/promises');
  const tmp = join(OUT, '_montage.html');
  await writeFile(tmp, montage);
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  );
  await page.locator('.g').screenshot({ path: join(OUT, 'index.png') });
  await rm(tmp);
  console.log('→ og/index.png');
}

// ------------------------------------------------------------------ main
const arg = process.argv[2];
const montageOnly = arg === 'montage';
const stems = montageOnly ? [] : Object.keys(SIMS).filter((s) => !arg || s === arg);
if (!montageOnly && stems.length === 0) {
  console.error(`No sim named "${arg}". Known: ${Object.keys(SIMS).join(', ')}`);
  process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2, // crisp 2400x1260 source; platforms downscale cleanly
});

for (const stem of stems) {
  const recipe = SIMS[stem];
  process.stdout.write(`• ${stem}  (${recipe.mode}, dwell ${recipe.dwell}ms) … `);
  await captureSim(page, stem, recipe);
  console.log(`→ og/${stem}.png`);
}

// Rebuild the montage on a full run, single-sim updates, or when asked.
if (montageOnly || !arg || stems.length) await buildMontage(page);

await browser.close();
console.log(`\nDone — ${stems.length} sim image(s) in og/`);
