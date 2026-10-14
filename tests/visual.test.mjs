// Non-régression visuelle : chaque écran clé de index.html doit être identique
// au pixel près à sa capture de référence (tests/screenshots/*.png), rendue à
// partir du commit de référence noté dans tests/screenshots/baseline.json
// (dernier état validé de l'interface).
//
// Les polices système diffèrent d'une machine à l'autre : si une référence
// stockée ne correspond pas, le test rend AUSSI le HTML du commit de référence
// (git show) dans le même environnement et compare les deux rendus. Il n'échoue
// que si l'interface actuelle diffère de la référence rendue au même endroit.
//
// Mise à jour (après une maquette validée, changement committé) :
//   VISUAL_BASELINE_REF=HEAD npm run test:update-snapshots
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { launchBrowser, ROOT, INDEX_PATH } from './helpers/harness.mjs';
import { SCENES, captureScene } from './helpers/scenes.mjs';
import { diffPng } from './helpers/png.mjs';

const SNAP_DIR = path.join(ROOT, 'tests', 'screenshots');
const ART_DIR = path.join(ROOT, 'tests', '.artifacts');
const META_PATH = path.join(SNAP_DIR, 'baseline.json');
const BASELINE_HTML = path.join(ROOT, '.visual-baseline.html'); // à la racine : chemins relatifs valides
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

let browser, meta, baselineReady = null;
before(async () => {
  browser = await launchBrowser();
  meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : {};
  if (UPDATE) {
    const ref = process.env.VISUAL_BASELINE_REF || meta.ref;
    assert.ok(ref, 'VISUAL_BASELINE_REF requis pour la première génération');
    const sha = execFileSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' }).trim();
    meta = { ref: sha, viewport: '390x844@1x', note: 'Captures rendues depuis index.html de ce commit (interface validée).' };
    mkdirSync(SNAP_DIR, { recursive: true });
    writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n');
  }
});
after(async () => {
  await browser?.close();
  if (existsSync(BASELINE_HTML)) rmSync(BASELINE_HTML);
});

// HTML du commit de référence, extrait une fois (null si git/ref indisponible)
function baselineFile() {
  if (baselineReady !== null) return baselineReady;
  try {
    const html = execFileSync('git', ['show', meta.ref + ':index.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    writeFileSync(BASELINE_HTML, html);
    baselineReady = BASELINE_HTML;
  } catch (_) { baselineReady = false; }
  return baselineReady;
}

for (const name of Object.keys(SCENES)) {
  test('visuel · ' + name, async (t) => {
    const snap = path.join(SNAP_DIR, name + '.png');
    if (UPDATE) {
      const src = baselineFile();
      assert.ok(src, 'commit de référence illisible : ' + meta.ref);
      const b = await captureScene(browser, src, name);
      writeFileSync(snap, b.png);
      t.diagnostic('capture écrite : ' + path.relative(ROOT, snap));
      return;
    }
    const cur = await captureScene(browser, INDEX_PATH, name);
    assert.deepEqual(cur.errors, [], 'erreurs de page pendant la scène');
    assert.ok(existsSync(snap), 'capture de référence manquante : ' + path.relative(ROOT, snap));
    const d = diffPng(cur.png, readFileSync(snap));
    if (d.identical) return;
    // Environnement différent (polices…) ? Rendre la référence ici même.
    const src = baselineFile();
    let detail = `${d.diffPixels} pixels différents de la capture stockée${d.sizes ? ' (' + d.sizes + ')' : ''}`;
    if (src) {
      const b = await captureScene(browser, src, name);
      const d2 = diffPng(cur.png, b.png);
      if (d2.identical) {
        t.diagnostic(`${detail} — environnement différent ; rendu identique à la référence ${meta.ref.slice(0, 7)} rendue ici`);
        return;
      }
      detail += ` ; ${d2.diffPixels} pixels différents de la référence ${meta.ref.slice(0, 7)} rendue ici`;
      mkdirSync(ART_DIR, { recursive: true });
      writeFileSync(path.join(ART_DIR, name + '.expected.png'), b.png);
    }
    mkdirSync(ART_DIR, { recursive: true });
    writeFileSync(path.join(ART_DIR, name + '.actual.png'), cur.png);
    assert.fail(`${name} : changement visuel — ${detail} (voir tests/.artifacts/)`);
  });
}
