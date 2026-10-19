// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Auto-hébergement de la PWA (relay/deploy) : liste blanche et vérifications de
// verify-app.mjs sur le dépôt réel (tout fichier que l'app référence doit y
// figurer), refus des paquets incomplets, cohérence du Caddyfile (cache,
// en-têtes, aucun journal d'accès) et du docker-compose.
// L'essai complet (Docker, Caddy, navigateur) est décrit dans docs/HOSTING.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync, cpSync, statSync, unlinkSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './helpers/harness.mjs';
import { build } from '../web/build.mjs';
import { pageRefs } from '../expo-app/scripts/embed-web.mjs';
import { selectAppFiles, copyApp, checkApp, swShell, IMMUTABLE_RE, APP_FILES } from '../relay/deploy/verify-app.mjs';

const DEPLOY = path.join(ROOT, 'relay', 'deploy');
const read = (f) => readFileSync(path.join(DEPLOY, f), 'utf8');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'setremote-host-'));

function packaged(src = ROOT) {
  const out = tmp();
  const files = copyApp(src, out);
  return { out, files, check: (o = {}) => checkApp({ src, out, files, pageRefs, expectedHtml: build().html, ...o }) };
}

test('liste blanche : la PWA seule, complète, aucune référence manquante', () => {
  const { out, files, check } = packaged();
  try {
    assert.deepEqual(check(), []);
    for (const f of APP_FILES) assert.ok(files.includes(f), f);
    assert.ok(files.some((f) => /^splash-\d+x\d+\.png$/.test(f)), 'écrans de lancement iOS');
    assert.ok(files.includes('vendor/mqtt-5.16.1.min.js') && files.some((f) => f.endsWith('.woff2')));
    for (const f of files) {
      assert.doesNotMatch(f, /^(relay|tests|docs|expo-app|web|packages|brand|i18n|node_modules)\//, f);
      assert.doesNotMatch(f, /(^|\/)\.|\.(mjs|py|md5)$|^package/, f);
    }
    // Tout ce que sw.js précache est servi
    for (const u of swShell(readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))) assert.ok(files.includes(u.replace(/^\.\//, '') || 'index.html'), u);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('paquet refusé : index.html périmé, référence absente, fichier en trop, fichier versionné modifié', () => {
  const { out, check } = packaged();
  try {
    assert.match(check({ expectedHtml: 'autre' }).join('\n'), /index\.html n'est pas à jour/);
    unlinkSync(path.join(out, 'vendor', 'jsqr-1.4.0.js'));
    const missing = check().join('\n');
    assert.match(missing, /copie absente : vendor\/jsqr-1\.4\.0\.js/);
    assert.match(missing, /sw\.js : « \.\/vendor\/jsqr-1\.4\.0\.js » précaché mais absent/);
    cpSync(path.join(ROOT, 'vendor', 'jsqr-1.4.0.js'), path.join(out, 'vendor', 'jsqr-1.4.0.js'));
    writeFileSync(path.join(out, 'secret.txt'), 'x');
    assert.match(check().join('\n'), /hors liste blanche : secret\.txt/);
    unlinkSync(path.join(out, 'secret.txt'));
    assert.deepEqual(check(), []);
    // Version en service dont mqtt-5.16.1.min.js diffère : refus (cache d'un an)
    const cur = tmp();
    cpSync(out, cur, { recursive: true });
    writeFileSync(path.join(cur, 'vendor', 'mqtt-5.16.1.min.js'), '/* autre */');
    assert.match(check({ current: cur }).join('\n'), /mqtt-5\.16\.1\.min\.js : contenu modifié sous le même nom/);
    rmSync(cur, { recursive: true, force: true });
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('dépôt piégé : lien symbolique refusé, fichier obligatoire absent signalé', () => {
  const src = tmp();
  try {
    for (const f of ['index.html', 'sw.js', 'manifest.webmanifest', 'confidentialite.html', 'privacy.html', 'icon-192.png', 'icon-512.png']) cpSync(path.join(ROOT, f), path.join(src, f));
    assert.throws(() => selectAppFiles(src), /apple-touch-icon\.png/);
    symlinkSync('/etc/hostname', path.join(src, 'apple-touch-icon.png'));
    assert.throws(() => copyApp(src, tmp()), /pas un fichier ordinaire/);
  } finally { rmSync(src, { recursive: true, force: true }); }
});

test('Caddyfile : en-têtes, cache cohérent avec verify-app.mjs, aucun journal d\'accès ni liste de dossier', () => {
  const caddy = read('Caddyfile');
  const app = caddy.slice(caddy.indexOf('{$APP_DOMAIN} {'));
  assert.ok(app.length > 100, 'site APP_DOMAIN présent');
  const re = /@immutable path_regexp (\S+)/.exec(app)[1];
  assert.equal(re, IMMUTABLE_RE.source.replaceAll('\\/', '/').replace('^vendor', '^/vendor'), 'même motif « versionné » que verify-app.mjs');
  for (const f of ['vendor/mqtt-5.16.1.min.js', 'vendor/jsqr-1.4.0.js', 'vendor/qrcode-generator-2.0.4.js']) assert.match('/' + f, new RegExp(re));
  for (const f of ['vendor/fonts/lato-latin-400-normal.woff2', 'index.html', 'sw.js']) assert.doesNotMatch('/' + f, new RegExp(re));
  const nocache = /@nocache path (.+)/.exec(app)[1].split(/\s+/);
  for (const p of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/confidentialite.html', '/privacy.html']) assert.ok(nocache.includes(p), p);
  const csp = /Content-Security-Policy "([^"]+)"/.exec(caddy)[1];
  assert.doesNotMatch(csp, /unsafe-eval|\*/);
  assert.match(csp, /connect-src 'self' wss:\/\/\{\$RELAY_DOMAIN\} https:\/\/\{\$RELAY_DOMAIN\} \{\$APP_CONNECT_EXTRA\};/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", 'img-src \'self\' data: blob:', 'media-src \'self\' data: blob:']) assert.ok(csp.includes(d), d);
  assert.match(caddy, /Referrer-Policy "no-referrer"/);
  assert.match(caddy, /Permissions-Policy "camera=\(self\)/);
  assert.match(caddy, /Strict-Transport-Security "max-age=31536000"/);
  assert.match(app, /Content-Type "application\/manifest\+json"/);
  assert.match(app, /Content-Type "font\/woff2"/);
  assert.doesNotMatch(caddy, /^\s*(file_server\s+)?browse\b/m);
  assert.doesNotMatch(caddy, /local_certs|acme_ca|internal/, 'ACME réel (Let\'s Encrypt) dans le kit');
  // Seul le bloc global déclare des journaux (WARN, sans erreurs de requêtes)
  const logs = caddy.split('\n').filter((l) => /^\s*log\b/.test(l));
  assert.deepEqual(logs, ['\tlog default {']);
  // Extensions privées : deux points d'import génériques, vides par défaut, rien de nommé
  const imports = caddy.split('\n').filter((l) => /^\s*import\s+\//.test(l)).map((l) => l.trim());
  assert.deepEqual(imports, ['import /etc/caddy/extra/sites/*.caddy', 'import /etc/caddy/extra/*.caddy']);
  const hub = caddy.slice(caddy.indexOf('{$RELAY_DOMAIN} {'), caddy.indexOf('(app_headers)'));
  assert.ok(hub.indexOf('import /etc/caddy/extra/*.caddy') >= 0 && hub.indexOf('import /etc/caddy/extra/*.caddy') < hub.indexOf('reverse_proxy'), 'dans le bloc du relais, avant le relais');
  assert.ok(caddy.indexOf('import /etc/caddy/extra/sites/*.caddy') < caddy.indexOf('{$RELAY_DOMAIN} {'), 'au niveau supérieur');
  // Par défaut : un commentaire seul dans chaque glob (jamais d'import sans correspondance)
  assert.deepEqual(readdirSync(path.join(DEPLOY, 'extra')).sort(), ['00-vide.caddy', 'sites']);
  assert.deepEqual(readdirSync(path.join(DEPLOY, 'extra', 'sites')), ['00-vide.caddy']);
  for (const f of ['extra/00-vide.caddy', 'extra/sites/00-vide.caddy']) assert.ok(read(f).split('\n').every((l) => !l.trim() || l.startsWith('#')), f + ' : commentaires seulement');
  assert.doesNotMatch(caddy + read('docker-compose.yml'), /admin\.|back.?office|backoffice/i);
});

test('docker-compose : APP_ROOT en lecture seule pour Caddy, images officielles, scripts exécutables', () => {
  const dc = read('docker-compose.yml');
  assert.match(dc, /- \$\{APP_ROOT:-\/srv\/setremote-app\}:\/srv\/app:ro/);
  assert.match(dc, /APP_DOMAIN: \$\{APP_DOMAIN:\?/);
  assert.match(dc, /image: caddy:2\.11-alpine/);
  assert.match(dc, /image: coturn\/coturn:4\.18-alpine/);
  assert.doesNotMatch(dc, /mirror\.gcr\.io/);
  assert.match(dc, /- \.\/extra:\/etc\/caddy\/extra:ro/);
  // Compteur interne du relais : réseau Docker seulement, port jamais publié
  assert.match(dc, /RELAY_METRICS_PORT: \$\{RELAY_METRICS_PORT:-9090\}/);
  assert.match(dc, /RELAY_METRICS_HOST: 0\.0\.0\.0/);
  assert.doesNotMatch(dc, /9090:/);
  assert.match(dc, /^  relay:$/m, 'service « relay » : http://relay:9090/metrics dans le réseau');
  const env = read('.env.example');
  assert.match(env, /^APP_DOMAIN=set-remote\.itsi-app\.com$/m);
  assert.match(env, /^RELAY_DOMAIN=hub\.itsi-app\.com$/m);
  for (const f of ['update-app.sh', 'install-app-update.sh', 'check.sh']) assert.ok(statSync(path.join(DEPLOY, f)).mode & 0o111, f + ' exécutable');
  const unit = read('systemd/setremote-app-update.service');
  assert.match(unit, /^ReadWritePaths=\/srv\/setremote-app$/m);
  assert.match(read('systemd/setremote-app-update.timer'), /^OnUnitActiveSec=5min$/m);
});
