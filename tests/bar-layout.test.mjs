// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Barres d'action fixes (Tel : Appel, En ligne, SMS, Notification, Discussion ; Séquence : Plateau) :
// aucun libellé ni aucune icône ne déborde de son bouton à 360, 375, 390 et 430 px, et chaque
// cible fait au moins 44 px (cas de l'iPhone 428 px : « Lecture auto » sortait du bouton).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const LONG = 'Maman de la famille Dupont-Marchand-Lefèvre';
// Renvoie les débordements trouvés dans la barre visible (liste vide : tout tient)
const overflows = (page) => page.evaluate(() => {
  const out = [];
  const bar = [...document.querySelectorAll('#tel-bar, #seq-bar')].find((b) => getComputedStyle(b).display !== 'none');
  if (!bar) return ['aucune barre visible'];
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const b of bar.querySelectorAll('button')) {
    if (!vis(b)) continue;
    const name = b.id || b.className || b.textContent.trim();
    const r = b.getBoundingClientRect();
    if (b.scrollWidth > b.clientWidth + 1) out.push(name + ' : scrollWidth ' + b.scrollWidth + ' > ' + b.clientWidth);
    if (r.height < 44 || r.width < 44) out.push(name + ' : cible ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' < 44');
    if (r.right > innerWidth + 1 || r.left < -1) out.push(name + ' : hors de la fenêtre');
    for (const c of b.querySelectorAll('*')) {
      if (!vis(c)) continue;
      const cr = c.getBoundingClientRect();
      if (cr.left < r.left - 1 || cr.right > r.right + 1 || cr.top < r.top - 1 || cr.bottom > r.bottom + 1) out.push(name + ' > ' + c.tagName + ' ' + (c.id || c.textContent.trim()) + ' sort du bouton');
    }
  }
  return out;
});

const STATES = {
  appel: () => { switchTab('call'); setCallKind('call'); telCallPhase('idle'); },
  'appel en ligne': () => { switchTab('call'); setCallKind('call'); telCallPhase('ringing'); telCallPhase('incall'); },
  sms: () => { switchTab('call'); setCallKind('sms'); telCallPhase('idle'); },
  notification: () => { switchTab('call'); setCallKind('notif'); telCallPhase('idle'); },
  'discussion fermée': () => { switchTab('call'); setCallKind('discussion'); _chat.open = false; renderTelBar(); },
  discussion: (long) => {
    switchTab('call'); setCallKind('discussion');
    _chat.name = long; _chat.open = true; _chat.sent = [];
    _chat.msgs[0].text = 'Ton père t\'attend depuis une heure et il n\'est vraiment pas content';
    renderChatPanel(); renderTelBar();
  },
  plateau: () => { switchTab('seq'); setSeqMode('play'); },
};

export const BAR_STATES = STATES;
for (const width of [360, 375, 390, 430]) {
  test('barres d\'action sans débordement à ' + width + ' px', async () => {
    const { page, errors, close } = await openPage(browser, { viewport: { width, height: 800 } });
    await page.evaluate(() => startMode('remote'));
    await waitFor(page, () => typeof renderTelBar === 'function' && !!document.getElementById('tel-bar'));
    for (const [name, fn] of Object.entries(STATES)) {
      await page.evaluate(fn, LONG);
      await page.waitForTimeout(80);
      assert.deepEqual(await overflows(page), [], name + ' à ' + width + ' px');
    }
    // Lecture auto en marche : « Pause » tient aussi
    await page.evaluate(STATES.discussion, LONG);
    await page.evaluate(() => { const b = document.getElementById('dcAutoPlay'); b.innerHTML = icon('pause') + '<b>Pause</b>'; });
    assert.deepEqual(await overflows(page), [], 'Pause à ' + width + ' px');
    assert.equal(await page.getAttribute('#dcAutoPlay', 'aria-label'), 'Lecture automatique');
    assert.deepEqual(errors, []);
    await close();
  });
}
