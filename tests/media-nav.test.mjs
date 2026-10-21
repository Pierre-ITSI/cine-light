// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Média : navigation de l'acteur sur l'écran de jeu (Fixe | Toucher | Glisser | Défiler).
// Réglage et migration de l'ancien « avancer au clic », segmenté et habillage de la télécommande,
// media:nav envoyé, carrousel (accrochage, boucle, élan), fil (défilement, media:view, habillage),
// vidéos lues seulement en vue, indicateur « en vue », Précédent / Suivant dans chaque mode,
// étape de séquence (applique puis rend le réglage de l'onglet Média).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });
const SIZES = [[64, 48], [64, 64], [64, 80], [80, 40], [64, 64]]; // aspects naturels variés (largeur × hauteur)
const COLORS = ['#c0392b', '#27ae60', '#2980b9', '#f1c40f', '#8e44ad'];

// Télécommande + un écran appairés, pool de 5 images déjà en cache sur l'écran
async function rig(seed, opts = {}) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('media'); });
  await connected(rp);
  const hash = await pairingHash(rp);
  const screen = await openPage(browser, { broker, seed: seed * 10 + 1, autoConnect: true, hash });
  const sp = screen.page;
  await connected(sp);
  await waitFor(rp, () => _screenOfSender.size === 1 && scrList().length === 1);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  if (opts.pool !== false) {
    await rp.evaluate(async ([sizes, colors]) => {
      const mk = (i) => new Promise((res) => {
        const c = document.createElement('canvas'); c.width = sizes[i][0]; c.height = sizes[i][1];
        const g = c.getContext('2d'); g.fillStyle = colors[i]; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#fff'; g.fillRect(4, 4, 12, 12);
        c.toBlob((b) => res(new File([b], 'plan-' + (i + 1) + '.png', { type: 'image/png' })), 'image/png');
      });
      onAddImages(await Promise.all(sizes.map((_, i) => mk(i))));
    }, [SIZES, COLORS]);
    await waitFor(sp, () => ['m1', 'm2', 'm3', 'm4', 'm5'].every((i) => _mediaCache.has(i)) && _mediaOrder.length === 5, null, { timeout: 15000 });
    await waitFor(sp, () => !!_screenActiveId && _screenActiveId === 'm1');
  }
  await broker.flush();
  return { broker, remote, rp, screen, sp, close: async () => { await screen.close(); await remote.close(); } };
}
const noErrors = (r) => { for (const p of [r.remote, r.screen]) assert.deepEqual(p.errors, []); };
const sentBy = (r, page, type) => r.broker.sent(page, type);
// Mode de navigation choisi sur la télécommande, appliqué par l'écran
async function setNav(r, mode, skin) {
  await r.rp.evaluate(([m, s]) => { if (s) setMediaSkin(s); setMediaNav(m); }, [mode, skin || null]);
  await r.broker.flush();
  await waitFor(r.sp, (m) => _screenNav === m, mode);
}
const dragTo = async (page, x0, x1, y = 500, steps = 6) => {
  await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move(x1, y, { steps }); await page.mouse.up();
};
const settleNav = (page) => waitFor(page, () => !_nav.anim && !_nav.drag, null, { timeout: 4000 });

describe('réglage : migration, segmenté, habillage, media:nav', () => {
  let r;
  before(async () => { r = await rig(21, { pool: false }); });
  after(async () => { noErrors(r); await r?.close(); });

  test('migration : ancien « avancer au clic » activé = Toucher, désactivé = Fixe', async () => {
    const { rp, sp } = r;
    assert.equal(await rp.evaluate(() => [mediaNavFromLegacy(true), mediaNavFromLegacy(false)].join()), 'tap,off');
    // Ancienne API booléenne conservée (appelants existants)
    await rp.evaluate(() => setAutoAdvance(true));
    assert.equal(await rp.evaluate(() => _mediaNav), 'tap');
    await rp.evaluate(() => setAutoAdvance(false));
    assert.equal(await rp.evaluate(() => _mediaNav), 'off');
    // Ancien état (booléen autoAdvance, sans nav) rechargé dans l'interface : Toucher
    await rp.evaluate(() => { const s = scrAll(); delete s.nav; delete s.skin; s.autoAdvance = true; scrLoadView(); });
    assert.equal(await rp.evaluate(() => _mediaNav), 'tap');
    assert.equal(await rp.evaluate(() => document.getElementById('mnav-tap').getAttribute('aria-checked')), 'true');
    await rp.evaluate(() => { const s = scrAll(); delete s.nav; s.autoAdvance = false; scrLoadView(); });
    assert.equal(await rp.evaluate(() => _mediaNav), 'off');
    // Écran : une télécommande plus ancienne n'envoie que media:autoadvance
    await sp.evaluate(() => { _screenNavSeen = false; dispatchMessage({ type: 'media:autoadvance', on: true }); });
    assert.deepEqual(await sp.evaluate(() => [_screenNav, _screenAutoAdvance]), ['tap', true]);
    await sp.evaluate(() => dispatchMessage({ type: 'media:autoadvance', on: false }));
    assert.equal(await sp.evaluate(() => _screenNav), 'off');
    // Dès qu'un media:nav est arrivé, l'ancien message ne change plus le mode
    await sp.evaluate(() => { dispatchMessage({ type: 'media:nav', mode: 'swipe', skin: 'none' }); dispatchMessage({ type: 'media:autoadvance', on: false }); });
    assert.equal(await sp.evaluate(() => _screenNav), 'swipe');
    // Valeurs hors liste : rejetées
    await sp.evaluate(() => { dispatchMessage({ type: 'media:nav', mode: 'zoom', skin: 'none' }); dispatchMessage({ type: 'media:nav', mode: 'scroll', skin: 'x' }); });
    assert.equal(await sp.evaluate(() => _screenNav), 'swipe');
    await sp.evaluate(() => { _screenNavSeen = false; screenSetNav('off', 'none'); });
  });

  test('segmenté « Sur l\'écran de jeu » : 4 modes, habillage seulement avec Défiler, media:nav envoyé', async () => {
    const { rp, sp, broker } = r;
    await rp.evaluate(() => { setMediaNav('off'); setMediaSkin('none'); });
    await broker.flush(); broker.clear();
    const labels = await rp.$$eval('#mediaNavSeg .chip', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(labels, ['Fixe', 'Toucher', 'Glisser', 'Défiler']);
    assert.equal(await rp.evaluate(() => document.getElementById('mediaAutoAdvRow')), null, 'ancienne case retirée');
    const skinShown = () => rp.evaluate(() => getComputedStyle(document.getElementById('mediaNavSkin')).display !== 'none');
    const checked = () => rp.$$eval('#mediaNavSeg .chip', (els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.id));
    assert.deepEqual(await checked(), ['mnav-off']);
    assert.equal(await skinShown(), false);
    for (const [k, skin] of [['tap', false], ['swipe', false], ['scroll', true], ['off', false]]) {
      await rp.click('#mnav-' + k);
      assert.deepEqual(await checked(), ['mnav-' + k]);
      assert.equal(await skinShown(), skin, 'habillage visible seulement avec Défiler : ' + k);
      assert.match(await rp.textContent('#mediaNavHint'), /\S/);
    }
    const sent = await sentBy(r, rp, 'media:nav');
    assert.deepEqual(sent.map((m) => m.mode), ['tap', 'swipe', 'scroll', 'off']);
    assert.ok(sent.every((m) => m.skin === 'none'));
    // Ancien message conservé pendant la transition : on = (mode === 'tap')
    assert.deepEqual((await sentBy(r, rp, 'media:autoadvance')).map((m) => m.on), [true, false, false, false]);
    // Habillage : Fil social
    await rp.click('#mnav-scroll');
    await rp.click('#mskin-social');
    assert.deepEqual(await rp.$$eval('#mediaSkinSeg .chip', (els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.id)), ['mskin-social']);
    await broker.flush();
    assert.deepEqual((await sentBy(r, rp, 'media:nav')).slice(-1).map((m) => [m.mode, m.skin]), [['scroll', 'social']]);
    await waitFor(sp, () => _screenNav === 'scroll' && _screenSkin === 'social');
    // Rechargement de l'interface depuis l'état de la cible : le réglage suit
    await rp.evaluate(() => { _mediaNav = 'off'; _mediaSkin = 'none'; scrLoadView(); });
    assert.deepEqual(await rp.evaluate(() => [_mediaNav, _mediaSkin]), ['scroll', 'social']);
    await rp.evaluate(() => { setMediaSkin('none'); setMediaNav('off'); });
  });

  test('resynchronisation : le mode revient à un écran rechargé', async () => {
    const { rp, broker, screen } = r;
    await rp.evaluate(() => { setMediaSkin('social'); setMediaNav('scroll'); });
    await broker.flush();
    const hash = await pairingHash(rp);
    const s2 = await openPage(browser, { broker, seed: 77, autoConnect: true, hash });
    await connected(s2.page);
    await waitFor(s2.page, () => _screenNav === 'scroll' && _screenSkin === 'social', null, { timeout: 8000 });
    assert.deepEqual(s2.errors, []);
    await s2.close();
    await rp.evaluate(() => { setMediaSkin('none'); setMediaNav('off'); });
  });
});

describe('écran : Glisser (carrousel)', () => {
  let r;
  before(async () => { r = await rig(22); });
  after(async () => { noErrors(r); await r?.close(); });

  const slides = (sp) => sp.$$eval('#screen-media-nav .mn-slide', (els) => els.map((e) => e.dataset.id));

  test('piste de trois éléments sur le média courant ; invisible pour l\'élément historique', async () => {
    const { rp, sp } = r;
    await setNav(r, 'swipe');
    await rp.evaluate(() => selectMedia('m2'));
    await r.broker.flush();
    await waitFor(sp, () => _screenActiveId === 'm2' && _nav.on && _nav.ids[_nav.idx] === 'm2');
    assert.deepEqual((await slides(sp)).sort(), ['m1', 'm2', 'm3']);
    assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-media-nav')).display), 'block');
    assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-media-img')).visibility), 'hidden');
    assert.equal(await sp.evaluate(() => screenMediaVisible()), true);
    // 12 px de noir entre deux médias
    const g = await sp.evaluate(() => { const [a, b] = [...document.querySelectorAll('.mn-slide')].map((e) => e.getBoundingClientRect()).sort((x, y) => x.left - y.left).slice(1); return Math.round(b.left - a.right); });
    assert.equal(g, 12);
  });

  test('glisser du doigt : suit, s\'accroche au média voisin, rapporte media:view ; sans menu ni clic', async () => {
    const { rp, sp, broker } = r;
    broker.clear();
    const x0 = 300;
    await sp.mouse.move(x0, 200); await sp.mouse.down(); await sp.mouse.move(x0 - 120, 200, { steps: 4 });
    // Pendant le geste : la piste suit le doigt (seulement transform)
    assert.match(await sp.evaluate(() => _nav.track.style.transform), /^translate3d\(-120px, 0(px)?, 0(px)?\)$/);
    await sp.mouse.up();
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm3' && !_nav.anim);
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm3');
    assert.deepEqual((await slides(sp)).sort(), ['m2', 'm3', 'm4']);
    assert.match(await sp.evaluate(() => _nav.track.style.transform), /^translate3d\(0(px)?, 0(px)?, 0(px)?\)$/);
    await broker.flush();
    const views = await sentBy(r, sp, 'media:view');
    assert.deepEqual(views.map((m) => [m.id, m.idx, m.n]), [['m3', 2, 5]]);
    assert.equal(await sp.evaluate(() => document.getElementById('screen-menu').style.display === 'flex'), false, 'le geste n\'ouvre pas le menu de l\'écran');
    assert.equal((await sentBy(r, sp, 'media:advance')).length + (await sentBy(r, sp, 'media:advanced')).length, 0, 'aucune avance au toucher');
    // La télécommande suit : média actif, pastille « 3 / 5 · plan-3 »
    await waitFor(rp, () => _activeMediaId === 'm3');
    assert.equal(await rp.evaluate(() => document.getElementById('mediaInViewPos').textContent), '3 / 5 · plan-3.png');
    assert.equal(await rp.evaluate(() => getComputedStyle(document.getElementById('mediaInView')).display), 'flex');
  });

  test('sous le seuil le média revient ; un coup de doigt rapide change de média ; vers la droite : précédent', async () => {
    const { sp } = r;
    await dragTo(sp, 300, 280, 500, 1);          // 20 px : trop court
    await settleNav(sp);
    assert.equal(await sp.evaluate(() => _nav.ids[_nav.idx]), 'm3');
    await dragTo(sp, 300, 240, 500, 1);          // 60 px, d'un coup : élan
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm4' && !_nav.anim);
    await dragTo(sp, 60, 300, 500, 5);           // > 25 % vers la droite
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm3' && !_nav.anim);
  });

  test('boucle : du dernier au premier, et du premier au dernier', async () => {
    const { rp, sp } = r;
    await rp.evaluate(() => selectMedia('m5'));
    await r.broker.flush();
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm5' && !_nav.anim);
    assert.deepEqual((await slides(sp)).sort(), ['m1', 'm4', 'm5'], 'le premier est déjà voisin du dernier');
    await dragTo(sp, 300, 60);
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm1' && !_nav.anim);
    assert.deepEqual((await slides(sp)).sort(), ['m2', 'm1', 'm5'].sort());
    await dragTo(sp, 60, 300);
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm5' && !_nav.anim);
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm5');
  });

  test('Précédent / Suivant de la télécommande font glisser l\'écran (media:show), en boucle', async () => {
    const { rp, sp, broker } = r;
    await rp.evaluate(() => selectMedia('m5'));
    await broker.flush();
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm5' && !_nav.anim);
    broker.clear();
    await rp.click('#mediaNav button:last-child');       // Suivant : m5 → m1 (boucle)
    await broker.flush();
    assert.deepEqual((await sentBy(r, rp, 'media:show')).map((m) => m.id), ['m1']);
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm1' && !_nav.anim);
    await rp.click('#mediaNav button:first-child');      // Précédent : m1 → m5
    await broker.flush();
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm5' && !_nav.anim);
    assert.equal(await rp.evaluate(() => _activeMediaId), 'm5');
    // Saut à un média éloigné : direct, sans passer par les voisins
    await rp.evaluate(() => selectMedia('m3'));
    await broker.flush();
    await waitFor(sp, () => _nav.ids[_nav.idx] === 'm3' && !_nav.anim);
    assert.deepEqual((await slides(sp)).sort(), ['m2', 'm3', 'm4']);
  });

  test('retour à Fixe : le média courant reprend l\'affichage historique', async () => {
    const { sp } = r;
    await setNav(r, 'off');
    await waitFor(sp, () => !_nav.on);
    assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-media-nav')).display), 'none');
    assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-media-img')).visibility), 'visible');
    assert.equal(await sp.evaluate(() => document.getElementById('screen-media-img').getAttribute('src') === _mediaCache.get(_screenActiveId).data), true);
    // Fixe : glisser ne fait rien
    await dragTo(sp, 300, 60);
    await sleep(150);
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm3');
  });
});

describe('écran : Défiler (fil)', () => {
  let r;
  before(async () => { r = await rig(23); });
  after(async () => { noErrors(r); await r?.close(); });

  const items = (sp) => sp.$$eval('#screen-media-nav .mn-item', (els) => els.map((e) => e.dataset.id));
  const lastView = async (rr) => (await sentBy(rr, rr.sp, 'media:view')).slice(-1)[0];

  test('fil de tous les médias du pool, à leur aspect naturel, 6 px entre eux, défilement natif', async () => {
    const { rp, sp } = r;
    await setNav(r, 'scroll', 'none');
    await rp.evaluate(() => selectMedia('m1'));
    await r.broker.flush();
    await waitFor(sp, () => _nav.on && _nav.mode === 'scroll');
    assert.deepEqual(await items(sp), ['m1', 'm2', 'm3', 'm4', 'm5']);
    // Aspects mesurés une fois : hauteur = largeur / ratio (390 px de large)
    await waitFor(sp, () => ['m1', 'm2', 'm3', 'm4', 'm5'].every((i) => _mediaCache.get(i).ar), null, { timeout: 5000 });
    const hs = await sp.$$eval('.mn-media', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.deepEqual(hs, SIZES.map(([w, h]) => Math.round(390 * h / w)));
    const gap = await sp.evaluate(() => { const [a, b] = [...document.querySelectorAll('.mn-item')].map((e) => e.getBoundingClientRect()); return Math.round(b.top - a.bottom); });
    assert.equal(gap, 6);
    const css = await sp.evaluate(() => { const c = getComputedStyle(document.querySelector('.mn-scroller')); return [c.overflowY, c.scrollSnapType, c.touchAction]; });
    assert.deepEqual(css, ['auto', 'none', 'pan-y']);
    // Pas d'habillage
    assert.equal(await sp.evaluate(() => document.querySelectorAll('.mn-top, .mn-ph-head, .mn-ph-acts').length), 0);
  });

  test('défiler change le média dominant : media:view (dominant et visibles), indicateur de la télécommande', async () => {
    const { rp, sp, broker } = r;
    broker.clear();
    await sp.evaluate(() => { const sc = _nav.scroller; sc.scrollTop = sc.querySelector('.mn-item[data-id="m3"]').offsetTop - 60; });
    await waitFor(sp, () => _nav.dom === 'm3');
    await sleep(NAV_REPORT_WAIT);
    await broker.flush();
    const v = await lastView(r);
    assert.equal(v.id, 'm3'); assert.equal(v.idx, 2); assert.equal(v.n, 5);
    assert.deepEqual(v.vis, ['m3', 'm4'], 'visibles : ' + JSON.stringify(v.vis));
    await waitFor(rp, () => _activeMediaId === 'm3');
    await waitFor(rp, () => /visible/.test(document.getElementById('mediaInViewPos').textContent));
    assert.equal(await rp.evaluate(() => document.getElementById('mediaInViewPos').textContent), '3 / 5 · plan-3.png · visible : 3 et 4');
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm3');
  });

  test('rapports limités : jamais à chaque image du défilement', async () => {
    const { sp, broker } = r;
    broker.clear();
    await sp.evaluate(async () => {
      const sc = _nav.scroller;
      for (let i = 0; i < 40; i++) { sc.scrollTop = (i % 2 ? 0 : 900) + i * 5; await new Promise((res) => requestAnimationFrame(res)); }
    });
    await sleep(NAV_REPORT_WAIT + 100);
    await broker.flush();
    const n = (await sentBy(r, sp, 'media:view')).length;
    assert.ok(n <= 4, 'au plus 4 media:view par seconde, reçu ' + n);
  });

  test('Précédent / Suivant : défilement fluide vers le média, sans rapports intermédiaires', async () => {
    const { rp, sp, broker } = r;
    await rp.evaluate(() => selectMedia('m1'));
    await broker.flush();
    await waitFor(sp, () => _nav.dom === 'm1' && _nav.scroller.scrollTop < 5);
    await sleep(NAV_REPORT_WAIT + 100);
    broker.clear();
    await rp.click('#mediaNav button:last-child');       // Suivant : m2
    await broker.flush();
    assert.deepEqual((await sentBy(r, rp, 'media:show')).map((m) => m.id), ['m2']);
    await waitFor(sp, () => { const it = _nav.scroller.querySelector('.mn-item[data-id="m2"]'); return Math.abs(_nav.scroller.scrollTop - it.offsetTop) < 2; }, null, { timeout: 5000 });
    await waitFor(sp, () => !_nav.prog);
    await sleep(NAV_REPORT_WAIT + 100);
    await broker.flush();
    const ids = (await sentBy(r, sp, 'media:view')).map((m) => m.id);
    assert.ok(ids.every((i) => i === 'm2'), 'seul le média visé est rapporté : ' + ids);
    await rp.click('#mediaNav button:first-child');      // Précédent : m1
    await broker.flush();
    await waitFor(sp, () => _nav.scroller.scrollTop < 2, null, { timeout: 5000 });
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm1');
  });

  test('habillage « fil social » : titre, avatar, pseudo, icônes, J\'aime, légende ; absent sans habillage', async () => {
    const { sp } = r;
    await setNav(r, 'scroll', 'social');
    await waitFor(sp, () => _nav.skin === 'social');
    const c = await sp.evaluate(() => ({
      top: document.querySelector('.mn-top').textContent,
      heads: document.querySelectorAll('.mn-ph-head').length, foots: document.querySelectorAll('.mn-ph-acts').length,
      icons: [...document.querySelectorAll('.mn-item:first-child .mn-ph-acts svg')].length,
      initial: document.querySelector('.mn-av i').textContent, name: document.querySelector('.mn-name').firstChild.textContent,
      likes: document.querySelector('.mn-ph-txt b').textContent,
      brand: /instagram|insta\b|facebook|tiktok|twitter/i.test(document.querySelector('#screen-media-nav').textContent),
      pad: getComputedStyle(document.querySelector('.mn-scroller')).paddingTop,
    }));
    assert.equal(c.top, 'Publications');
    assert.deepEqual([c.heads, c.foots, c.icons], [5, 5, 4]);
    assert.equal(c.initial, c.name.charAt(0).toUpperCase());
    assert.match(c.likes, /J'aime$/);
    assert.equal(c.brand, false);
    assert.equal(c.pad, '80px');
    // Retour à « Aucun » : même fil, sans habillage, au même endroit
    await setNav(r, 'scroll', 'none');
    await waitFor(sp, () => _nav.skin === 'none');
    assert.equal(await sp.evaluate(() => document.querySelectorAll('.mn-top, .mn-ph-head, .mn-ph-acts').length), 0);
  });

  test('toucher dans le fil : ni avance, ni menu de l\'écran', async () => {
    const { sp, broker } = r;
    broker.clear();
    await sp.mouse.click(100, 100);
    await sleep(120);
    await broker.flush();
    assert.equal((await sentBy(r, sp, 'media:advance')).length, 0);
    assert.equal(await sp.evaluate(() => document.getElementById('screen-menu').style.display === 'flex'), false);
  });
});

// Valeur d'attente : un peu plus que NAV_REPORT_MS (250 ms)
const NAV_REPORT_WAIT = 320;

describe('écran : vidéos du fil, décodage paresseux', () => {
  let r;
  before(async () => { r = await rig(24); });
  after(async () => { noErrors(r); await r?.close(); });

  test('une vidéo ne joue (muette) que dominante et visible à 60 % ; hors vue, en pause', async () => {
    const { rp, sp } = r;
    // Lecteur simulé : l'app ne décode pas de vrai fichier ici, seules la lecture et la pause comptent
    await sp.evaluate(() => {
      window.__plays = [];
      HTMLMediaElement.prototype.play = function () { this.__pl = true; window.__plays.push(this.closest('.mn-item') ? this.closest('.mn-item').dataset.id : '?'); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () { this.__pl = false; };
      Object.defineProperty(HTMLMediaElement.prototype, 'paused', { configurable: true, get() { return !this.__pl; } });
      // m2 et m4 deviennent des vidéos du cache (URL factice : pas de décodage)
      for (const id of ['m2', 'm4']) _mediaCache.set(id, { kind: 'vid', url: 'blob:fake-' + id });
      // Médias plus hauts que l'écran : chacun, calé en haut, est dominant et visible à plus de 60 %
      for (const id of ['m1', 'm2', 'm3', 'm4', 'm5']) _mediaCache.get(id).ar = 0.45;
    });
    await setNav(r, 'scroll', 'none');
    await rp.evaluate(() => selectMedia('m1'));
    await r.broker.flush();
    await waitFor(sp, () => _nav.on && _nav.mode === 'scroll');
    const state = () => sp.$$eval('.mn-item video', (vs) => vs.map((v) => [v.closest('.mn-item').dataset.id, !v.paused, v.muted]));
    await waitFor(sp, () => document.querySelectorAll('.mn-item video').length >= 1);
    assert.ok((await state()).every(([, playing]) => !playing), 'aucune vidéo en vue : aucune ne joue');
    // m2 passe en haut de l'écran : dominante, visible à plus de 60 %
    await sp.evaluate(() => { const sc = _nav.scroller; sc.scrollTop = sc.querySelector('.mn-item[data-id="m2"]').offsetTop; });
    await waitFor(sp, () => _nav.dom === 'm2');
    await waitFor(sp, () => { const v = document.querySelector('.mn-item[data-id="m2"] video'); return !!v && !v.paused; });
    const s1 = await state();
    assert.deepEqual(s1.filter(([, p]) => p).map(([id, , m]) => [id, m]), [['m2', true]], 'une seule vidéo, muette');
    assert.equal(await sp.evaluate(() => screenMediaVideoEl().closest('.mn-item').dataset.id), 'm2', 'les commandes visent la dominante');
    // Loin de m2 : en pause ; m4 prend le relais plus bas
    await sp.evaluate(() => { const sc = _nav.scroller; sc.scrollTop = sc.querySelector('.mn-item[data-id="m4"]').offsetTop; });
    await waitFor(sp, () => _nav.dom === 'm4');
    await waitFor(sp, () => { const v = document.querySelector('.mn-item[data-id="m4"] video'); return !!v && !v.paused; });
    assert.deepEqual((await state()).filter(([, p]) => p).map(([id]) => id), ['m4']);
    // Retour sur une image : plus aucune vidéo ne joue
    await sp.evaluate(() => { const sc = _nav.scroller; sc.scrollTop = sc.querySelector('.mn-item[data-id="m5"]').offsetTop; });
    await waitFor(sp, () => _nav.dom === 'm5');
    await waitFor(sp, () => [...document.querySelectorAll('.mn-item video')].every((v) => v.paused));
  });

  test('décodage paresseux : les images lointaines n\'ont pas de source (cadre vide de la bonne hauteur)', async () => {
    const { rp, sp } = r;
    // Pool de 12 images : les premières seulement sont décodées
    await sp.evaluate(() => {
      const ids = [];
      for (let i = 1; i <= 12; i++) {
        const id = 'z' + i; ids.push(id);
        const c = document.createElement('canvas'); c.width = 40; c.height = 40; c.getContext('2d').fillRect(0, 0, 40, 40);
        _mediaCache.set(id, { kind: 'img', data: c.toDataURL('image/png'), ar: 1 });
      }
      _mediaOrder = ids; _screenActiveId = 'z1'; showScreenMedia('img'); screenNavShow('z1');
    });
    await waitFor(sp, () => _nav.on && _nav.ids.length === 12);
    await waitFor(sp, () => document.querySelectorAll('.mn-media img').length > 0);
    const r2 = await sp.evaluate(() => ({
      withImg: document.querySelectorAll('.mn-media img').length, all: document.querySelectorAll('.mn-media').length,
      lastEmpty: !document.querySelector('.mn-item[data-id="z12"] img'), lastH: Math.round(document.querySelector('.mn-item[data-id="z12"] .mn-media').getBoundingClientRect().height),
    }));
    assert.equal(r2.all, 12);
    assert.ok(r2.withImg < 12 && r2.withImg >= 1, 'seules les images proches sont décodées : ' + r2.withImg);
    assert.equal(r2.lastEmpty, true);
    assert.equal(r2.lastH, 390, 'cadre vide de la bonne hauteur');
    // En approchant, l'image apparaît
    await sp.evaluate(() => { const sc = _nav.scroller; sc.scrollTop = sc.scrollHeight; });
    await waitFor(sp, () => !!document.querySelector('.mn-item[data-id="z12"] img'));
  });
});

describe('Précédent / Suivant dans Fixe et Toucher', () => {
  let r;
  before(async () => { r = await rig(25); });
  after(async () => { noErrors(r); await r?.close(); });

  for (const mode of ['off', 'tap']) {
    test(mode === 'off' ? 'Fixe : la télécommande change de média, l\'acteur ne navigue pas' : 'Toucher : un toucher avance, en boucle', async () => {
      const { rp, sp, broker } = r;
      await setNav(r, mode);
      await rp.evaluate(() => selectMedia('m1'));
      await broker.flush();
      await waitFor(sp, () => _screenActiveId === 'm1');
      await rp.click('#mediaNav button:last-child');
      await broker.flush();
      await waitFor(sp, () => _screenActiveId === 'm2');
      assert.equal(await sp.evaluate(() => _nav.on), false);
      assert.equal(await sp.evaluate(() => getComputedStyle(document.getElementById('screen-media-nav')).display), 'none');
      await rp.click('#mediaNav button:first-child');
      await broker.flush();
      await waitFor(sp, () => _screenActiveId === 'm1');
      assert.equal(await rp.evaluate(() => document.getElementById('mediaInView').style.display), 'none', 'pastille « en vue » réservée à Glisser / Défiler');
      broker.clear();
      // Un toucher sur l'écran
      await sp.mouse.click(200, 400);
      await sleep(150);
      await broker.flush();
      const adv = (await sentBy(r, sp, 'media:advanced')).length + (await sentBy(r, sp, 'media:advance')).length;
      assert.equal(adv, mode === 'tap' ? 1 : 0);
      if (mode === 'tap') await waitFor(sp, () => _screenActiveId === 'm2');
      else assert.equal(await sp.evaluate(() => _screenActiveId), 'm1');
    });
  }

  test('Toucher : un déplacement de plus de 8 px n\'est pas un toucher', async () => {
    const { sp, broker } = r;
    await setNav(r, 'tap');
    await sp.evaluate(() => screenShowCached('m1'));
    broker.clear();
    await sp.evaluate(() => {
      const el = document.getElementById('screen-mode');
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 400, bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { clientX: 140, clientY: 400, bubbles: true }));
    });
    await sleep(100);
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm1');
  });
});

describe('Séquence : étape Média avec navigation', () => {
  let r;
  before(async () => {
    r = await rig(26);
    await r.rp.evaluate(() => { switchTab('seq'); setSeqMode('play'); SEQ_GO_GUARD_MS = 0; });
  });
  after(async () => { noErrors(r); await r?.close(); });

  const step = (id, kind, ref, opt, trig) => ({ id, kind, ref, trig: trig || { k: 'go' }, target: null, opt: opt || {} });
  const media = (n, opt) => step('s' + n, 'media', { id: 'm' + n, name: 'plan-' + n + '.png', kind: 'img' }, Object.assign({ end: 'loop' }, opt));
  const run = (rp, steps) => rp.evaluate((steps) => { _seq.steps = seqSanitizeSteps(steps); _seq.target = seqResolveTarget(null, _seq.steps); seqSave(); renderSeq(); }, steps);
  const go = async (rr) => { await rr.rp.evaluate(() => seqGo(true, true)); await rr.broker.flush(); await sleep(60); await rr.broker.flush(); };

  test('opt.nav / opt.skin / opt.start : relus, bornés, conservés (séquence enregistrée, projet)', async () => {
    const { rp } = r;
    const out = await rp.evaluate(() => {
      const f = (opt) => seqSanitizeStep({ id: 'a', kind: 'media', ref: { id: 'm1', name: 'x', kind: 'img' }, trig: { k: 'go' }, target: null, opt }).opt;
      const kept = f({ end: 'pause', nav: 'scroll', skin: 'social', start: 'pool' });
      return {
        old: f({ end: 'loop' }), kept, bad: f({ nav: 'zoom', skin: 'neon', start: 'x' }), def: _seqEditDefaults ? (() => { const s = { id: 'b', kind: 'media' }; _seqEditDefaults(s); return s.opt; })() : null,
        round: seqSanitizeSteps(JSON.parse(JSON.stringify([{ id: 'a', kind: 'media', ref: { id: 'm1', name: 'x', kind: 'img' }, trig: { k: 'go' }, target: null, opt: kept }])))[0].opt,
      };
    });
    assert.deepEqual(out.old, { end: 'loop', nav: 'inherit', skin: 'none', start: 'cur' }, 'anciennes étapes : Hérité');
    assert.deepEqual(out.kept, { end: 'pause', nav: 'scroll', skin: 'social', start: 'pool' });
    assert.deepEqual(out.bad, { end: 'loop', nav: 'inherit', skin: 'none', start: 'cur' });
    assert.deepEqual(out.def, { end: 'loop', nav: 'inherit', skin: 'none', start: 'cur' });
    assert.deepEqual(out.round, out.kept);
  });

  test('séquence enregistrée : la navigation de l\'étape survit à l\'enregistrement, au rechargement et au chargement', async () => {
    const { rp } = r;
    const out = await rp.evaluate(() => {
      _seq.steps = seqSanitizeSteps([{ id: 'q1', kind: 'media', ref: { id: 'm2', name: 'plan-2.png', kind: 'img' }, trig: { k: 'go' }, target: null, opt: { end: 'loop', nav: 'scroll', skin: 'social', start: 'pool' } }]);
      const id = saveCurrentSeq('Scène fil');
      loadSavedSeqs();                                   // relecture du stockage (nettoyage compris)
      const stored = seqSaved.find((e) => e.id === id).steps[0].opt;
      _seq.steps = []; loadSavedSeq(id, true);
      return { stored, loaded: _seq.steps[0].opt };
    });
    assert.deepEqual(out.stored, { end: 'loop', nav: 'scroll', skin: 'social', start: 'pool' });
    assert.deepEqual(out.loaded, out.stored);
  });

  test('éditeur d\'étape : Hérité | Fixe | Toucher | Glisser | Défiler, habillage et départ selon le mode', async () => {
    const { rp } = r;
    await run(rp, [media(1)]);
    await rp.evaluate(() => openSeqStep('s1'));
    await waitFor(rp, () => !!document.getElementById('ssNavRow'));
    const labels = () => rp.$$eval('#ssNavRow .ss-opt', (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(await labels(), ['Hérité', 'Fixe', 'Toucher', 'Glisser', 'Défiler']);
    const rowsOf = () => rp.evaluate(() => ['ssSkinRow', 'ssStartRow'].map((i) => !!document.getElementById(i)));
    assert.deepEqual(await rowsOf(), [false, false]);
    await rp.evaluate(() => seqEditNav('swipe'));
    assert.deepEqual(await rowsOf(), [false, true], 'Glisser : départ seulement');
    await rp.evaluate(() => seqEditNav('scroll'));
    assert.deepEqual(await rowsOf(), [true, true], 'Défiler : habillage et départ');
    assert.deepEqual(await rp.$$eval('#ssSkinRow .ss-opt', (els) => els.map((e) => e.textContent.trim())), ['Aucun', 'Fil social']);
    assert.deepEqual(await rp.$$eval('#ssStartRow .ss-opt', (els) => els.map((e) => e.textContent.trim())), ['Ce média', 'Début du pool']);
    await rp.evaluate(() => { seqEditSkin('social'); seqEditStart('pool'); });
    assert.deepEqual(await rp.evaluate(() => { const o = _seqEdit.step.opt; return [o.nav, o.skin, o.start]; }), ['scroll', 'social', 'pool']);
    await rp.evaluate(() => seqEditNav('off'));
    assert.deepEqual(await rowsOf(), [false, false]);
    await rp.evaluate(() => closeSeqStep());
  });

  test('l\'étape impose son mode à son départ, la suivante (non média) rend le réglage de l\'onglet Média', async () => {
    const { rp, sp, broker } = r;
    // Onglet Média : Toucher
    await rp.evaluate(() => { setMediaSkin('none'); setMediaNav('tap'); });
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'tap');
    await run(rp, [
      media(2, { nav: 'scroll', skin: 'social' }),
      media(3, { nav: 'swipe' }),
      step('s5', 'color', 'k1'),                             // étape qui n'est pas un média : l'onglet Média reprend la main
      media(4),                                              // Hérité : réglage de l'onglet Média
    ]);
    await rp.evaluate(() => {
      colorMemories = [{ id: 'k1', name: 'nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
      persistColorMemories();
    });
    await go(r);
    await waitFor(sp, () => _screenNav === 'scroll' && _screenSkin === 'social');
    await waitFor(sp, () => _nav.on && _nav.mode === 'scroll' && _nav.skin === 'social' && _screenActiveId === 'm2');
    assert.deepEqual(await rp.evaluate(() => { const st = scrState(scrList()[0]); return [st.nav, st.skin]; }), ['scroll', 'social'], 'état attendu de l\'écran : celui de la scène');
    await go(r);                                             // étape 2 : Glisser, remplace Défiler
    await waitFor(sp, () => _screenNav === 'swipe' && _nav.mode === 'swipe');
    await go(r);                                             // étape 3 : couleur → Toucher revient
    await waitFor(sp, () => _screenNav === 'tap' && !_nav.on);
    assert.deepEqual(await rp.evaluate(() => [_mediaNav, scrState(scrList()[0]).nav]), ['tap', 'tap']);
    await go(r);                                             // étape 4 : Hérité, rien ne change
    await waitFor(sp, () => _screenActiveId === 'm4');
    assert.equal(await sp.evaluate(() => [_screenNav, _nav.on].join()), 'tap,false');
  });

  test('Recommencer et reprise en main rendent aussi le réglage de l\'onglet Média ; départ « Début du pool »', async () => {
    const { rp, sp, broker } = r;
    await rp.evaluate(() => { seqRestart(); });
    await broker.flush();
    await rp.evaluate(() => { setMediaNav('off'); });
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'off');
    await run(rp, [media(3, { nav: 'swipe', start: 'pool' }), media(4, { nav: 'scroll', start: 'cur' })]);
    await rp.evaluate(() => seqRestart());
    await go(r);
    await waitFor(sp, () => _screenNav === 'swipe' && _nav.on);
    assert.equal(await sp.evaluate(() => _screenActiveId), 'm1', 'départ au début du pool, pas au média de l\'étape');
    await rp.evaluate(() => seqRestart());
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'off' && !_nav.on);
    assert.equal(await rp.evaluate(() => _mediaNav), 'off');
    // Étape suivante « Défiler » puis la télécommande reprend la main
    await go(r);
    await waitFor(sp, () => _screenNav === 'swipe');
    await go(r);
    await waitFor(sp, () => _screenNav === 'scroll');
    await rp.evaluate(() => seqTakeOver());
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'off', null, { timeout: 5000 });
  });

  test('↶ : revient au mode de l\'étape précédente', async () => {
    const { rp, sp, broker } = r;
    await rp.evaluate(() => { seqRestart(); });
    await broker.flush();
    await rp.evaluate(() => { setMediaNav('off'); });
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'off');
    await run(rp, [media(1, { nav: 'swipe' }), media(2, { nav: 'scroll' })]);
    await go(r);
    await waitFor(sp, () => _screenNav === 'swipe');
    await go(r);
    await waitFor(sp, () => _screenNav === 'scroll');
    await rp.evaluate(() => seqBack());
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'swipe', null, { timeout: 5000 });
    await rp.evaluate(() => seqBack());
    await broker.flush();
    await waitFor(sp, () => _screenNav === 'off', null, { timeout: 5000 });
  });
});
