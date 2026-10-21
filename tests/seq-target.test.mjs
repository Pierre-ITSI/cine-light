// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Cible de la séquence par défaut (91-sequence.js, 96-sequences-saved.js, 72-project.js) :
// seq.target + étapes qui la suivent (target null) ou qui ont leur propre écran ;
// choisir dans une étape le même écran que la séquence = suivre ; changement de la
// cible (snackbar « n étapes suivent… » + Annuler) ; migration des anciennes séquences ;
// séquence enregistrée et projet .rem (aller-retour, cible résolue écrite aussi pour les
// anciennes versions) ; envoi réel aux écrans.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor, sleep, FakeBroker, pairingHash } from './helpers/harness.mjs';
import { unzip, json } from './helpers/zip.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

const connected = (page) => waitFor(page, () => !!mqttClient && mqttClient.connected && !!_sec, null, { timeout: 8000 });

async function rig(n, seed) {
  const broker = new FakeBroker();
  const remote = await openPage(browser, { broker, seed, autoConnect: true });
  const rp = remote.page;
  await rp.evaluate(() => { startMode('remote'); switchTab('seq'); SEQ_GO_GUARD_MS = 0; });
  await connected(rp);
  const hash = await pairingHash(rp);
  const screens = [];
  for (let i = 0; i < n; i++) {
    const s = await openPage(browser, { broker, seed: seed * 10 + i, autoConnect: true, hash });
    await connected(s.page);
    s.id = await s.page.evaluate(() => screenId());
    screens.push(s);
  }
  await waitFor(rp, (k) => _screenOfSender.size === k && scrList().length === k, n);
  await waitFor(rp, () => _resyncTimer === null);
  await sleep(200);
  await broker.flush();
  return { broker, remote, rp, screens, close: async () => { for (const s of screens) await s.close(); await remote.close(); } };
}
const colors = () => { colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }]; persistColorMemories(); };
const st = (id, target, extra) => Object.assign({ id, kind: 'color', ref: 'k1', trig: { k: 'go' }, target, opt: {} }, extra || {});

describe('cible de la séquence par défaut', () => {
  let r, rp, A, B, C;
  before(async () => {
    r = await rig(3, 71);
    rp = r.rp; [A, B, C] = r.screens.map((s) => s.id);
    await rp.evaluate(colors);
    await rp.evaluate(([a, b, c]) => { scrRenameScreen(a, 'Salon'); scrRenameScreen(b, 'Cuisine'); scrRenameScreen(c, 'Régie'); }, [A, B, C]);
  });
  after(async () => { for (const p of [r.remote, ...r.screens]) assert.deepEqual(p.errors, []); await r?.close(); });
  const load = (steps, target) => rp.evaluate(([steps, target]) => {
    _seq = _seqEmpty(); _seq.steps = seqSanitizeSteps(steps); _seq.target = target; seqSave(); renderSeq();
  }, [steps, target]);

  test('modèle : seqStepTarget = cible de l\'étape, sinon celle de la séquence ; null relu comme « suit »', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: B };
    await load([st('a1', null), st('a2', O)], T);
    const got = await rp.evaluate(() => [_seq.steps[0].target, _seq.steps[1].target, seqStepTarget(_seq.steps[0]), seqStepTarget(_seq.steps[1]), seqStepIds(_seq.steps[0]), seqStepIds(_seq.steps[1])]);
    assert.deepEqual(got, [null, O, T, O, [A], [B]]);
    // Cible de la séquence disparue : aucune cible visée (comme une cible d'étape disparue)
    assert.deepEqual(await rp.evaluate(() => { _seq.target = { k: 'screen', id: 'ZzzGhostScreen000' }; return [seqStepIds(_seq.steps[0]), seqTargetName(seqStepTarget(_seq.steps[0]))]; }), [[], 'aucun écran']);
  });

  test('éditeur question 4 : « Cible de la séquence » par défaut, « Autre écran… », « Cet écran seulement » + lien Revenir', async () => {
    const T = { k: 'screen', id: A };
    await load([st('a1', null)], T);
    await rp.evaluate(() => openSeqStep('a1'));
    assert.equal(await rp.getAttribute('#ssTargetFollow', 'aria-checked'), 'true');
    assert.match(await rp.textContent('#ssTargetFollow'), /^Cible de la séquenceSalon$|^Cible de la séquence/);
    assert.equal((await rp.textContent('#ssTargetBtn')).trim(), 'Autre écran…');
    assert.equal(await rp.$('#ssTargetBack'), null);
    await rp.click('#ssTargetBtn');
    assert.equal(await rp.textContent('#srSheetTitle'), 'Sur quel écran ?');
    // Écran différent : cible propre
    await rp.locator('#ssTargets .dc-menu-btn', { hasText: await rp.evaluate((id) => scrName(id), B) }).click();
    assert.equal(await rp.evaluate(() => _seqEdit.step.target.id), B);
    assert.match(await rp.textContent('#ssTargetBtn'), /^Cet écran seulement/);
    assert.equal(await rp.getAttribute('#ssTargetBtn', 'aria-checked'), 'true');
    assert.match(await rp.textContent('#ssSummary'), /l'écran « /);
    // Même écran que la séquence : l'étape SUIT (null), pas un réglage à part
    await rp.click('#ssTargetBtn');
    await rp.locator('#ssTargets .dc-menu-btn', { hasText: await rp.evaluate((id) => scrName(id), A) }).click();
    assert.equal(await rp.evaluate(() => _seqEdit.step.target), null);
    assert.equal(await rp.getAttribute('#ssTargetFollow', 'aria-checked'), 'true');
    // Lien « Revenir à la cible de la séquence »
    await rp.evaluate((id) => seqEditTarget('screen', id), B);
    assert.equal(await rp.evaluate(() => _seqEdit.step.target.id), B);
    await rp.click('#ssTargetBack');
    assert.equal(await rp.evaluate(() => _seqEdit.step.target), null);
    // Enregistrer avec une cible propre, puis la retrouver
    await rp.evaluate((id) => seqEditTarget('screen', id), B);
    await rp.click('#ssSave');
    assert.deepEqual(await rp.evaluate(() => _seq.steps[0].target), { k: 'screen', id: B });
    assert.equal(await rp.locator('#seqRows .sq-tgt').count(), 1, 'pastille de la cible propre');
    assert.match(await rp.textContent('#seqRows .sq-tgt'), /\S/);
  });

  test('nouvelle étape : suit la cible de la séquence ; pas de pastille sur une étape qui la suit', async () => {
    await load([st('a1', null)], { k: 'screen', id: A });
    await rp.evaluate(() => { openSeqStep(null); });
    assert.equal(await rp.evaluate(() => _seqEdit.step.target), null);
    await rp.evaluate(() => closeSeqStep());
    assert.equal(await rp.locator('#seqRows .sq-tgt').count(), 0);
    assert.equal(await rp.textContent('#seqTgtVal'), await rp.evaluate((id) => scrName(id), A));
  });

  test('changer la cible : seules les étapes qui la suivent changent, bandeau « n étapes suivent… · Annuler », annulation', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: C };
    await load([st('a1', null), st('a2', null), st('a3', O), st('a4', null)], T);
    await rp.click('#seqTgtRow');
    assert.equal(await rp.textContent('#srSheetTitle'), 'Cible de la séquence');
    assert.match(await rp.textContent('#ssTargetNote'), /^Les étapes qui suivent la cible changent avec elle/);
    await rp.locator('#ssTargets .dc-menu-btn', { hasText: await rp.evaluate((id) => scrName(id), B) }).click();
    assert.deepEqual(await rp.evaluate(() => [_seq.target, _seq.steps.map((s) => s.target)]), [{ k: 'screen', id: B }, [null, null, O, null]]);
    assert.equal(await rp.textContent('#usText'), '3 étapes suivent la cible de la séquence');
    assert.deepEqual(await rp.evaluate(() => _seq.steps.map((s) => seqStepIds(s))), [[B], [B], [C], [B]]);
    assert.match(await rp.textContent('#seqTarget'), /^Cible : /);
    assert.deepEqual(await rp.evaluate(() => JSON.parse(localStorage.getItem(SEQ_LS_KEY)).target), { k: 'screen', id: B });
    await rp.click('#usUndo');
    assert.deepEqual(await rp.evaluate(() => _seq.target), T);
    assert.deepEqual(await rp.evaluate(() => _seq.steps.map((s) => seqStepIds(s))), [[A], [A], [C], [A]]);
    // Une seule étape qui suit : singulier
    await load([st('a1', null), st('a2', O)], T);
    await rp.evaluate((b) => seqSetDefaultTarget('screen', b), B);
    assert.equal(await rp.textContent('#usText'), '1 étape suit la cible de la séquence');
    await rp.evaluate(() => undoSnackUndo());
  });

  test('envoi réel : une étape qui suit la cible vise le nouvel écran, une étape à part garde le sien', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: C };
    await load([st('a1', null), st('a2', O, { trig: { k: 'go' } })], T);
    await rp.evaluate((b) => { seqSetDefaultTarget('screen', b); }, B);
    await rp.evaluate(() => { _usFlush(); setSeqMode('play'); SEQ_GO_GUARD_MS = 0; });
    await r.broker.flush();
    const before = (await r.broker.sent(rp)).length;
    await rp.evaluate(() => seqGo());
    await waitFor(rp, () => seqPos() === 0);
    await rp.evaluate(() => seqGo());
    await waitFor(rp, () => seqPos() === 1);
    await sleep(300);
    const sent = (await r.broker.sent(rp)).slice(before).filter((m) => m.type === 'color' && m.color !== '#000000'); // (le premier GO coupe tout : couleur noire)
    assert.deepEqual(sent.map((m) => m.target.screens), [[B], [C]]);
  });

  test('migration : la cible la plus fréquente devient le défaut ; égalité : première étape du téléphone ; vide : commandes', async () => {
    const R = (steps) => rp.evaluate((steps) => { const s = seqSanitizeSteps(steps); const t = seqResolveTarget(undefined, s); return [t, s.map((x) => x.target)]; }, steps);
    const a = { k: 'screen', id: A }, b = { k: 'screen', id: B };
    assert.deepEqual(await R([st('x1', a), st('x2', b), st('x3', b)]), [b, [a, null, null]]);
    // Égalité : la cible de la première étape du téléphone l'emporte (comportement d'avant)
    assert.deepEqual(await R([st('x1', a), { id: 'x2', kind: 'sleep', trig: { k: 'go' }, target: b, opt: {} }, { id: 'x3', kind: 'sleep', trig: { k: 'go' }, target: a, opt: {} }, st('x4', b)]), [b, [a, null, a, null]]);
    // Vide : cible des commandes
    await rp.evaluate(() => scrSetTarget({ k: 'all' }));
    assert.deepEqual(await R([]), [{ k: 'all' }, []]);
    // Idempotent : une cible déjà stockée ne migre plus rien
    assert.deepEqual(await rp.evaluate(([a, b]) => { const s = seqSanitizeSteps([{ id: 'y1', kind: 'color', ref: 'k1', target: b, trig: { k: 'go' } }]); return [seqResolveTarget(a, s), s[0].target]; }, [a, b]), [a, b]);
    // Ancien stockage (sans seq.target, étapes avec cible) relu par seqLoad
    await rp.evaluate(([a]) => {
      localStorage.setItem(SEQ_LS_KEY, JSON.stringify({ v: 1, name: 'ancienne', savedId: null, steps: [
        { id: 'o1', kind: 'color', ref: 'k1', target: a, trig: { k: 'go' }, opt: {} }, { id: 'o2', kind: 'color', ref: 'k1', target: a, trig: { k: 'go' }, opt: {} }, { id: 'o3', kind: 'color', ref: 'k1', target: { k: 'all' }, trig: { k: 'go' }, opt: {} }] }));
      seqLoad();
    }, [a]);
    assert.deepEqual(await rp.evaluate(() => [_seq.target, _seq.steps.map((s) => s.target)]), [a, [null, null, { k: 'all' }]]);
  });

  test('écriture : étapes qui suivent la cible avec la cible résolue (follow) pour les anciennes versions ; relues comme « suit »', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: C };
    await load([st('a1', null), st('a2', O)], T);
    const raw = await rp.evaluate(() => JSON.parse(localStorage.getItem(SEQ_LS_KEY)));
    assert.deepEqual(raw.target, T);
    assert.deepEqual(raw.steps.map((s) => [s.target, s.follow]), [[T, true], [O, undefined]]);
    await rp.evaluate(() => seqLoad());
    assert.deepEqual(await rp.evaluate(() => [_seq.target, _seq.steps.map((s) => s.target)]), [T, [null, O]]);
    // Ancienne version (qui ne connaît que step.target) : chaque étape a une cible lisible
    assert.deepEqual(raw.steps.map((s) => s.target), [T, O]);
  });

  test('séquence enregistrée : cible enregistrée, chargée, dupliquée, modifications détectées ; liste', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: C };
    await rp.evaluate(() => { seqSaved = []; _sqsvPersist(); });
    await load([st('a1', null), st('a2', O)], T);
    const id = await rp.evaluate(() => saveCurrentSeq('Cible'));
    const stored = await rp.evaluate(() => JSON.parse(localStorage.getItem(SEQ_SAVED_KEY)).list[0]);
    assert.deepEqual(stored.target, T);
    assert.deepEqual(stored.steps.map((s) => [s.target, s.follow]), [[T, true], [O, undefined]]);
    assert.equal(await rp.evaluate(() => seqHasUnsavedChanges()), false);
    await rp.evaluate((b) => { seqSetDefaultTarget('screen', b); }, B);
    assert.equal(await rp.evaluate(() => seqHasUnsavedChanges()), true, 'changer la cible de la séquence est une modification');
    await rp.evaluate(() => { _usFlush(); loadSavedSeq(_seq.savedId, true); });
    assert.deepEqual(await rp.evaluate(() => [_seq.target, _seq.steps.map((s) => s.target)]), [T, [null, O]]);
    const dup = await rp.evaluate((id) => { duplicateSavedSeq(id); return seqSaved.map((e) => [e.name, e.target, e.steps.map((s) => s.target)]); }, id);
    assert.deepEqual(dup.map((d) => d[1]), [T, T]);
    assert.deepEqual(dup[1][2], [null, O]);
    await rp.evaluate(() => setSeqView('saved'));
    assert.match(await rp.textContent('#seqSavedRows'), /Cible : Salon|Salon/);
    await rp.evaluate(() => setSeqView('cur'));
    // Ancienne séquence enregistrée (sans cible) : migrée à la lecture
    await rp.evaluate(([a]) => {
      localStorage.setItem(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: [{ id: 'old1', name: 'Avant', steps: [{ id: 'z1', kind: 'color', ref: 'k1', target: a, trig: { k: 'go' }, opt: {} }, { id: 'z2', kind: 'color', ref: 'k1', target: a, trig: { k: 'go' }, opt: {} }] }] }));
      loadSavedSeqs();
    }, [T]);
    assert.deepEqual(await rp.evaluate(() => [seqSaved[0].target, seqSaved[0].steps.map((s) => s.target)]), [T, [null, null]]);
  });

  test('projet .rem : export avec la cible résolue (follow), import (ajouter et remplacer), ancien projet migré', async () => {
    const T = { k: 'screen', id: A }, O = { k: 'screen', id: C };
    await rp.evaluate(() => { seqSaved = []; _sqsvPersist(); });
    await load([st('a1', null), st('a2', O)], T);
    await rp.evaluate(() => saveCurrentSeq('Pour projet'));
    const bytes = await rp.evaluate(async () => { const f = await projectExport({ name: 'T' }); return _prjBytesToB64(new Uint8Array(await f.arrayBuffer())); });
    const z = unzip(Buffer.from(bytes, 'base64'));
    const seq = json(z, 'data/seq.json').list[0];
    assert.deepEqual(seq.target, T);
    assert.deepEqual(seq.steps.map((s) => [s.target, s.follow]), [[T, true], [O, undefined]], 'cible résolue aussi écrite pour les anciennes versions');
    const work = json(z, 'data/work.json').seq;
    assert.deepEqual(work.target, T);
    assert.deepEqual(work.steps.map((s) => [s.target, s.follow]), [[T, true], [O, undefined]]);
    // Import (remplacer) : la cible et les étapes qui suivent sont retrouvées
    await rp.evaluate((b64) => { window.__f = new File([_prjB64ToBytes(b64)], 'p.rem', { type: 'application/zip' }); }, bytes);
    await rp.evaluate(() => { seqSaved = []; _sqsvPersist(); _seq = _seqEmpty(); seqSave(); });
    const res = await rp.evaluate(() => projectImport(window.__f, { mode: 'replace', sections: ['seq', 'work'] }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(await rp.evaluate(() => [seqSaved[0].target, seqSaved[0].steps.map((s) => s.target), _seq.target, _seq.steps.map((s) => s.target)]), [T, [null, O], T, [null, O]]);
    const store = await rp.evaluate(() => JSON.parse(localStorage.getItem(SEQ_SAVED_KEY)).list[0].steps.map((s) => [s.target, s.follow]));
    assert.deepEqual(store, [[T, true], [O, undefined]]);
  });
});
