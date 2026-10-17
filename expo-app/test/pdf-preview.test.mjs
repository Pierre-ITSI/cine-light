// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Aperçu PDF de la table des canaux (src/lib/pdfPreview.ts) : validation du
// message de la page, appel d'expo-print (A4, marges iOS), erreurs renvoyées
// à la page par window.SRNative.receive, annulation silencieuse.
//
//   cd expo-app && npm test        (Node ≥ 22.18 : TypeScript sans transpilation)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  parsePdfPreview, pdfErrorScript, isPrintCancelled, createPdfPreviewer, utf8Length,
  PDF_HTML_MAX_BYTES, PDF_TITLE_MAX, PDF_ERROR_REASONS, A4_POINTS, IOS_MARGINS,
} from '../src/lib/pdfPreview.ts';

const HTML = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>T</title></head><body><h1>Étendu 16</h1></body></html>';
const req = (o = {}) => ({ type: 'pdf:preview', html: HTML, title: 'SetRemote — Table des canaux', ...o });
const flush = () => new Promise((r) => setImmediate(r));

// Exécute les scripts injectés comme la vue web : messages reçus par la page
function fakeWeb() {
  const received = [];
  // Copie JSON : objets du contexte vm (autre royaume) comparés en profondeur
  const ctx = vm.createContext({ window: { SRNative: { receive: (m) => received.push(JSON.parse(JSON.stringify(m))) } } });
  return { received, inject: (script) => vm.runInContext(script, ctx) };
}

test('messages étrangers à l\'aperçu PDF : null', () => {
  for (const m of [null, undefined, 42, 'pdf:preview', [], {}, { type: 'brightness', value: 1 }, { type: 'dmx:listen' }, { type: 'PDF:PREVIEW' }]) {
    assert.equal(parsePdfPreview(m), null, JSON.stringify(m));
  }
});

test('validation : html chaîne non vide ≤ 1 Mo (UTF-8), titre court sans caractère de contrôle', () => {
  assert.deepEqual(parsePdfPreview(req()), { ok: true, request: { html: HTML, title: 'SetRemote — Table des canaux' } });
  for (const html of [undefined, null, 12, '', '   ', ['<p>'], { html: 'x' }]) {
    assert.deepEqual(parsePdfPreview(req({ html })), { ok: false, reason: 'invalid-html' }, String(html));
  }
  assert.equal(parsePdfPreview(req({ html: 'a'.repeat(PDF_HTML_MAX_BYTES) })).ok, true, '1 Mo pile');
  assert.deepEqual(parsePdfPreview(req({ html: 'a'.repeat(PDF_HTML_MAX_BYTES + 1) })), { ok: false, reason: 'too-large' });
  // 1 Mo en octets UTF-8, pas en unités UTF-16 : « é » = 2 octets
  assert.deepEqual(parsePdfPreview(req({ html: 'é'.repeat(PDF_HTML_MAX_BYTES / 2 + 1) })), { ok: false, reason: 'too-large' });
  assert.equal(parsePdfPreview(req({ html: 'é'.repeat(PDF_HTML_MAX_BYTES / 2) })).ok, true);
  for (const title of [undefined, 3, '', '  ', 'x'.repeat(PDF_TITLE_MAX + 1), 'a\nb', 'a\u0000b', 'a\u2028b']) {
    assert.deepEqual(parsePdfPreview(req({ title })), { ok: false, reason: 'invalid-title' }, JSON.stringify(title));
  }
  assert.equal(parsePdfPreview(req({ title: 'x'.repeat(PDF_TITLE_MAX) })).ok, true);
  assert.deepEqual([utf8Length('a'), utf8Length('é'), utf8Length('—'), utf8Length('🎛'), utf8Length('\ud800')], [1, 2, 3, 4, 3]);
});

test('pdf:error : script injecté reçu par window.SRNative.receive', () => {
  const web = fakeWeb();
  for (const reason of PDF_ERROR_REASONS) web.inject(pdfErrorScript(reason));
  assert.deepEqual(web.received, PDF_ERROR_REASONS.map((reason) => ({ type: 'pdf:error', reason })));
  assert.match(pdfErrorScript('print-failed'), /;true;$/, 'injectJavaScript attend une expression finale');
});

test('aperçu : expo-print reçoit le html en A4 (marges sur iOS), une seule demande à la fois', async () => {
  for (const platform of ['ios', 'android']) {
    const web = fakeWeb();
    const calls = [];
    let release;
    const p = createPdfPreviewer({
      platform,
      loadPrint: () => (o) => { calls.push(o); return new Promise((r) => { release = r; }); },
      inject: web.inject,
    });
    assert.equal(p.handle({ type: 'brightness', value: 1 }), false);
    assert.equal(p.handle(req()), true);
    assert.equal(p.busy, true);
    assert.equal(p.handle(req({ html: '<p>2</p>' })), true, 'traitée mais ignorée : feuille déjà ouverte');
    assert.equal(calls.length, 1);
    const expected = { html: HTML, width: A4_POINTS.width, height: A4_POINTS.height };
    if (platform === 'ios') expected.margins = { ...IOS_MARGINS };
    assert.deepEqual(calls[0], expected, platform);
    release();
    await flush();
    assert.equal(p.busy, false);
    p.handle(req());
    assert.equal(calls.length, 2, 'nouvelle demande acceptée une fois la feuille fermée');
    release();
    await flush();
    assert.deepEqual(web.received, [], 'aucune erreur');
  }
});

test('erreurs : validation, expo-print absent, échec d\'impression ; annulation iOS silencieuse', async () => {
  const web = fakeWeb();
  let outcome;
  let available = true;
  const p = createPdfPreviewer({
    platform: 'ios',
    loadPrint: () => (available ? () => outcome() : null),
    inject: web.inject,
  });
  p.handle(req({ html: '' }));
  p.handle(req({ title: 'a\nb' }));
  outcome = () => Promise.reject(Object.assign(new Error('Printing did not complete'), { code: 'ERR_PRINT_INCOMPLETE' }));
  p.handle(req());
  await flush();
  outcome = () => Promise.reject(Object.assign(new Error('Error occurred while printing to PDF'), { code: 'ERR_PDF_NOT_RENDERED' }));
  p.handle(req());
  await flush();
  outcome = () => { throw new Error('synchrone'); };
  p.handle(req());
  await flush();
  available = false;
  p.handle(req());
  await flush();
  assert.deepEqual(web.received.map((m) => m.reason), ['invalid-html', 'invalid-title', 'print-failed', 'print-failed', 'unavailable']);
  assert.equal(p.busy, false);
  // Chargement d'expo-print qui lève (module natif absent du binaire)
  const web2 = fakeWeb();
  const p2 = createPdfPreviewer({ platform: 'android', loadPrint: () => { throw new Error("Cannot find native module 'ExpoPrint'"); }, inject: web2.inject });
  p2.handle(req());
  await flush();
  assert.deepEqual(web2.received, [{ type: 'pdf:error', reason: 'unavailable' }]);
  // Vue web absente : aucune exception
  const p3 = createPdfPreviewer({ platform: 'ios', loadPrint: () => null, inject: () => { throw new Error('no webview'); } });
  assert.equal(p3.handle(req()), true);
  assert.equal(isPrintCancelled({ code: 'ERR_PRINT_INCOMPLETE' }), true);
  assert.equal(isPrintCancelled(new Error('x')), false);
  assert.equal(isPrintCancelled(null), false);
});
