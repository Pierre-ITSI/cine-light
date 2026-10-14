// Build web/ → index.html : à jour, déterministe, et interface (CSS + balisage)
// identique au commit de référence visuelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { build, listFragments, OUTPUT, ROOT_DIR, HEADER } from '../web/build.mjs';

test('index.html correspond exactement à web/ (npm run build)', () => {
  const { html, cssFrags, jsFrags } = build();
  assert.equal(readFileSync(OUTPUT, 'utf8'), html);
  assert.equal(html.split('\n')[1], HEADER);
  assert.ok(cssFrags.length >= 10 && jsFrags.length >= 20);
  assert.equal(build().html, html, 'build déterministe');
});

test('fragments : préfixes NN- uniques, script classique (pas de module ES)', () => {
  for (const [sub, ext] of [['styles', '.css'], ['js', '.js']]) {
    const frags = listFragments(sub, ext);
    const prefixes = frags.map((f) => f.name.split('/')[1].slice(0, 2));
    assert.equal(new Set(prefixes).size, prefixes.length, 'préfixes uniques dans ' + sub);
    for (const f of frags) assert.ok(f.text.endsWith('\n'), f.name + ' se termine par un saut de ligne');
  }
  const html = readFileSync(OUTPUT, 'utf8');
  assert.equal((html.match(/<script>/g) || []).length, 1, 'un seul <script> inline');
  assert.doesNotMatch(html, /<script[^>]*type=["']module/);
  for (const f of listFragments('js', '.js')) {
    assert.doesNotMatch(f.text, /^\s*(import|export)\s[^(]/m, f.name + ' : pas d\'import/export');
  }
});

test('interface inchangée : <style> et balisage identiques à la référence visuelle', (t) => {
  const meta = JSON.parse(readFileSync(path.join(ROOT_DIR, 'tests', 'screenshots', 'baseline.json'), 'utf8'));
  try {
    execFileSync('git', ['cat-file', '-e', meta.ref + ':index.html'], { cwd: ROOT_DIR, stdio: 'ignore' });
  } catch (_) {
    t.skip('commit de référence ' + meta.ref.slice(0, 7) + ' absent (clone superficiel)');
    return;
  }
  const r = spawnSync(process.execPath, [path.join(ROOT_DIR, 'web', 'check-equivalence.mjs'), '--ref', meta.ref, '--only', 'style,markup'],
    { cwd: ROOT_DIR, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
