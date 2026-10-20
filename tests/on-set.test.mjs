// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Garde-fous du plateau (revue UX) : le geste du menu de l'écran de jeu ne
// bloque plus les touchers du comédien ; l'appel entrant et l'écran verrouillé
// tiennent en paysage ; Accueil est confirmé ; onglet Tel sans débordement
// horizontal, « Décrocher » réservé à l'appel, liste qui suit le type ;
// « Nouvelle session » en rouge.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';
import { SCENES } from './helpers/scenes.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const LANDSCAPE = { width: 844, height: 390 };
const menuOpen = (page) => page.evaluate(() => document.getElementById('screen-menu').style.display === 'flex');
// Animations d'arrivée (notification, fondu) terminées : positions finales
const settle = (page) => page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} }));

// ── Menu de l'écran de jeu ──
for (const [scene, layer] of [['screen-seq-lock', 'screen-phone'], ['screen-discussion-glass', 'screen-chat'], ['screen-call-glass', 'screen-call']]) {
  test(`menu de l'écran : le quart haut-gauche reste touchable pendant « ${scene} »`, async () => {
    const { page, errors, close } = await openPage(browser, { clock: true });
    await SCENES[scene](page);
    await settle(page);
    assert.equal(await page.evaluate(() => document.getElementById('screen-menu-hotspot')), null, 'plus de calque bloquant');
    const W = 390, H = 844;
    const pts = [];
    for (let x = 20; x < W / 2; x += 40) for (let y = 20; y < H / 2; y += 40) pts.push([x, y]);
    const hits = await page.evaluate(([pts, layer]) => pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return [x, y, !!el && !!el.closest('#' + layer + ',#screen-sbar')];
    }), [pts, layer]);
    const missed = hits.filter((h) => !h[2]);
    assert.deepEqual(missed, [], 'chaque point du quart haut-gauche atteint la scène');
    // Un toucher arrive à la scène et n'ouvre pas le menu
    await page.evaluate((layer) => { window.__taps = 0; document.getElementById(layer).addEventListener('pointerdown', () => { window.__taps++; }); }, layer);
    await page.mouse.move(60, 230);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up(); // double toucher : rien non plus pendant une scène
    assert.equal(await page.evaluate(() => window.__taps), 2);
    assert.equal(await menuOpen(page), false);
    // Appui long hors du coin réservé : pas de menu
    await page.mouse.down();
    await page.clock.runFor(2000);
    await page.mouse.up();
    assert.equal(await menuOpen(page), false);
    // Appui long de 1,5 s tout au bord (coin de 72 px) : menu
    await page.mouse.move(20, 20);
    await page.mouse.down();
    await page.clock.runFor(1000);
    assert.equal(await menuOpen(page), false, 'pas avant 1,5 s');
    await page.clock.runFor(600);
    assert.equal(await menuOpen(page), true);
    await page.mouse.up();
    assert.deepEqual(errors, []);
    await close();
  });
}

test('menu de l\'écran : écran simple — double toucher ou appui long dans le quart haut-gauche, rien ailleurs', async () => {
  const { page, errors, close } = await openPage(browser, { clock: true });
  await page.evaluate(() => screenJoinSession({ channelId: 'A'.repeat(22), key: 'A'.repeat(43) }));
  await page.clock.runFor(300);
  // Toucher simple : rien
  await page.mouse.click(100, 100);
  await page.clock.runFor(400);
  assert.equal(await menuOpen(page), false);
  // Double toucher (double-clic)
  await page.mouse.dblclick(100, 100);
  assert.equal(await menuOpen(page), true);
  assert.match(await page.textContent('.screen-menu-hint'), /appui long dans le coin haut-gauche/);
  await page.evaluate(() => closeScreenMenu());
  // Appui long de 600 ms
  await page.mouse.move(120, 140);
  await page.mouse.down();
  await page.clock.runFor(650);
  assert.equal(await menuOpen(page), true);
  await page.mouse.up();
  await page.evaluate(() => closeScreenMenu());
  // Hors du quart haut-gauche : rien
  await page.mouse.dblclick(300, 600);
  await page.mouse.move(300, 600);
  await page.mouse.down();
  await page.clock.runFor(2000);
  await page.mouse.up();
  assert.equal(await menuOpen(page), false);
  assert.deepEqual(errors, []);
  await close();
});

// ── Paysage ──
const inView = (r) => r && r.top >= 0 && r.left >= 0 && r.bottom <= LANDSCAPE.height && r.right <= LANDSCAPE.width;
const rectsOf = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => {
  const r = e.getBoundingClientRect();
  const c = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, hit: !!c && (c === e || e.contains(c)) };
}), sel);
const VS = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
async function landscapeCall(m, answer) {
  const ctx = await openPage(browser, { clock: true, viewport: LANDSCAPE });
  await ctx.page.evaluate((p) => screenJoinSession(p), VS);
  await ctx.page.evaluate((m) => screenCallStart({ ring: 'silent', ...m }), m);
  await ctx.page.clock.runFor(1200);
  if (answer) { await ctx.page.evaluate(() => screenCallAnswer()); await ctx.page.clock.runFor(1200); }
  await settle(ctx.page);
  return ctx;
}
for (const style of ['glass', 'tonal', 'minimal']) {
  test(`paysage 844 × 390 · appel ${style} : Refuser et Accepter entiers et touchables ; Raccrocher aussi`, async () => {
    let { page, errors, close } = await landscapeCall({ kind: 'call', style, name: 'Maman', label: 'mobile' });
    const act = await rectsOf(page, '#screen-call .sc-no, #screen-call .sc-ok');
    assert.equal(act.length, 2);
    for (const r of act) { assert.ok(inView(r), JSON.stringify(r)); assert.ok(r.hit, 'touchable'); }
    assert.deepEqual(errors, []);
    await close();
    ({ page, errors, close } = await landscapeCall({ kind: 'call', style, name: 'Maman' }, true));
    const hang = await rectsOf(page, '#screen-call .sc-no');
    assert.equal(hang.length, 1);
    assert.ok(inView(hang[0]) && hang[0].hit, JSON.stringify(hang[0]));
    for (const r of await rectsOf(page, '#screen-call .sc-gbtn')) assert.ok(inView(r), 'grille de l\'appel en cours visible');
    assert.deepEqual(errors, []);
    await close();
  });
  test(`paysage 844 × 390 · écran verrouillé ${style} (SMS, notification) : la notification est entière, sous l'heure`, async () => {
    for (const m of [
      { kind: 'sms', style, name: 'Léa', msg: 'Tu es où ??', lock: { time: '', date: '' } },
      { kind: 'notif', style, name: 'Virement', appName: 'Banque', msg: 'Vous avez reçu 2 400,00 €.', present: 'lock', phone: { date: '2025-10-17', time: '14:32' }, received: { mode: 'ago', min: 15 } },
    ]) {
      const { page, errors, close } = await landscapeCall(m);
      const [n] = await rectsOf(page, '#screen-call .sc-notif.in-lock');
      const [t] = await rectsOf(page, '#screen-call .sc-lock-time');
      assert.ok(inView(n) && n.hit, m.kind + ' : ' + JSON.stringify(n));
      assert.ok(t.bottom <= n.top, m.kind + ' : l\'heure ne recouvre pas la notification');
      for (const c of await rectsOf(page, '#screen-call .sc-lock-circle')) assert.ok(c.top >= n.bottom, 'torche et caméra sous la notification');
      assert.deepEqual(errors, []);
      await close();
    }
  });
}
test('paysage 844 × 390 · écran verrouillé de la Séquence : la pile de notifications défile jusqu\'à la dernière', async () => {
  const { page, errors, close } = await openPage(browser, { clock: true, viewport: LANDSCAPE });
  await SCENES['screen-seq-lock'](page);
  await settle(page);
  const st = await page.evaluate(() => {
    const s = document.querySelector('#screen-phone .sp-stack'), cards = s.querySelectorAll('.sp-card');
    s.scrollTop = s.scrollHeight;
    const last = cards[cards.length - 1].getBoundingClientRect(), box = s.getBoundingClientRect();
    return { n: cards.length, scroll: getComputedStyle(s).overflowY, lastIn: last.bottom <= box.bottom + 1 && last.top >= box.top - 1, boxBottom: box.bottom, time: document.querySelector('#screen-phone .sp-time').getBoundingClientRect().bottom, first: box.top };
  });
  assert.equal(st.n, 4);
  assert.equal(st.scroll, 'auto');
  assert.ok(st.lastIn, 'la dernière carte s\'atteint en faisant défiler');
  assert.ok(st.boxBottom <= LANDSCAPE.height && st.time <= st.first);
  assert.deepEqual(errors, []);
  await close();
});
test('paysage 844 × 390 · pavé du code de la Séquence : toutes les touches visibles', async () => {
  const { page, errors, close } = await openPage(browser, { clock: true, viewport: LANDSCAPE });
  await SCENES['screen-seq-code'](page);
  await settle(page);
  const keys = await rectsOf(page, '#screen-phone .sp-key');
  assert.equal(keys.length, 10);
  for (const k of keys) assert.ok(inView(k) && k.hit, JSON.stringify(k));
  assert.deepEqual(errors, []);
  await close();
});

// ── Télécommande ──
test('Accueil : confirmé avant de tout arrêter (en-tête et Réglages) ; Annuler et Échap gardent la télécommande', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => startMode('remote'));
  const shown = () => page.evaluate(() => getComputedStyle(document.getElementById('app-confirm')).display === 'block');
  const where = () => page.evaluate(() => [mode, getComputedStyle(document.getElementById('splash')).display]);
  await page.click('#homeBtn');
  assert.equal(await shown(), true);
  assert.equal(await page.textContent('#acTitle'), 'Revenir à l\'accueil ?');
  assert.equal(await page.textContent('#acText'), 'Les écrans restent appairés ; ce qui est en cours (stroboscope, média, passerelle DMX, séquence) s\'arrête.');
  assert.deepEqual([await page.textContent('#acCancel'), await page.textContent('#acOk')], ['Annuler', 'Revenir à l\'accueil']);
  assert.deepEqual(await where(), ['remote', 'none'], 'rien n\'est arrêté avant la confirmation');
  await page.click('#acCancel');
  assert.equal(await shown(), false);
  assert.deepEqual(await where(), ['remote', 'none']);
  await page.click('#homeBtn');
  await page.keyboard.press('Escape');
  assert.equal(await shown(), false);
  assert.deepEqual(await where(), ['remote', 'none']);
  await page.click('#homeBtn');
  await page.click('#acOk');
  assert.equal(await shown(), false);
  assert.deepEqual(await where(), [null, 'flex']);
  // Réglages › Retour à l'accueil : même confirmation
  await page.evaluate(() => { startMode('remote'); openSettings(); });
  await page.click('#settings-view .st-btn:not(.st-danger)');
  assert.equal(await shown(), true);
  assert.deepEqual(await where(), ['remote', 'none']);
  await page.click('#acOk');
  assert.deepEqual(await where(), [null, 'flex']);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('settings-view')).display), 'none');
  assert.deepEqual(errors, []);
  await close();
});

test('onglet Tel à 390 px : aucun débordement horizontal, quel que soit le type (SMS + écran verrouillé compris)', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  for (const k of ['call', 'sms', 'notif', 'discussion']) {
    for (const lock of [false, true]) {
      const w = await page.evaluate(([k, lock]) => {
        setCallKind(k);
        const t = document.getElementById('lockToggle');
        if (t.checked !== lock) t.click();
        return { doc: document.documentElement.scrollWidth, remote: document.getElementById('remote-mode').scrollWidth };
      }, [k, lock]);
      assert.ok(w.doc <= 390 && w.remote <= 390, `${k}${lock ? ' + verrouillé' : ''} : ${JSON.stringify(w)}`);
    }
  }
  assert.deepEqual(errors, []);
  await close();
});

test('onglet Tel : « Décrocher » pour l\'appel seulement ; la liste enregistrée suit le type', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('call'); });
  const st = (k) => page.evaluate((k) => {
    setCallKind(k);
    return {
      answer: getComputedStyle(document.getElementById('callAnswerBtn')).display,
      list: [...document.querySelectorAll('.cl-kinds .gw-seg-btn.active')].map((b) => b.id),
      empty: document.getElementById('callListEmpty').textContent,
    };
  }, k);
  assert.deepEqual(await st('sms'), { answer: 'none', list: ['clKind-sms'], empty: 'Réglez le SMS ci-dessus puis enregistrez-le : il prend le numéro suivant.' });
  assert.deepEqual(await st('notif'), { answer: 'none', list: ['clKind-notif'], empty: 'Réglez la notification ci-dessus puis enregistrez-la : elle prend le numéro suivant.' });
  assert.deepEqual(await st('call'), { answer: 'flex', list: ['clKind-call'], empty: 'Réglez l\'appel ci-dessus puis enregistrez-le : il prend le numéro suivant.' });
  // L'onglet de liste reste libre : on peut regarder les SMS en réglant un appel
  await page.click('#clKind-sms');
  assert.equal(await page.evaluate(() => callListKind), 'sms');
  assert.deepEqual(errors, []);
  await close();
});

test('« Nouvelle session » s\'affiche en rouge (bouton destructif)', async () => {
  const { page, errors, close } = await openPage(browser);
  await page.evaluate(() => { startMode('remote'); switchTab('qr'); });
  const c = await page.evaluate(() => { const b = document.querySelector('.pair-renew'); const s = getComputedStyle(b); return [s.color, s.borderTopColor]; });
  assert.deepEqual(c, ['rgba(220, 80, 80, 0.8)', 'rgba(220, 80, 80, 0.4)']);
  await page.hover('.pair-renew');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pair-renew')).color), 'rgba(220, 80, 80, 0.8)', 'pas d\'orange au survol');
  assert.deepEqual(errors, []);
  await close();
});
