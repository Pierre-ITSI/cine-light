// Table des canaux DMX en PDF (maquette 17, bouton « PDF ») : document
// imprimable autonome (A4, noir sur blanc, aucune requête) avec le patch en
// cours et la table de chaque mode utilisé.
//   App native (pont simulé) : nativePost({ type: 'pdf:preview', html, title }),
//     erreurs de la coque ({ type: 'pdf:error' }) affichées.
//   Navigateur : print() appelé sur un iframe contenant le même document.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const NATIVE = {
  fn: () => {
    window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1 };
    window.__posted = [];
    window.ReactNativeWebView = { postMessage: (m) => window.__posted.push(JSON.parse(m)) };
  },
};
// Navigateur : print() de chaque fenêtre de cadre remplacé (relevé du document imprimé)
const STUB_PRINT = {
  fn: () => {
    window.__printed = [];
    window.print = () => window.__printed.push({ top: true });
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get() {
        const w = d.get.call(this);
        if (w && !w.__stubbed) {
          w.__stubbed = true;
          w.print = function () {
            window.__printed.push({ top: false, html: '<!DOCTYPE html>' + this.document.documentElement.outerHTML, title: this.document.title, frame: this.frameElement && this.frameElement.id });
          };
        }
        return w;
      },
    });
  },
};
const IDS = ['ScreenOne0000001', 'ScreenTwo0000002', 'ScreenTri0000003'];

// Télécommande, 3 écrans appairés, passerelle ouverte ; patch facultatif
async function setup(init, entries) {
  const p = await openPage(browser, { init });
  await p.page.evaluate(([ids, entries]) => {
    startMode('remote');
    setConnStatus('connected');
    ids.forEach((id, i) => remoteNoteScreen('s' + i + 'AAAAAAA', { type: 'caps', screenId: id }));
    openDmxGateway();
    entries.forEach((e, i) => gwPatchSet(ids[i], e));
  }, [IDS, entries]);
  return p;
}
const E16 = (universe, address) => ({ universe, address, personality: 'extended16' });
const S8 = (universe, address) => ({ universe, address, personality: 'standard8' });

// Document rendu à part (contexte qui refuse et relève toute requête)
async function inspect(html) {
  const ctx = await browser.newContext();
  const requests = [];
  await ctx.route('**/*', (r) => { requests.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage();
  await page.setContent(html);
  const doc = await page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    h1: document.querySelector('h1').textContent,
    meta: document.querySelector('.meta').textContent,
    patch: [...document.querySelectorAll('table.patch tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
    empty: document.querySelector('.empty') && document.querySelector('.empty').textContent,
    modes: [...document.querySelectorAll('section.mode')].map((s) => ({
      id: s.dataset.mode,
      title: s.querySelector('h2').textContent,
      screens: s.querySelector('.screens') ? s.querySelector('.screens').textContent : null,
      rows: [...s.querySelectorAll('tbody tr')].map((tr) => [...tr.cells].map((c) => c.textContent)),
      note: s.querySelector('.note') ? s.querySelector('.note').textContent : null,
    })),
    color: getComputedStyle(document.body).color,
    background: getComputedStyle(document.body).backgroundColor,
    scripts: document.scripts.length,
  }));
  await ctx.close();
  return { doc, requests };
}

const NOTE = 'Effet, média, appel, SMS : n × 10 à n × 10 + 9 choisit le n°. 1–9 et valeurs hors liste : sans effet. Appel et SMS se déclenchent une fois, à l\'entrée dans la plage.';

test('app native : « PDF » envoie pdf:preview avec le patch et la table de chaque mode utilisé', async () => {
  const { page, errors, close } = await setup(NATIVE, [E16(1, 1), E16(1, 17), S8(2, 1)]);
  await page.evaluate(() => gwOpenChannels('simple3'));
  const btn = await page.evaluate(() => {
    const b = document.getElementById('gwPdfBtn');
    const r = b.getBoundingClientRect();
    return { text: b.textContent, visible: r.width > 0 && r.height > 0, inHead: !!b.closest('#gwViewChannels .gw-head') };
  });
  assert.deepEqual(btn, { text: 'PDF', visible: true, inHead: true });
  await page.evaluate(() => { window.__posted.length = 0; });
  await page.click('#gwPdfBtn');
  const posted = await page.evaluate(() => window.__posted);
  assert.equal(posted.length, 1);
  const m = posted[0];
  assert.deepEqual(Object.keys(m).sort(), ['html', 'title', 'type']);
  assert.equal(m.type, 'pdf:preview');
  assert.equal(m.title, 'SetRemote — Table des canaux');
  assert.ok(new TextEncoder().encode(m.html).length < 1024 * 1024, '≤ 1 Mo');
  assert.match(m.html, /^<!DOCTYPE html>/);
  assert.match(m.html, /@page\{size:A4;/);
  assert.doesNotMatch(m.html, /https?:|url\(|@import|<script|<link|<img/i, 'aucune ressource externe');
  const { doc, requests } = await inspect(m.html);
  assert.deepEqual(requests, [], 'aucune requête au rendu');
  assert.equal(doc.scripts, 0);
  assert.equal(doc.title, 'SetRemote — Table des canaux');
  assert.equal(doc.lang, 'fr');
  assert.equal(doc.h1, 'SetRemote — Table des canaux');
  assert.match(doc.meta, /^\d{1,2}(er)? [a-zéû]+ \d{4}, \d\d:\d\d · sACN \(E1\.31\)$/, 'date et protocole');
  assert.equal(doc.color, 'rgb(0, 0, 0)');
  assert.equal(doc.background, 'rgb(255, 255, 255)');
  assert.deepEqual(doc.patch, [
    ['Écran 1', '1', '1–16', 'Étendu 16'],
    ['Écran 2', '1', '17–32', 'Étendu 16'],
    ['Écran 3', '2', '1–8', 'Standard 8'],
  ]);
  assert.deepEqual(doc.modes.map((x) => [x.id, x.title, x.screens, x.rows.length]), [
    ['extended16', 'Étendu 16 — 16 canaux', 'Écran 1, Écran 2', 16],
    ['standard8', 'Standard 8 — 8 canaux', 'Écran 3', 8],
  ], 'modes du patch seulement (pas Simple 3, affiché)');
  const e16 = doc.modes[0];
  assert.deepEqual(e16.rows[0], ['1', 'Dimmer', '0–255 · 0–100 %']);
  assert.deepEqual(e16.rows[1], ['2', 'Dimmer Fine', '16 bits avec le canal 1']);
  assert.deepEqual(e16.rows[13], ['14', 'Appel', '0 raccrocher · 10 = n°1 … 200 = n°20']);
  assert.deepEqual(e16.rows[15], ['16', 'Écran', '0–127 allumé · 128–255 noir']);
  assert.equal(e16.note, NOTE, 'règle des emplacements');
  assert.deepEqual(doc.modes[1].rows.map((r) => r[1]), ['Dimmer', 'Rouge', 'Vert', 'Bleu', 'CCT', 'Tint', 'Mix', 'Strobo']);
  assert.equal(doc.modes[1].note, null, 'Standard 8 : pas d\'emplacements');
  // La table affichée à l'écran est inchangée
  assert.equal(await page.textContent('#gwChTitle'), 'Simple 3');
  assert.deepEqual(errors, []);
  await close();
});

test('app native : rien de patché → table du mode affiché ; pdf:error de la coque affiché', async () => {
  const { page, errors, close } = await setup(NATIVE, []);
  await page.evaluate(() => gwOpenChannels('color5'));
  await page.click('#gwPdfBtn');
  const m = (await page.evaluate(() => window.__posted.filter((x) => x.type === 'pdf:preview')))[0];
  const { doc } = await inspect(m.html);
  assert.equal(doc.empty, 'Aucun écran patché.');
  assert.deepEqual(doc.patch, []);
  assert.deepEqual(doc.modes.map((x) => [x.id, x.title, x.screens, x.rows.length, x.note]), [['color5', 'Couleur 5 — 5 canaux', null, 5, null]]);
  assert.equal(await page.isVisible('#gwPdfError'), false);
  // Réponses de la coque (window.SRNative.receive, objet ou chaîne JSON)
  const shown = async (msg) => {
    assert.equal(await page.evaluate((x) => window.SRNative.receive(x), msg), true);
    return page.evaluate(() => {
      const el = document.getElementById('gwPdfError');
      return getComputedStyle(el).display === 'none' ? null : el.textContent;
    });
  };
  assert.equal(await shown({ type: 'pdf:error', reason: 'print-failed' }), 'Aperçu PDF impossible. Réessayez.');
  assert.equal(await shown(JSON.stringify({ type: 'pdf:error', reason: 'too-large' })), 'Table trop volumineuse pour l\'aperçu PDF.');
  assert.equal(await shown({ type: 'pdf:error', reason: 'unavailable' }), 'Aperçu PDF indisponible : mettez SetRemote à jour.');
  assert.equal(await shown({ type: 'pdf:error', reason: '<b>x</b>' }), 'Aperçu PDF impossible. Réessayez.', 'raison inattendue jamais affichée');
  // Le message reste affiché au rafraîchissement de la vue, disparaît au nouvel essai
  await page.evaluate(() => gwRender());
  assert.equal(await page.isVisible('#gwPdfError'), true);
  await page.click('#gwPdfBtn');
  assert.equal(await page.isVisible('#gwPdfError'), false);
  await page.evaluate(() => window.SRNative.receive({ type: 'pdf:error', reason: 'print-failed' }));
  await page.evaluate(() => { gwShowView('patch'); gwOpenChannels('color5'); });
  assert.equal(await page.isVisible('#gwPdfError'), false, 'effacé en changeant de vue');
  assert.deepEqual(errors, []);
  await close();
});

test('navigateur : print() sur un iframe caché contenant le même document, rien vers la coque', async () => {
  const { page, errors, close } = await setup(STUB_PRINT, [E16(1, 1), E16(1, 17)]);
  await page.evaluate(() => gwOpenChannels('extended16'));
  assert.equal(await page.evaluate(() => IN_NATIVE_APP), false);
  assert.equal(await page.isVisible('#gwPdfBtn'), true);
  await page.click('#gwPdfBtn');
  const printed = await waitFor(page, () => window.__printed.length && window.__printed);
  assert.equal(printed.length, 1, 'une seule impression');
  const p = printed[0];
  assert.equal(p.top, false, 'pas la page de l\'app');
  assert.equal(p.frame, 'gwPrintFrame');
  assert.equal(p.title, 'SetRemote — Table des canaux');
  const frame = await page.evaluate(() => {
    const f = document.getElementById('gwPrintFrame');
    const cs = getComputedStyle(f);
    return { display: cs.display, w: f.getBoundingClientRect().width, h: f.getBoundingClientRect().height, hidden: f.getAttribute('aria-hidden') };
  });
  assert.notEqual(frame.display, 'none', 'cadre rendu (imprimable)');
  assert.deepEqual([frame.w, frame.h, frame.hidden], [0, 0, 'true'], 'invisible');
  const { doc, requests } = await inspect(p.html);
  assert.deepEqual(requests, []);
  assert.deepEqual(doc.patch, [['Écran 1', '1', '1–16', 'Étendu 16'], ['Écran 2', '1', '17–32', 'Étendu 16']]);
  assert.deepEqual(doc.modes.map((x) => [x.id, x.screens, x.rows.length, x.note]), [['extended16', 'Écran 1, Écran 2', 16, NOTE]]);
  // Même document que celui envoyé à la coque (hors date, figée ici)
  const same = await page.evaluate((html) => {
    const t = new Date(2026, 9, 1, 9, 5);
    const a = gwChannelsPdfHtml(t);
    return a === gwChannelsPdfHtml(t) && /1er octobre 2026, 09:05/.test(a) && html.replace(/<p class="meta">[^<]*<\/p>/, '') === a.replace(/<p class="meta">[^<]*<\/p>/, '');
  }, p.html);
  assert.equal(same, true);
  // Deuxième demande : le cadre précédent est remplacé
  await page.click('#gwPdfBtn');
  await waitFor(page, () => window.__printed.length === 2);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#gwPrintFrame').length), 1);
  assert.equal(await page.isVisible('#gwPdfError'), false);
  assert.deepEqual(errors, []);
  await close();
});
