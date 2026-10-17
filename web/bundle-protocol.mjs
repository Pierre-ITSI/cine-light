// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Assemble un paquet de packages/ (modules ES) en UN script classique pour la
// PWA : packages/protocol → globale SRP, packages/dmx → globale SRDMX.
//
// Les scripts de web/js sont classiques (globales, onclick= inline) : ils ne
// peuvent pas faire « import ». Ce petit assembleur, sans dépendance, produit
// une IIFE qui expose l'API publique du paquet dans une globale :
//
//   var SRP = (function () { 'use strict'; … return Object.freeze({ … }); })();
//
// Chaque module garde sa propre portée (fonction) ; ses « import » deviennent
// des lectures des modules déjà évalués (ordre topologique, déterministe).
// Seules les formes utilisées par le paquet sont acceptées ; toute autre
// syntaxe import/export fait échouer le build (pas de résultat approximatif).
// Les lignes de commentaire seules sont retirées (taille ÷ 2), le code est
// conservé tel quel.
// ════════════════════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_DIR = dirname(fileURLToPath(import.meta.url));
export const PROTOCOL_DIR = resolve(WEB_DIR, '..', 'packages', 'protocol');
export const PROTOCOL_GLOBAL = 'SRP';
// Passerelle DMX (sACN / Art-Net) : moteur sans dépendance, même assemblage
export const DMX_DIR = resolve(WEB_DIR, '..', 'packages', 'dmx');
export const DMX_GLOBAL = 'SRDMX';

const ID = '[A-Za-z_$][\\w$]*';
const SPEC = `'(\\.{1,2}/[^']+\\.js)'`;
const RE = {
  importNamed: new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*${SPEC};?[ \\t]*$`, 'gm'),
  exportStar: new RegExp(`^export\\s*\\*\\s*from\\s*${SPEC};?[ \\t]*$`, 'gm'),
  exportFrom: new RegExp(`^export\\s*\\{([^}]*)\\}\\s*from\\s*${SPEC};?[ \\t]*$`, 'gm'),
  exportList: /^export\s*\{([^}]*)\};?[ \t]*$/gm,
  exportDecl: new RegExp(`^export\\s+((?:async\\s+)?function\\*?|const|let|var|class)\\s+(${ID})`, 'gm'),
};

// « a, b as c » → [{ from: 'a', to: 'a' }, { from: 'b', to: 'c' }]
function parseList(src, file) {
  return src.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = new RegExp(`^(${ID})(?:\\s+as\\s+(${ID}))?$`).exec(s);
    if (!m) throw new Error(`bundle-protocol: liste d'import/export illisible dans ${file} : « ${s} »`);
    return { from: m[1], to: m[2] || m[1] };
  });
}

// Retire les lignes qui ne sont QUE des commentaires (// … ou blocs /* … */
// commençant en début de ligne). Le reste du code n'est pas touché.
function stripCommentLines(src) {
  const out = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; continue; }
    if (t.startsWith('/*')) {
      const end = t.indexOf('*/', 2);
      if (end < 0) { inBlock = true; continue; }
      if (end === t.length - 2) continue; // bloc d'une ligne seul sur la ligne
    }
    if (t.startsWith('//')) continue;
    if (t === '' && out.length && out[out.length - 1].trim() === '') continue; // une seule ligne vide
    out.push(line);
  }
  return out.join('\n');
}

function parseModule(abs, pkgDir) {
  const file = relative(pkgDir, abs).split(sep).join('/');
  let src = readFileSync(abs, 'utf8');
  const deps = [];
  const imports = [];
  const exportsLocal = [];
  const reexports = [];
  const stars = [];
  const dep = (spec) => {
    const p = resolve(dirname(abs), spec);
    if (!p.startsWith(pkgDir + sep)) throw new Error(`bundle-protocol: import hors du paquet dans ${file}`);
    if (!deps.includes(p)) deps.push(p);
    return p;
  };
  src = src.replace(RE.importNamed, (_, list, spec) => { imports.push({ names: parseList(list, file), dep: dep(spec) }); return ''; });
  src = src.replace(RE.exportStar, (_, spec) => { stars.push(dep(spec)); return ''; });
  src = src.replace(RE.exportFrom, (_, list, spec) => { reexports.push({ names: parseList(list, file), dep: dep(spec) }); return ''; });
  src = src.replace(RE.exportList, (_, list) => { exportsLocal.push(...parseList(list, file)); return ''; });
  src = src.replace(RE.exportDecl, (_, kind, name) => { exportsLocal.push({ from: name, to: name }); return kind + ' ' + name; });
  // Tout reste d'import/export (hors commentaires JSDoc « import('…') ») =
  // syntaxe non gérée : on refuse plutôt que deviner
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const left = /^\s*(import|export)\b|\bimport\s*\(|\bimport\.meta\b/m.exec(code);
  if (left) throw new Error(`bundle-protocol: syntaxe non prise en charge dans ${file} : « ${code.slice(left.index, left.index + 60).trim()} »`);
  return { abs, file, src: stripCommentLines(src).trim(), deps, imports, exportsLocal, reexports, stars };
}

/**
 * @param {{ entry?: string, globalName?: string }} [opts]
 * @returns {{ code: string, modules: string[], exports: string[] }}
 */
export function bundleProtocol(opts = {}) {
  return bundlePackage({ dir: PROTOCOL_DIR, globalName: PROTOCOL_GLOBAL, label: '@setremote/protocol', ...opts });
}

/**
 * Moteur de la passerelle DMX (packages/dmx) → globale SRDMX.
 * @param {{ entry?: string, globalName?: string }} [opts]
 * @returns {{ code: string, modules: string[], exports: string[] }}
 */
export function bundleDmx(opts = {}) {
  return bundlePackage({ dir: DMX_DIR, globalName: DMX_GLOBAL, label: '@setremote/dmx', ...opts });
}

/**
 * @param {{ dir: string, globalName: string, label: string, entry?: string }} opts
 * @returns {{ code: string, modules: string[], exports: string[] }}
 */
export function bundlePackage(opts) {
  const pkgDir = opts.dir;
  const entry = resolve(pkgDir, opts.entry || 'index.js');
  const globalName = opts.globalName;
  const mods = new Map();
  const order = [];
  const visiting = new Set();
  const visit = (abs) => {
    if (mods.has(abs) && !visiting.has(abs)) return;
    if (visiting.has(abs)) throw new Error('bundle-protocol: import circulaire via ' + relative(pkgDir, abs));
    visiting.add(abs);
    const m = parseModule(abs, pkgDir);
    mods.set(abs, m);
    for (const d of m.deps) visit(d);
    visiting.delete(abs);
    order.push(m);
  };
  visit(entry);

  // Noms exportés par module (étoiles résolues), pour vérifier chaque import
  const exported = new Map();
  for (const m of order) {
    const names = new Set();
    const add = (n) => {
      if (names.has(n)) throw new Error(`bundle-protocol: export « ${n} » en double dans ${m.file}`);
      names.add(n);
    };
    for (const e of m.exportsLocal) add(e.to);
    for (const r of m.reexports) for (const n of r.names) add(n.to);
    for (const s of m.stars) for (const n of exported.get(s)) if (n !== 'default') add(n);
    exported.set(m.abs, names);
  }
  const key = (abs) => JSON.stringify(mods.get(abs).file);
  const parts = [];
  for (const m of order) {
    for (const imp of m.imports) {
      for (const n of imp.names) {
        if (!exported.get(imp.dep).has(n.from)) throw new Error(`bundle-protocol: ${m.file} importe « ${n.from} » absent de ${mods.get(imp.dep).file}`);
      }
    }
    const head = m.imports.map((imp) => `  const { ${imp.names.map((n) => (n.from === n.to ? n.from : `${n.from}: ${n.to}`)).join(', ')} } = __m[${key(imp.dep)}];`);
    const ret = [];
    for (const s of m.stars) ret.push(`...__star(__m[${key(s)}])`);
    for (const r of m.reexports) for (const n of r.names) ret.push(`${n.to}: __m[${key(r.dep)}].${n.from}`);
    for (const e of m.exportsLocal) ret.push(e.from === e.to ? e.to : `${e.to}: ${e.from}`);
    parts.push(
      `// ── ${m.file} ──\n__m[${key(m.abs)}] = (function () {\n${head.length ? head.join('\n') + '\n' : ''}${m.src}\n  return { ${ret.join(', ')} };\n})();`,
    );
  }
  const exportsList = [...exported.get(entry)].sort();
  const code = `// ══════ ${opts.label} — assemblé par web/bundle-protocol.mjs depuis ${relative(resolve(WEB_DIR, '..'), pkgDir).split(sep).join('/')} (ne pas éditer) ══════
var ${globalName} = (function () {
'use strict';
const __m = Object.create(null);
const __star = (o) => { const r = {}; for (const k of Object.keys(o)) if (k !== 'default') r[k] = o[k]; return r; };
${parts.join('\n')}
return Object.freeze(__m[${key(entry)}]);
})();
`;
  if (/<\/script/i.test(code)) throw new Error('bundle-protocol: « </script » interdit dans le paquet ' + opts.label);
  return { code, modules: order.map((m) => m.file), exports: exportsList };
}
