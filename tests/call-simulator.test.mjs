// Simulateur d'appel côté écran : 3 types × 3 styles × (plein écran / bandeau,
// verrouillé / bannière), décrocher / raccrocher, et sécurité des champs reçus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, connectFakeClients } from './helpers/harness.mjs';

let browser, ctx;
before(async () => {
  browser = await launchBrowser();
  ctx = await openPage(browser);
  await ctx.page.evaluate(() => enterScreenMode('calls'));
});
after(async () => { await ctx?.close(); await browser?.close(); });

const KINDS = ['call', 'sms', 'chat'];
const STYLES = ['glass', 'tonal', 'minimal'];
const overlay = (page) => page.evaluate(() => {
  const el = document.getElementById('screen-call');
  return { display: el.style.display, notif: el.classList.contains('notif'), html: el.innerHTML, state: _callState };
});
async function reset(page) {
  await page.evaluate(() => screenCallHide());
  await waitFor(page, () => document.getElementById('screen-call').style.display === 'none' || _callState === 'idle');
  await sleep(450); // laisse finir l'animation de sortie éventuelle
}

for (const kind of KINDS) {
  for (const style of STYLES) {
    const variants = kind === 'call' ? ['full', 'banner'] : ['banner', 'lock'];
    for (const variant of variants) {
      test(`${kind} · ${style} · ${variant}`, async () => {
        const { page } = ctx;
        await reset(page);
        const m = {
          type: 'call:start', kind, style, name: 'Maman', label: 'mobile', msg: 'Tu es où ??',
          appName: 'Chatly', appColor: '#7a5af8', ring: 'silent', present: variant === 'banner' ? 'banner' : 'full',
          lock: variant === 'lock' ? { time: '', date: '' } : null,
        };
        await page.evaluate((m) => screenCallStart(m), m);
        const o = await overlay(page);
        assert.equal(o.display, 'block');
        if (kind === 'call') {
          assert.equal(o.state, 'ringing');
          if (variant === 'full') { assert.ok(!o.notif); assert.match(o.html, new RegExp(`class="sc-call ${style}"`)); }
          else { assert.ok(o.notif); assert.match(o.html, new RegExp(`class="sc-callbar ${style}"`)); }
          assert.match(o.html, /Maman/);
          // Décrocher par un vrai clic sur le bouton vert
          await page.locator('#screen-call .sc-ok').first().click();
          const inc = await overlay(page);
          assert.equal(inc.state, 'incall');
          assert.ok(!inc.notif, "l'appel décroché passe en plein écran");
          assert.match(inc.html, /id="scCallTimer"/);
          await page.waitForTimeout(1100);
          assert.match(await page.textContent('#scCallTimer'), /^00:0[1-2]$/);
          // Raccrocher (bouton rouge)
          await page.locator('#screen-call .sc-no').first().click();
          const end = await overlay(page);
          assert.equal(end.state, 'idle');
          assert.equal(end.display, 'none', 'plein écran : fermeture immédiate');
        } else {
          assert.equal(o.state, 'notif');
          if (variant === 'lock') {
            assert.ok(!o.notif);
            assert.match(o.html, new RegExp(`class="sc-lock ${style}"`));
            assert.match(o.html, /sc-notif [a-z]+ in-lock/);
            // Heure/date vides → celles de l'écran
            const now = await page.evaluate(() => { const d = new Date(); return [d.getHours(), d.getMinutes()].map((v) => String(v).padStart(2, '0')); });
            assert.ok(o.html.includes(`sc-lock-time">${now[0]}${style === 'tonal' ? '<br>' : ':'}${now[1]}<`)
              || /sc-lock-time">\d\d(:|<br>)\d\d</.test(o.html), 'horloge écran');
            assert.match(o.html, /sc-lock-date">[A-Z][a-z]{2}\. \d{1,2} [a-zéû.]+</);
          } else {
            assert.ok(o.notif);
            assert.match(o.html, new RegExp(`class="sc-notif ${style}"`));
          }
          assert.match(o.html, /Tu es où \?\?/);
          // Toucher la notification la ferme (sortie animée)
          await page.evaluate(() => screenCallEnd());
          assert.equal((await overlay(page)).state, 'idle');
          await waitFor(page, () => document.getElementById('screen-call').style.display === 'none');
          assert.equal((await overlay(page)).html, '');
        }
      });
    }
  }
}

test('refuser un appel en bandeau', async () => {
  const { page } = ctx;
  await reset(page);
  await page.evaluate(() => screenCallStart({ kind: 'call', style: 'minimal', present: 'banner', name: 'X', ring: 'silent' }));
  await page.locator('#screen-call .sc-no').click();
  const o = await overlay(page);
  assert.equal(o.state, 'idle');
  await waitFor(page, () => document.getElementById('screen-call').style.display === 'none');
});

test('sécurité : photo / nom / couleur forgés ne s’exécutent pas', async () => {
  const { page } = ctx;
  await reset(page);
  const forged = 'x)"><img src=x onerror=window.__p=1>';
  const cases = [
    { kind: 'call', style: 'glass', photo: forged, photoMode: 'full', name: '<img src=x onerror=window.__p=2>' },
    { kind: 'call', style: 'tonal', photo: forged, present: 'banner', name: 'A' },
    { kind: 'sms', style: 'tonal', photo: forged, name: 'B', appColor: 'red;background:url(x)', appName: '<b onmouseover=window.__p=3>' },
    { kind: 'chat', style: 'minimal', photo: 'javascript:window.__p=4', lock: { time: '<img src=x onerror=window.__p=5>', date: '' } },
    { kind: 'call', style: 'glass', photo: 'data:image/png;base64,AAAA") ; x:url("https://evil', ring: '__proto__' },
  ];
  for (const c of cases) {
    await page.evaluate((m) => screenCallStart({ ring: 'silent', ...m }), c);
    await sleep(150);
    const r = await page.evaluate(() => ({
      p: window.__p, imgs: document.querySelectorAll('#screen-call img').length,
      bold: document.querySelectorAll('#screen-call b').length,
      bg: [...document.querySelectorAll('#screen-call [style]')].map((e) => e.getAttribute('style')).join(' | '),
      cfg: _callCfg,
    }));
    assert.equal(r.p, undefined, 'aucun script injecté : ' + JSON.stringify(c));
    assert.equal(r.imgs, 0);
    assert.equal(r.bold, 0);
    assert.equal(r.cfg.photo, null, 'photo non conforme rejetée');
    assert.doesNotMatch(r.bg, /url\(/);
    await page.evaluate(() => screenCallHide());
  }
  // Même charge utile reçue par le réseau (chemin MQTT complet)
  await connectFakeClients(page);
  await page.evaluate((forged) => {
    mqttClient._deliver(mqttTopic(channel), { type: 'call:start', kind: 'call', style: 'glass', name: 'Z', photo: forged, photoMode: 'full', ring: 'silent' });
  }, forged);
  await waitFor(page, () => _callState === 'ringing');
  await sleep(150);
  assert.equal(await page.evaluate(() => window.__p), undefined);
  assert.equal(await page.evaluate(() => document.querySelectorAll('#screen-call img').length), 0);
  // Une vraie data-URL image est acceptée
  const okPhoto = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 4; return c.toDataURL('image/png'); });
  await page.evaluate((p) => screenCallStart({ kind: 'call', style: 'glass', name: 'Ok', photo: p, ring: 'silent' }), okPhoto);
  assert.equal(await page.evaluate(() => _callCfg.photo !== null), true);
  assert.match(await page.evaluate(() => document.getElementById('screen-call').innerHTML), /background-image:url\(data:image\/png;base64,/);
  await page.evaluate(() => screenCallHide());
  assert.deepEqual(ctx.errors, []);
});
