#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Sprite d'icônes : vendor/icons/lucide-sprite.svg
//
// Assemble en un seul <svg> de <symbol id="i-NOM"> les icônes Lucide (ISC)
// réellement utilisées par l'interface : les tracés sont recopiés tels quels
// depuis lucide-static, aucun dessin à la main.
//
//   npm pack lucide-static@1.50.0 && tar xzf lucide-static-1.50.0.tgz
//   node scripts/build-icons.mjs package/icons          (réécrit le sprite)
//   node scripts/build-icons.mjs --list                 (noms utilisés)
//
// Références repérées dans web/index.template.html et web/js/*.js :
//   href="#i-NOM" · icon('NOM'…) (y compris les deux branches d'un ternaire) ·
//   valeurs de SEQ_ICONS, de _ICON_LEAD et de _ICON_MORE (icônes nommées par paramètre). Le build (web/build.mjs) insère le
//   sprite en ligne dans index.html ; tests/icons.test.mjs vérifie qu'aucune
//   référence n'est orpheline et qu'aucune icône du sprite n'est inutilisée.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SPRITE = join(ROOT, 'vendor', 'icons', 'lucide-sprite.svg');
export const LUCIDE_VERSION = '1.50.0';

// Noms d'icônes cités par le code source de l'interface
export function usedIcons() {
  const srcs = [readFileSync(join(ROOT, 'web', 'index.template.html'), 'utf8')];
  for (const f of readdirSync(join(ROOT, 'web', 'js')).sort()) srcs.push(readFileSync(join(ROOT, 'web', 'js', f), 'utf8'));
  const names = new Set();
  const lit = (s) => { for (const m of s.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/g)) names.add(m[1]); };
  for (const s of srcs) {
    for (const m of s.matchAll(/href="#i-([a-z0-9-]+)"/g)) names.add(m[1]);
    for (const m of s.matchAll(/\bicon\(([^()]*?)(?:,\s*'[^']*')?\)/g)) lit(m[1].includes('?') ? m[1].slice(m[1].indexOf('?')) : m[1]);
    for (const m of s.matchAll(/\b(?:iconLabel|setIconLabel)\([^,]*,\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
    for (const m of s.matchAll(/const (?:SEQ_ICONS|_ICON_LEAD|_ICON_MORE) = \{([\s\S]*?)\};/g)) {
      for (const p of m[1].matchAll(/:\s*'([a-z][a-z0-9-]*)'/g)) names.add(p[1]);
    }
  }
  return [...names].sort();
}

function symbol(dir, name) {
  const src = readFileSync(join(dir, name + '.svg'), 'utf8');
  const inner = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '');
  return `<symbol id="i-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>\n`;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const arg = process.argv[2];
  if (!arg || arg === '--list') {
    console.log(usedIcons().join('\n'));
  } else {
    const names = usedIcons();
    let out = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n'
      + `<!-- Lucide icons, lucide-static ${LUCIDE_VERSION} — ISC License, Copyright (c) Lucide Icons and Contributors. https://lucide.dev -->\n`;
    for (const n of names) out += symbol(resolve(arg), n);
    out += '</svg>\n';
    writeFileSync(SPRITE, out);
    console.log('✓ ' + names.length + ' icônes, ' + out.length + ' octets → vendor/icons/lucide-sprite.svg');
  }
}
