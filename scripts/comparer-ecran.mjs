#!/usr/bin/env node
// Compare un écran de l'application avec sa capture de référence (maquette/captures).
// Usage : node scripts/comparer-ecran.mjs <Ecran> [--url <adresse complète>] [--largeurs 1440,1024,390] [--seuil 3]
// Sortie : .comparaisons/<Ecran>/<largeur>-{maquette,app,diff,cote-a-cote}.png + rapport.json
// Code de sortie 1 si un écart dépasse le seuil (en % de pixels différents).
// Dépendance : playwright (navigateur Chromium installé : `pnpm exec playwright install chromium`).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const ecran = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (!ecran) { console.error('Usage : node scripts/comparer-ecran.mjs <Ecran> [--url …] [--largeurs 1440,1024,390] [--seuil 3]'); process.exit(2); }

const conf = JSON.parse(readFileSync(join(root, 'scripts/ecrans.json'), 'utf8'));
const largeurs = opt('largeurs', '1440,1024,390').split(',').map(Number);
const seuil = Number(opt('seuil', '3'));
let url = opt('url', null);
if (!url) {
  const e = conf[ecran];
  if (!e) { console.error(`Écran inconnu dans scripts/ecrans.json : ${ecran}`); process.exit(2); }
  url = conf._bases[e.app] + e.route;
}

// Retrouve la capture de référence, quelle que soit la section.
const capDir = join(root, 'maquette/captures');
const sections = readdirSync(capDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const refPath = (w) => sections.map((s) => join(capDir, s, `${ecran}-${w}.png`)).find(existsSync);

const outDir = join(root, '.comparaisons', ecran);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--font-render-hinting=none'] });
const rapport = { ecran, url, seuil, date: new Date().toISOString(), largeurs: [] };
let echec = false;
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const cmp = await ctx.newPage();
  for (const w of largeurs) {
    const ref = refPath(w);
    if (!ref) { console.warn(`  ${w}px : pas de capture de référence, ignoré`); continue; }
    const page = await ctx.newPage();
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(800); // laisse finir les états de chargement simulés
    const appBuf = await page.screenshot({ fullPage: true });
    await page.close();
    const refBuf = readFileSync(ref);
    const res = await cmp.evaluate(async ({ a, b }) => {
      const load = (src) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
      const [ma, ap] = await Promise.all([load(a), load(b)]);
      const W = Math.max(ma.width, ap.width), H = Math.max(ma.height, ap.height);
      const draw = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H); };
      const A = draw(ma), B = draw(ap);
      const dc = document.createElement('canvas'); dc.width = W; dc.height = H; const dx = dc.getContext('2d'); const D = dx.createImageData(W, H);
      let diff = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
        if (d > 48) { diff++; D.data[i] = 230; D.data[i + 1] = 30; D.data[i + 2] = 60; D.data[i + 3] = 255; }
        else { const g = 255 - (255 - (A.data[i] + A.data[i + 1] + A.data[i + 2]) / 3) * 0.25; D.data[i] = D.data[i + 1] = D.data[i + 2] = g; D.data[i + 3] = 255; }
      }
      dx.putImageData(D, 0, 0);
      // Côte à côte : maquette | application | différences, avec un titre.
      const gap = 16, head = 28, sc = document.createElement('canvas'); sc.width = W * 3 + gap * 2; sc.height = H + head;
      const sx = sc.getContext('2d'); sx.fillStyle = '#eef1f5'; sx.fillRect(0, 0, sc.width, sc.height);
      sx.fillStyle = '#002B74'; sx.font = '600 16px sans-serif';
      ['Maquette', 'Application', 'Différences'].forEach((t, k) => sx.fillText(t, k * (W + gap) + 4, 19));
      sx.drawImage(ma, 0, head); sx.drawImage(ap, W + gap, head); sx.drawImage(dc, (W + gap) * 2, head);
      return { pct: (diff / (W * H)) * 100, W, H, hRef: ma.height, hApp: ap.height, diffUrl: dc.toDataURL('image/png'), sideUrl: sc.toDataURL('image/png') };
    }, { a: 'data:image/png;base64,' + refBuf.toString('base64'), b: 'data:image/png;base64,' + appBuf.toString('base64') });
    const save = (name, dataUrl) => writeFileSync(join(outDir, `${w}-${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    writeFileSync(join(outDir, `${w}-maquette.png`), refBuf);
    writeFileSync(join(outDir, `${w}-app.png`), appBuf);
    save('diff', res.diffUrl); save('cote-a-cote', res.sideUrl);
    const ok = res.pct <= seuil;
    if (!ok) echec = true;
    rapport.largeurs.push({ largeur: w, ecart_pct: Number(res.pct.toFixed(2)), hauteur_maquette: res.hRef, hauteur_app: res.hApp, ok });
    console.log(`  ${String(w).padStart(4)} px : ${res.pct.toFixed(2)} % de pixels différents · hauteur ${res.hApp}px (maquette ${res.hRef}px) ${ok ? '✓' : '✗'}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(outDir, 'rapport.json'), JSON.stringify(rapport, null, 2));
console.log(`Résultats : .comparaisons/${ecran}/ (ouvrir les fichiers *-cote-a-cote.png)`);
process.exit(echec ? 1 : 0);
