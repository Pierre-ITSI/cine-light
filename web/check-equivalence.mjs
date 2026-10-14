#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preuve d'équivalence : index.html monolithique d'origine ↔ index.html généré.
//
//   node web/check-equivalence.mjs --ref <commit>      (origine lue via git)
//   node web/check-equivalence.mjs <original.html> [<generated.html>]
//   … --only style,markup     ne compare que certaines parties
//
// Compare séparément :
//   • le contenu du <style> inline
//   • le contenu du <script> inline
//   • le balisage (tout le reste), en-tête « GÉNÉRÉ » retiré
// Les blocs <style>/<script> doivent être identiques à l'octet près, ou au
// moins après normalisation des blancs aux coutures entre fragments (espaces
// de fin de ligne et lignes vides). Le balisage doit être strictement égal.
// Code de sortie 0 = équivalent, 1 = différence.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { OUTPUT, ROOT_DIR, HEADER, build } from './build.mjs';

function parts(html) {
  const sOpen = html.indexOf('<style>'), sClose = html.indexOf('</style>', sOpen);
  const jOpen = html.indexOf('<script>'), jClose = html.indexOf('</script>', jOpen);
  if (sOpen < 0 || sClose < 0 || jOpen < 0 || jClose < 0) throw new Error('blocs <style>/<script> introuvables');
  if (html.indexOf('<style>', sOpen + 1) >= 0 || html.indexOf('<script>', jOpen + 1) >= 0) {
    throw new Error('plusieurs blocs <style> ou <script> inline');
  }
  const style = html.slice(sOpen + 7, sClose);
  const script = html.slice(jOpen + 8, jClose);
  const markup = (html.slice(0, sOpen + 7) + '@@STYLE@@' + html.slice(sClose, jOpen + 8) + '@@SCRIPT@@' + html.slice(jClose))
    .split('\n').filter((l) => l !== HEADER).join('\n');
  return { style, script, markup };
}

const normalize = (s) => s.split('\n').map((l) => l.replace(/[ \t]+$/, '')).filter((l) => l !== '').join('\n');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0; while (i < n && a[i] === b[i]) i++;
  const line = a.slice(0, i).split('\n').length;
  return `1re différence ligne ${line} : « ${a.slice(i, i + 60)} » ≠ « ${b.slice(i, i + 60)} »`;
}

function main(argv) {
  let original, generated, origLabel;
  let only = ['style', 'script', 'markup'];
  const onlyIdx = argv.indexOf('--only');
  if (onlyIdx >= 0) {
    only = String(argv[onlyIdx + 1] || '').split(',').filter(Boolean);
    argv = argv.filter((_, i) => i !== onlyIdx && i !== onlyIdx + 1);
  }
  const refIdx = argv.indexOf('--ref');
  if (refIdx >= 0) {
    const ref = argv[refIdx + 1];
    original = execFileSync('git', ['show', ref + ':index.html'], { cwd: ROOT_DIR, encoding: 'utf8', maxBuffer: 64 << 20 });
    origLabel = 'git ' + ref + ':index.html';
    argv = argv.filter((_, i) => i !== refIdx && i !== refIdx + 1);
  } else if (argv[0]) {
    original = readFileSync(resolve(argv[0]), 'utf8');
    origLabel = argv[0];
    argv = argv.slice(1);
  } else {
    console.error('usage : check-equivalence.mjs --ref <commit> | <original.html> [<generated.html>]');
    process.exit(2);
  }
  if (argv[0]) generated = readFileSync(resolve(argv[0]), 'utf8');
  else {
    generated = readFileSync(OUTPUT, 'utf8');
    if (generated !== build().html) {
      console.error('✗ index.html ne correspond pas à web/ (relancez npm run build)');
      process.exit(1);
    }
  }
  const o = parts(original), g = parts(generated);
  let ok = true;
  console.log('Origine : ' + origLabel);
  for (const key of ['style', 'script']) {
    if (!only.includes(key)) { console.log(`  <${key}>  (non comparé)`); continue; }
    const exact = o[key] === g[key];
    const norm = exact || normalize(o[key]) === normalize(g[key]);
    ok = ok && norm;
    console.log(`  <${key}>  ${exact ? 'identique à l\'octet' : norm ? 'identique (blancs de couture normalisés)' : 'DIFFÉRENT'}`
      + `  sha256 ${sha(o[key])} → ${sha(g[key])}  (${o[key].length} → ${g[key].length} car.)`);
    if (!norm) console.log('    ' + firstDiff(normalize(o[key]), normalize(g[key])));
  }
  if (only.includes('markup')) {
    const mk = o.markup === g.markup;
    ok = ok && mk;
    console.log(`  balisage  ${mk ? 'identique' : 'DIFFÉRENT'}  sha256 ${sha(o.markup)} → ${sha(g.markup)}`);
    if (!mk) console.log('    ' + firstDiff(o.markup, g.markup));
  } else console.log('  balisage  (non comparé)');
  console.log(ok ? '✓ ÉQUIVALENT' : '✗ NON ÉQUIVALENT');
  process.exit(ok ? 0 : 1);
}

main(process.argv.slice(2));
