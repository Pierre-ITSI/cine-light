// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Projets .rem (web/js/72-project.js, docs/PROJECTS.md) : export → import
// entre deux pages vierges (remplacer, ajouter), renumérotation des ids et
// références des séquences, secrets absents, plafonds, fichiers abîmés,
// version inconnue, contenu hostile, aperçu sans licence, médias inclus ou non,
// pont natif par morceaux, projets locaux (créer, ouvrir, dupliquer, supprimer,
// migration, quota), nouvelle séquence / nouvelle discussion.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage, waitFor } from './helpers/harness.mjs';
import { licenceInit } from './helpers/licence.mjs';
import { unzip, zip, json, manifest } from './helpers/zip.mjs';

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function remote(opts = {}) {
  const p = await openPage(browser, opts);
  await p.page.evaluate(() => startMode('remote'));
  return p;
}

// ── Données de départ (page) : tout ce qu'un projet contient, photos et sons compris ──
async function seed(page) {
  const v = await page.evaluate(async () => {
    const png = (c) => { const k = document.createElement('canvas'); k.width = 8; k.height = 8; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8); return k.toDataURL('image/png'); };
    const wav = (n) => {
      const len = 44 + n, b = new Uint8Array(len), dv = new DataView(b.buffer);
      const s = (o, t) => [...t].forEach((ch, i) => { b[o + i] = ch.charCodeAt(0); });
      s(0, 'RIFF'); dv.setUint32(4, len - 8, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, 8000, true); dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); s(36, 'data'); dv.setUint32(40, n, true);
      for (let i = 44; i < len; i++) b[i] = 128 + (i % 7);
      return 'data:audio/wav;base64,' + _prjBytesToB64(b);
    };
    const P1 = png('#c0392b'), P2 = png('#2980b9'), P3 = png('#27ae60'), HOME = png('#8e44ad'), WALL = png('#f39c12'), POOL = png('#16a085');
    const A1 = wav(400), R1 = wav(800);
    const rid = await _ringHashId(R1);
    await _ringLibPut({ id: rid, name: 'Ma sonnerie', mime: 'audio/wav', size: 844, dur: 0.1, at: 1 }, R1);
    const fx = Object.keys(EFFECT_CONFIG)[0];
    localStorage.setItem(RING_SETTINGS_KEY, JSON.stringify({ v: 1, call: { sound: rid, vol: 0.7, vib: true }, sms: { sound: 'digital', vol: 1, vib: false }, notif: { sound: 'soft', vol: 0.5, vib: false }, discussion: { sound: 'silent', vol: 1, vib: false } }));
    localStorage.setItem(CALL_LIST_KEY, JSON.stringify({ v: 1,
      call: [{ id: 'eA1', kind: 'call', style: 'tonal', name: 'Maman', label: 'mobile', ring: 'classic', ringId: rid, ringVolume: 0.8, vib: true, present: 'full', photoMode: 'full', autoAnswer: 0, lock: null, hasPhoto: true, hasAudio: true, title: 'Maman — scène 12' }],
      sms: [{ id: 'eS1', kind: 'sms', style: 'glass', name: 'Léa', label: '', msg: 'Tu viens ?', appName: 'Messages', appColor: '#34c759', ring: 'digital', ringVolume: 1, autoAnswer: 0, lock: { time: '14:32', date: 'lundi 3 mars' }, hasPhoto: false, hasAudio: false }],
      notif: [{ id: 'eN1', kind: 'notif', style: 'glass', name: 'Alerte', label: '', msg: 'Nouveau message', appName: 'Insta', ring: 'soft', ringVolume: 0.5, present: 'lock', phone: { date: '2026-07-17', time: '14:32' }, received: { mode: 'ago', min: 5 }, hasPhoto: true, hasAudio: false }],
      sms2: 'ignoré' }));
    await callAssetPut('eA1:photo', P1); await callAssetPut('eA1:audio', A1); await callAssetPut('eN1:photo', P2);
    localStorage.setItem(CALLERS_KEY, JSON.stringify({ v: 1, list: [{ id: 'pC1', name: 'Maman', label: 'mobile', hasPhoto: true, photoSig: _chsvPhotoSig(P1) }, { id: 'pC2', name: 'Agence', label: '', hasPhoto: false }] }));
    await callAssetPut('caller-pC1:photo', P1);
    localStorage.setItem(CHAT_SAVED_KEY, JSON.stringify({ v: 2, list: [{ id: 'cD1', name: 'Séq. 12 — Maman', contact: 'Maman', actor: 'Julie', style: 'glass',
      msgs: [{ id: 'm1', from: 'contact', text: 'Tu es où ?', pause: 2, write: 3, auto: false, send: 'auto' }, { id: 'm2', from: 'actor', text: 'J\'arrive', pause: 0, write: 4, auto: true, send: 'button' }],
      hasPhoto: true, photoSig: _chsvPhotoSig(P3) }] }));
    await callAssetPut('chat-cD1:photo', P3);
    localStorage.setItem('setremote-color-memories', JSON.stringify([{ id: 'col1', name: 'Chaud', spec: { kelvin: 3200, tint: 5, dimmer: 80, wheelHex: '#ff8800', crossfade: 10 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }]));
    localStorage.setItem('setremote-fx-memories', JSON.stringify([{ id: 'fx1', name: 'Mon effet', effect: fx, dir: 'h', params: { speed: 1.5, intensity: 80, blocks: [{ hex: '#ff0000' }] } }]));
    const sigH = seqImageSig(HOME), sigW = seqImageSig(WALL);
    await callAssetPut(seqHomeKey(sigH), HOME); await callAssetPut(seqHomeKey(sigW), WALL);
    const st = (id, kind, ref, opt = {}) => ({ id, kind, ref, target: { k: 'all' }, trig: { k: 'go' }, opt });
    const steps = [st('s1', 'color', 'col1'), st('s2', 'effect', 'fx1'), st('s3', 'call', 'eA1'), st('s4', 'sms', 'eS1'), st('s5', 'notif', 'eN1'),
      st('s6', 'chat', 'cD1', { auto: true, full: true }), st('s7', 'unlock', null, { code: 4, then: 'home', img: sigH, imgName: 'accueil.png' }),
      st('s8', 'media', { id: 'm1', name: 'plage.png', kind: 'img' }, { end: 'pause' }), st('s9', 'missed', 'eA1')];
    const phone = { clock: { mode: 'frozen', date: '2026-07-17', time: '14:32' }, net: { bars: 2, type: '4G', plane: false, wifi: false }, bat: { level: 12, charging: false, pct: true } };
    localStorage.setItem(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: [{ id: 'qS1', name: 'Scène 12', steps, phone, wall: { img: sigW, name: 'plage.jpg' } }] }));
    localStorage.setItem(SEQ_LS_KEY, JSON.stringify({ v: 1, name: 'Scène 12', steps: steps.slice(0, 3), savedId: 'qS1', phone, wall: { img: sigW, name: 'plage.jpg' } }));
    localStorage.setItem(CHAT_LS_KEY, JSON.stringify({ v: 2, name: 'Thomas', actor: 'Julie', style: 'tonal', typing: false, msgs: [{ id: 'k1', from: 'contact', text: 'Salut', pause: 1, write: 2, auto: false, send: 'button' }], sent: [], open: false, screens: null, resumeAt: null, savedId: null, pend: [] }));
    localStorage.setItem(CHAT_AVATAR_KEY, P2);
    _licReloadTel(); await ringLibLoad(); seqLoad(); loadSavedSeqs(); renderSeq();
    loadColorMemories(); renderColorMemories(); loadFxMemories(); renderFxMemories();
    onAddImages([new File([_prjB64ToBytes(POOL.split(',')[1])], 'plage.png', { type: 'image/png' })]);
    return { rid, sigH, sigW };
  });
  return v;
}
// État comparable d'une page (mémoire des modules + photos, sons, images)
const state = (page) => page.evaluate(async () => {
  const a = async (k) => { _clAssetMem.delete(k); return callAssetGet(k); };
  const assets = {};
  for (const k of CALL_LISTS) for (const e of callList[k]) { if (e.hasPhoto) assets[e.id + ':photo'] = await a(e.id + ':photo'); if (e.hasAudio) assets[e.id + ':audio'] = await a(e.id + ':audio'); }
  for (const e of chatSaved) if (e.hasPhoto) assets['chat-' + e.id] = await a('chat-' + e.id + ':photo');
  for (const e of callers) if (e.hasPhoto) assets['caller-' + e.id] = await a('caller-' + e.id + ':photo');
  const imgs = new Set();
  for (const e of seqSaved.concat([_seq])) { for (const s of e.steps) if (s.kind === 'unlock' && s.opt.img) imgs.add(s.opt.img); if (e.wall) imgs.add(e.wall.img); }
  for (const s of imgs) assets['seq-' + s] = await a(seqHomeKey(s));
  const rings = {};
  for (const t of ringLib) rings[t.id] = await ringLibData(t.id);
  return {
    callList: JSON.parse(JSON.stringify(callList)), chatSaved, callers, ringLib, rings, ringSettings: JSON.parse(JSON.stringify(ringSettings)),
    colorMemories, fxMemories, seqSaved,
    seq: { name: _seq.name, steps: _seq.steps, savedId: _seq.savedId, phone: _seq.phone, wall: _seq.wall },
    chat: { name: _chat.name, actor: _chat.actor, style: _chat.style, msgs: _chat.msgs, savedId: _chat.savedId }, avatar: _chatAvatar,
    assets, pool: _mediaPool.map((m) => ({ kind: m.kind, name: m.name, size: m.file.size, type: m.file.type })),
    missing: seqSaved.flatMap((e) => e.steps.filter((s) => !seqRefItem(s)).map((s) => e.name + ':' + s.id)),
  };
});
const exportB64 = (page, opts) => page.evaluate(async (o) => _prjBytesToB64(new Uint8Array(await (await projectExport(o)).arrayBuffer())), opts);
const setFile = (page, buf, name = 'projet.rem') => page.evaluate(({ b64, name }) => { window.__f = new File([_prjB64ToBytes(b64)], name, { type: 'application/zip' }); }, { b64: Buffer.from(buf).toString('base64'), name });
const ALL = ['seq', 'chat', 'calls', 'callers', 'rings', 'memories', 'media', 'work'];

test('export : ZIP lisible, manifeste, une entrée par section, fichiers dédupliqués par SHA-256, médias seulement sur demande', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  const z = unzip(Buffer.from(await exportB64(page, { name: 'Tournage « Nuit »' }), 'base64'));
  const man = json(z, 'project.json');
  assert.equal(man.format, 'setremote-project');
  assert.equal(man.version, 1);
  assert.equal(man.name, 'Tournage « Nuit »');
  assert.deepEqual(man.sections, ['seq', 'chat', 'calls', 'callers', 'rings', 'memories', 'work']);
  assert.deepEqual(man.counts, { seq: 1, chat: 1, calls: 3, callers: 2, rings: 1, memories: 2, work: 2 });
  assert.deepEqual(man.calls, { call: 1, sms: 1, notif: 1 });
  assert.match(man.created, /^\d{4}-\d\d-\d\dT/);
  for (const s of man.sections) assert.ok(z.has('data/' + s + '.json'), s);
  assert.ok(!z.has('data/media.json'), 'médias exclus par défaut');
  const files = [...z.keys()].filter((n) => n.startsWith('files/'));
  assert.ok(files.every((n) => /^files\/[0-9a-f]{64}\.(png|wav)$/.test(n)), files.join());
  // P1 sert à l'appel et à l'appelant, P2 à la notification et à l'avatar : un seul fichier chacun
  assert.equal(files.length, 7, files.join()); // P1, P2, P3, HOME, WALL, A1, R1
  assert.equal(man.files, 7);
  const calls = json(z, 'data/calls.json');
  assert.equal(calls.call[0].photo.t, 'image/png');
  assert.equal(json(z, 'data/callers.json').list[0].photo.f, calls.call[0].photo.f);
  assert.equal(calls.call[0].hasPhoto, undefined);
  const crypto = await import('node:crypto');
  for (const f of files) assert.equal(f.slice(6, 70), crypto.createHash('sha256').update(z.get(f).data).digest('hex'));
  // JSON compressés, fichiers binaires stockés tels quels quand deflate n'y gagne rien
  assert.equal(z.get('data/seq.json').method, 8);
  // Avec les médias
  const zm = unzip(Buffer.from(await exportB64(page, { name: 'Avec', includeMedia: true }), 'base64'));
  assert.deepEqual(json(zm, 'project.json').sections, ['seq', 'chat', 'calls', 'callers', 'rings', 'memories', 'media', 'work']);
  assert.deepEqual(json(zm, 'data/media.json').list.map((m) => [m.id, m.kind, m.name, m.file.t]), [['m1', 'img', 'plage.png', 'image/png']]);
  // Sections choisies
  const zs = unzip(Buffer.from(await exportB64(page, { sections: ['calls'], work: false }), 'base64'));
  assert.deepEqual(json(zs, 'project.json').sections, ['calls']);
  assert.deepEqual([...zs.keys()].filter((n) => n.startsWith('data/')), ['data/calls.json']);
  assert.deepEqual(errors, []);
  await close();
});

test('aller-retour « Remplacer » entre deux pages vierges : tout revient à l\'identique, médias compris', async () => {
  const A = await remote();
  await seed(A.page);
  const before = await state(A.page);
  assert.deepEqual(before.missing, [], 'références résolues au départ');
  const b64 = await exportB64(A.page, { name: 'Aller-retour', includeMedia: true });
  const B = await remote();
  await setFile(B.page, Buffer.from(b64, 'base64'));
  const ins = await B.page.evaluate(() => projectInspect(window.__f));
  assert.equal(ins.ok, true);
  assert.equal(ins.name, 'Aller-retour');
  assert.deepEqual(ins.sections, ['seq', 'chat', 'calls', 'callers', 'rings', 'memories', 'media']);
  assert.equal(ins.hasWork, true);
  assert.deepEqual(ins.calls, { call: 1, sms: 1, notif: 1 });
  assert.ok(ins.mediaBytes > 0);
  const r = await B.page.evaluate((s) => projectImport(window.__f, { mode: 'replace', sections: s }), ALL);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.preview, []);
  assert.equal(r.sections.calls.added, 3);
  const after = await state(B.page);
  assert.deepEqual(after, before);
  // Interface relue : listes, onglets, sons importés
  assert.equal(await B.page.evaluate(() => document.getElementById('callListTitle').textContent), 'Appels enregistrés · 1');
  assert.equal(await B.page.evaluate(() => document.getElementById('seqSavedCount').textContent), '1');
  assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  await A.close(); await B.close();
});

test('« Ajouter » deux fois : ids renumérotés, références des séquences suivies, noms « (2) », appelants et sons sans doublon', async () => {
  const A = await remote();
  const { rid } = await seed(A.page);
  const b64 = await exportB64(A.page, { name: 'Deux fois' });
  await setFile(A.page, Buffer.from(b64, 'base64'));
  const r = await A.page.evaluate(() => projectImport(window.__f, { mode: 'merge' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.sections.callers, { added: 0, removed: 0, skipped: 0, renamed: 0, same: 2, names: [] });
  assert.deepEqual(r.sections.rings, { added: 0, removed: 0, skipped: 0, renamed: 0, same: 1, names: [] });
  assert.equal(r.sections.seq.added, 1); assert.equal(r.sections.seq.renamed, 1);
  assert.deepEqual(r.sections.seq.names, ['Scène 12 (2)']); // nouveaux noms (compte rendu, 3 au plus)
  assert.equal(r.sections.work, undefined, 'état de travail jamais touché par « Ajouter » sans le demander');
  const s = await A.page.evaluate(() => ({
    seqs: seqSaved.map((e) => e.name), calls: callList.call.map((e) => [e.id, callEntryName(e), e.ringId]),
    chats: chatSaved.map((e) => e.name), cols: colorMemories.map((m) => [m.id, m.name]), fxs: fxMemories.map((m) => m.name),
    refs: seqSaved.map((e) => e.steps.map((st) => { const it = seqRefItem(st); return st.kind + '=' + (it ? (it.title || it.name || it.code || it.level || 'ok') : 'INTROUVABLE'); })),
    ids: seqSaved.map((e) => e.steps.filter((st) => ['call', 'chat', 'color', 'effect'].includes(st.kind)).map((st) => st.ref)),
    wall: seqSaved.map((e) => !!e.wall), photo: chatSaved.map((e) => e.hasPhoto), seqCur: _seq.name,
  }));
  assert.deepEqual(s.seqs, ['Scène 12', 'Scène 12 (2)']);
  assert.deepEqual(s.chats, ['Séq. 12 — Maman', 'Séq. 12 — Maman (2)']);
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0][1], 'Maman — scène 12');
  assert.equal(s.calls[1][1], 'Maman — scène 12 (2)');
  assert.notEqual(s.calls[1][0], 'eA1');
  assert.equal(s.calls[1][2], rid, 'son importé : même id (dérivé du contenu)');
  assert.deepEqual(s.cols.map((c) => c[1]), ['Chaud', 'Chaud (2)']);
  assert.notEqual(s.cols[1][0], 'col1');
  assert.deepEqual(s.fxs, ['Mon effet', 'Mon effet (2)']);
  // La copie pointe vers les copies (nouveaux ids), l'original vers les originaux
  assert.deepEqual(s.ids[0], ['col1', 'fx1', 'eA1', 'cD1']);
  assert.ok(s.ids[1].every((id, i) => id !== s.ids[0][i]), JSON.stringify(s.ids));
  assert.ok(s.refs[1].every((x) => !x.endsWith('INTROUVABLE')), JSON.stringify(s.refs[1]));
  assert.ok(s.refs[1].includes('call=Maman — scène 12 (2)'), JSON.stringify(s.refs[1]));
  assert.deepEqual(s.wall, [true, true]); assert.deepEqual(s.photo, [true, true]);
  assert.equal(s.seqCur, 'Scène 12');
  assert.deepEqual(A.errors, []);
  await A.close();
});

test('« Ajouter » : plafonds de l\'app respectés, le reste compté « ignoré »', async () => {
  const A = await remote();
  const list = Array.from({ length: 30 }, (_, i) => ({ id: 'p' + i, name: 'Appelant ' + i, label: '' }));
  const file = zip([{ name: 'project.json', data: manifest() }, { name: 'data/callers.json', data: { list } }]);
  await A.page.evaluate(() => localStorage.setItem(CALLERS_KEY, JSON.stringify({ v: 1, list: Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, name: 'Local ' + i, label: '' })) })));
  await setFile(A.page, file);
  const r = await A.page.evaluate(() => projectImport(window.__f, { mode: 'merge' }));
  assert.deepEqual(r.sections.callers, { added: 10, removed: 0, skipped: 20, renamed: 0, same: 0, names: [] });
  assert.equal(await A.page.evaluate(() => callers.length), 50);
  await A.close();
});

test('jamais de secret : session, appairage, écrans, identité de licence absents de l\'export ; garde-fou si une donnée privée s\'y glisse', async () => {
  const { page, close } = await remote();
  await seed(page);
  await page.evaluate(() => {
    // Registre d'écrans avec clé par écran, retrait en cours, écran et licence factices
    localStorage.setItem('setremote-screens-v1', JSON.stringify({ v: 1, sessions: { [_session.channelId]: { screens: { scrA: { n: 1, name: 'Salon', groups: [], pk: { s: 'SECRET-PAR-ECRAN-0123456789', kid: 'k1', ok: true } } }, groups: [] } } }));
    localStorage.setItem('setremote-rekey-v1', JSON.stringify({ v: 1, records: [{ ch: 'CANAL-ANCIEN-0123456789', key: 'CLE-ANCIENNE-0123456789', until: Date.now() + 1e6, revoked: [], pending: [] }] }));
    localStorage.setItem('setremote-licence-v1', JSON.stringify({ token: 'JETON-LICENCE-0123456789.sig', checked: 1 }));
    localStorage.setItem('setremote-licence-key-v1', JSON.stringify({ priv: { d: 'CLE-PRIVEE-LICENCE-0123456789' }, pub: {} }));
    localStorage.setItem('setremote-screen-pairwise-v1', JSON.stringify({ rid: 'r', s: 'PAIRWISE-ECRAN-0123456789', kid: 'k', ch: 'c' }));
  });
  const secrets = await page.evaluate(() => [_session.key, _session.channelId, remoteId(), 'SECRET-PAR-ECRAN-0123456789', 'CANAL-ANCIEN-0123456789', 'CLE-ANCIENNE-0123456789', 'JETON-LICENCE-0123456789', 'CLE-PRIVEE-LICENCE-0123456789', 'PAIRWISE-ECRAN-0123456789']);
  assert.ok(secrets.every((s) => typeof s === 'string' && s.length >= 8));
  const buf = Buffer.from(await exportB64(page, { includeMedia: true }), 'base64');
  const z = unzip(buf);
  const all = Buffer.concat([buf, ...[...z.values()].map((e) => e.data)]).toString('latin1');
  for (const s of secrets) assert.ok(!all.includes(s), 'secret présent : ' + s.slice(0, 6));
  for (const k of await page.evaluate(() => PRJ_NEVER_KEYS)) assert.ok(!all.includes(k), 'clé interdite citée : ' + k);
  // Une donnée privée recopiée dans un message : l'export est refusé
  const code = await page.evaluate(async () => {
    const o = JSON.parse(localStorage.getItem(CHAT_SAVED_KEY));
    o.list[0].msgs[0].text = 'clé : ' + _session.key;
    localStorage.setItem(CHAT_SAVED_KEY, JSON.stringify(o));
    try { await projectExport({}); return 'exporté'; } catch (e) { return e.code + ' · ' + e.message; }
  });
  assert.equal(code, 'secret · Export interrompu : une donnée privée allait y figurer.');
  await close();
});

test('fichiers refusés : pas un ZIP, abîmé, tronqué, autre format, version future, trop gros, trop d\'entrées, bombe, chiffré', async () => {
  const { page, errors, close } = await remote();
  const inspect = async (buf) => { await setFile(page, buf); return page.evaluate(() => projectInspect(window.__f)); };
  const good = zip([{ name: 'project.json', data: manifest() }, { name: 'data/memories.json', data: { color: [], fx: [] } }]);
  assert.equal((await inspect(good)).ok, true);
  const cases = [
    [Buffer.from('ceci n\'est pas un zip, juste du texte assez long pour la fin de fichier'), 'not-zip', 'Fichier non reconnu : ce n\'est pas un projet SetRemote (.rem).'],
    [Buffer.alloc(10), 'not-zip'],
    [good.subarray(0, good.length - 30), 'not-zip'],
    [zip([{ name: 'autre.txt', data: 'x' }]), 'not-project', 'Ce fichier n\'est pas un projet SetRemote.'],
    [zip([{ name: 'project.json', data: manifest({ format: 'autre' }) }]), 'not-project'],
    [zip([{ name: 'project.json', data: manifest({ version: 2 }) }]), 'version', 'Ce projet vient d\'une version plus récente de SetRemote : mettez l\'app à jour pour l\'ouvrir.'],
    [zip([{ name: 'project.json', data: manifest({ version: '1' }) }]), 'invalid'],
    [zip([{ name: 'project.json', data: '{pas du json' }]), 'invalid'],
    [zip([{ name: 'project.json', data: manifest() }, { name: 'data/seq.json', data: [1, 2] }]), 'invalid'],
    [zip([{ name: 'project.json', data: manifest(), crc: 1234 }]), 'corrupt', 'Fichier abîmé : le projet ne peut pas être lu.'],
    [zip([{ name: 'project.json', data: manifest(), flags: 1 }]), 'corrupt'],
    // Bombe : 20 Mo de zéros annoncés comme 100 octets
    [zip([{ name: 'project.json', data: manifest() }, { name: 'data/seq.json', data: Buffer.alloc(20e6), usize: 100 }]), 'corrupt'],
    // Entrée annoncée au-delà du plafond JSON (8 Mo)
    [zip([{ name: 'project.json', data: manifest() }, { name: 'data/seq.json', data: '{}', usize: 9e6 }]), 'too-large'],
  ];
  for (const [buf, code, msg] of cases) {
    const r = await inspect(buf);
    assert.equal(r.ok, false, code);
    assert.equal(r.code, code, code + ' ← ' + JSON.stringify(r));
    if (msg) assert.equal(r.message, msg);
  }
  // Octet modifié au milieu des données compressées
  const bad = Buffer.from(good); bad[60] ^= 0xFF;
  assert.equal((await inspect(bad)).ok, false);
  // Plafonds abaissés : taille du fichier, nombre d'entrées
  await page.evaluate(() => { PRJ_LIMITS.file = 200; });
  const big = await inspect(good);
  assert.equal(big.code, 'too-large');
  assert.equal(big.message, 'Fichier trop volumineux (plus de 0 Mo).');
  await page.evaluate(() => { PRJ_LIMITS.file = 512 * 1024 * 1024; PRJ_LIMITS.entries = 3; });
  assert.equal((await inspect(zip(Array.from({ length: 4 }, (_, i) => ({ name: 'x' + i, data: 'x' }))))).code, 'too-many');
  await page.evaluate(() => { PRJ_LIMITS.entries = 4000; });
  // Import refusé de même, rien d'écrit
  await setFile(page, zip([{ name: 'project.json', data: manifest({ version: 9 }) }, { name: 'data/memories.json', data: { color: [{ id: 'a', name: 'X', spec: {} }], fx: [] } }]));
  assert.equal((await page.evaluate(() => projectImport(window.__f, { mode: 'replace' }))).code, 'version');
  assert.equal(await page.evaluate(() => localStorage.getItem('setremote-color-memories')), null);
  // Rien à importer
  await setFile(page, zip([{ name: 'project.json', data: manifest() }]));
  assert.equal((await page.evaluate(() => projectImport(window.__f))).code, 'empty');
  assert.deepEqual(errors, []);
  await close();
});

test('contenu hostile : textes, ids, couleurs et types MIME piégés neutralisés, rien n\'est injecté', async () => {
  const { page, errors, close } = await remote();
  const X = '<img src=x onerror="window.__pwned=1">';
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const sha = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
  const f = 'files/' + sha + '.png';
  const file = zip([
    { name: 'project.json', data: manifest({ name: X + '\u0000\n' }) },
    { name: f, data: png, method: 0 },
    { name: 'data/seq.json', data: { list: [
      { id: 'q1', name: X, steps: [{ id: 's1', kind: 'call', ref: 'e1', target: { k: 'screen', id: '"><script>' }, trig: { k: 'after', s: 1e9 }, opt: {} },
        { id: 's2\'];alert(1)//', kind: 'call', ref: 'e1' }, { id: 's3', kind: 'eval', ref: 'x' }, { id: 's4', kind: 'unlock', opt: { img: 'javascript:alert(1)' } }] },
      { id: '../../etc', name: 'Mauvais id', steps: [] }], images: { 'javascript:x': { f, t: 'image/png' } } } },
    { name: 'data/calls.json', data: { call: [{ id: 'e1', kind: 'call', name: X, label: X, appColor: 'red;background:url(//x)', style: 'x" onclick="1', ring: '__proto__', ringVolume: 'fort', title: X, photo: { f: 'files/../../x.png', t: 'image/png' }, audio: { f, t: 'text/html' } }], sms: [{ id: 'e2', kind: 'call', name: 'mauvaise liste' }], notif: [] } },
    { name: 'data/chat.json', data: { list: [{ id: 'c1', name: X, contact: X, actor: X, style: 'glass', msgs: [{ id: 'm1', from: 'contact', text: X }, { id: 'm2', from: 'hacker', text: 'x' }], photo: { f, t: 'image/svg+xml' } }] } },
    { name: 'data/callers.json', data: { list: [{ id: 'p1', name: X, label: '' }, { id: 'p2', name: '' }] } },
    { name: 'data/memories.json', data: { color: [{ id: 'k1', name: X, spec: { kelvin: 'x', wheelHex: 'red;}', dimmer: 1e9 } }], fx: [{ id: 'f1', name: X, effect: 'constructor' }, { id: 'f2', name: X, effect: Object.keys({}).concat(['__proto__'])[0] }] } },
    { name: 'data/rings.json', data: { lib: [{ id: '__ring_0123456789abcdef', name: X, file: { f, t: 'audio/wav' } }], settings: { call: { sound: 'javascript:', vol: 'x' } } } },
  ]);
  await setFile(page, file);
  const r = await page.evaluate(() => projectImport(window.__f, { mode: 'merge' }));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.name, '<img src=x onerror="window.__pwned=1">');
  const s = await page.evaluate(() => ({
    seq: seqSaved.map((e) => [e.id, e.name, e.steps.map((st) => [st.id, st.kind, (st.target || e.target).k, st.trig.s, st.opt.img])]),
    call: callList.call.map((e) => [e.style, e.appColor, e.ring, e.ringVolume, e.hasPhoto, e.hasAudio]), sms: callList.sms.length,
    chat: chatSaved.map((e) => [e.msgs.length, e.hasPhoto]), callers: callers.map((e) => e.name), mem: colorMemories.map((m) => m.spec),
    fx: fxMemories.length, rings: ringLib.length,
  }));
  assert.deepEqual(s.seq, [['q1', '<img src=x onerror="window.__pwned=1">', [['s1', 'call', 'all', 600, undefined], ['s4', 'unlock', 'all', undefined, null]]]]);
  assert.deepEqual(s.call, [['glass', undefined, 'classic', 1, false, false]]);
  assert.equal(s.sms, 0);
  assert.deepEqual(s.chat, [[1, false]]);
  assert.deepEqual(s.callers, ['<img src=x onerror="window.__pwned=1">']);
  assert.deepEqual(s.mem, [{ kelvin: 5600, tint: 0, dimmer: 100, wheelHex: '#ffffff', crossfade: 0 }]);
  assert.equal(s.fx, 0);
  assert.equal(s.rings, 0, 'faux PNG annoncé comme son : refusé');
  // Tout afficher : listes, onglets, feuilles
  const shown = await page.evaluate(() => {
    switchTab('call'); for (const k of ['call', 'sms', 'notif']) setCallListKind(k);
    setCallKind('discussion'); setChatView('saved');
    const chat = document.getElementById('dcSavedRows').textContent;
    openCallersSheet();
    const sheet = document.getElementById('srSheetBody').textContent;
    closeSheet();
    switchTab('seq'); setSeqView('saved');
    const seq = document.getElementById('seqSavedRows').textContent;
    setSeqView('cur'); renderColorMemories(); renderFxMemories();
    return [chat, sheet, seq].map((t) => t.includes('<img src=x'));
  });
  assert.deepEqual(shown, [true, true, true], 'textes affichés tels quels, comme du texte');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__pwned), undefined);
  assert.equal(await page.evaluate(() => document.querySelectorAll('img[src="x"]').length), 0);
  assert.deepEqual(errors, []);
  await close();
});

test('aperçu sans licence : import écrit dans le stockage réel, l\'aperçu reste, tout apparaît avec la licence', async () => {
  const A = await remote();
  await seed(A.page);
  const b64 = await exportB64(A.page, { name: 'Pour licence' });
  await A.close();
  const L = await openPage(browser, { init: licenceInit() });
  await L.page.evaluate(() => startMode('remote'));
  await waitFor(L.page, () => licLocked('tel') && licLocked('seq'));
  const demo = await L.page.evaluate(() => callList.call.map((e) => e.id));
  await setFile(L.page, Buffer.from(b64, 'base64'));
  const r = await L.page.evaluate(() => projectImport(window.__f, { mode: 'replace' }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.preview, ['tel', 'seq']);
  const s = await L.page.evaluate(() => ({
    mem: callList.call.map((e) => e.id), raw: JSON.parse(localStorage.getItem(CALL_LIST_KEY)).call.map((e) => e.id),
    masked: JSON.parse(_lsGet(CALL_LIST_KEY)).call.map((e) => e.id), seqRaw: JSON.parse(localStorage.getItem(SEQ_SAVED_KEY)).list.length,
  }));
  assert.deepEqual(s.mem, demo, 'la démo reste affichée');
  assert.deepEqual(s.masked, demo);
  assert.deepEqual(s.raw, ['eA1']);
  assert.equal(s.seqRaw, 1);
  // La licence arrive : les données importées apparaissent, photo comprise (IndexedDB réel)
  await L.page.evaluate(() => { _licSwitch('tel', false); _licSwitch('seq', false); });
  const u = await L.page.evaluate(async () => ({ call: callList.call.map((e) => callEntryName(e)), seq: seqSaved.map((e) => e.name), photo: !!(await callAssetGet('eA1:photo')), missing: seqSaved[0].steps.filter((s) => !seqRefItem(s)).map((s) => s.kind) }));
  assert.deepEqual(u.call, ['Maman — scène 12']);
  assert.deepEqual(u.seq, ['Scène 12']);
  assert.equal(u.photo, true);
  assert.deepEqual(u.missing, ['media'], 'seul le média (non exporté) manque');
  // Export pendant l'aperçu : les données de l'utilisateur, jamais la démo
  await L.page.evaluate(() => { _licSwitch('tel', true); });
  const z = unzip(Buffer.from(await exportB64(L.page, {}), 'base64'));
  assert.deepEqual(json(z, 'data/calls.json').call.map((e) => e.id), ['eA1']);
  assert.ok(json(z, 'data/calls.json').call[0].photo, 'photo lue dans IndexedDB réel');
  assert.deepEqual(L.errors, []);
  await L.close();
});

test('web : projectSave télécharge « Nom.rem », projectPick ouvre un sélecteur de fichier (.rem, ancien .setremote)', async () => {
  const { page, close } = await remote();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(async () => projectSave(await projectExport({ name: 'Nuit/Jour: 2' }), 'Nuit/Jour: 2'))]);
  assert.equal(dl.suggestedFilename(), 'Nuit Jour 2.rem');
  const path = await dl.path();
  const buf = (await import('node:fs')).readFileSync(path);
  assert.equal(json(unzip(buf), 'project.json').name, 'Nuit/Jour: 2');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { window.__pick = projectPick(); })]);
  assert.equal(await fc.element().getAttribute('accept'), '.rem,.setremote,application/zip');
  await fc.setFiles({ name: 'Nuit.rem', mimeType: 'application/octet-stream', buffer: buf });
  assert.deepEqual(await page.evaluate(async () => { const f = await window.__pick; return [f.name, (await projectInspect(f)).name]; }), ['Nuit.rem', 'Nuit/Jour: 2']);
  // Ancienne extension : même contenu, accepté
  const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { window.__pick = projectPick(); })]);
  await fc2.setFiles({ name: 'Ancien.setremote', mimeType: 'application/zip', buffer: buf });
  assert.deepEqual(await page.evaluate(async () => { const f = await window.__pick; return [f.name, (await projectInspect(f)).ok]; }), ['Ancien.setremote', true]);
  await close();
});

test('app native : enregistrement et ouverture par morceaux base64 (pont project:*)', async () => {
  const init = () => { window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1 }; window.__posts = []; window.ReactNativeWebView = { postMessage: (s) => window.__posts.push(JSON.parse(s)) }; };
  const { page, errors, close } = await remote({ init });
  // Fichier de ~1,2 Mo (aléatoire : incompressible) → 4 morceaux
  const big = await page.evaluate(async () => {
    const u = new Uint8Array(1200000); for (let i = 0; i < u.length; i += 65536) crypto.getRandomValues(u.subarray(i, i + 65536));
    window.__big = new Blob([u]);
    window.__saved = projectSave(window.__big, 'Gros');
    await new Promise((r) => setTimeout(r, 300));
    return _prjBytesToB64(u);
  });
  const posts = await page.evaluate(() => window.__posts.filter((m) => m.type === 'project:save'));
  assert.equal(posts.length, 4);
  assert.ok(posts.every((m, i) => m.i === i && m.n === 4 && m.name === 'Gros.rem' && m.size === 1200000 && m.data.length <= 512 * 1024));
  assert.equal(Buffer.concat(posts.map((m) => Buffer.from(m.data, 'base64'))).toString('base64'), big);
  await page.evaluate((id) => SRNative.receive({ type: 'project:saved', id, ok: true, shared: true }), posts[0].id);
  assert.deepEqual(await page.evaluate(() => window.__saved), { ok: true, shared: true });
  // Ouverture : un vrai projet renvoyé par morceaux de 512 Kio
  const proj = await page.evaluate(async () => { saveColorMemory(); return _prjBytesToB64(new Uint8Array(await (await projectExport({ name: 'Natif' })).arrayBuffer())); });
  await page.evaluate(() => { window.__posts.length = 0; window.__pick = projectPick(); });
  const open = await page.evaluate(() => window.__posts[0]);
  assert.equal(open.type, 'project:open');
  const buf = Buffer.from(proj, 'base64');
  const parts = [];
  for (let i = 0; i < buf.length; i += 3) parts.push(buf.subarray(i, i + 3)); // morceaux minuscules : la règle « multiple de 4 » tient
  for (let i = 0; i < parts.length; i++) await page.evaluate((m) => SRNative.receive(m), { type: 'project:file', id: open.id, name: 'Natif.setremote', size: buf.length, i, n: parts.length, data: parts[i].toString('base64') });
  assert.deepEqual(await page.evaluate(async () => { const f = await window.__pick; return [f.name, f.size, (await projectInspect(f)).name]; }), ['Natif.setremote', buf.length, 'Natif']);
  // Annulé, morceau hors d'ordre, erreur de la coque
  await page.evaluate(() => { window.__posts.length = 0; window.__pick = projectPick(); });
  let id = await page.evaluate(() => window.__posts[0].id);
  await page.evaluate((id) => SRNative.receive({ type: 'project:file', id, cancelled: true }), id);
  assert.equal(await page.evaluate(() => window.__pick), null);
  await page.evaluate(() => { window.__posts.length = 0; window.__pick = projectPick().catch((e) => 'ERR ' + e.code); });
  id = await page.evaluate(() => window.__posts[0].id);
  await page.evaluate((id) => SRNative.receive({ type: 'project:file', id, name: 'x', size: 8, i: 1, n: 2, data: 'AAAA' }), id);
  assert.equal(await page.evaluate(() => window.__pick), 'ERR corrupt');
  await page.evaluate(() => { window.__posts.length = 0; window.__pick = projectPick().catch((e) => 'ERR ' + e.code + ' ' + e.message); });
  id = await page.evaluate(() => window.__posts[0].id);
  await page.evaluate((id) => SRNative.receive({ type: 'project:error', id, reason: 'too-large' }), id);
  assert.match(await page.evaluate(() => window.__pick), /^ERR too-large Fichier trop volumineux/);
  // Message d'un autre id : ignoré
  assert.equal(await page.evaluate(() => SRNative.receive({ type: 'project:saved', id: 'inconnu', ok: true })), false);
  assert.deepEqual(errors, []);
  await close();
});

// ══════════ Projets locaux ══════════
const pj = (page, expr, arg) => page.evaluate(expr, arg);

test('projets : migration « Mon projet », créer, ouvrir, revenir sans rien perdre, dupliquer, renommer, supprimer', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  const before = await state(page);
  let l = await pj(page, () => projectsList());
  assert.equal(l.ok, true);
  assert.equal(l.list.length, 1);
  assert.equal(l.list[0].name, 'Mon projet');
  assert.equal(l.list[0].active, true);
  assert.deepEqual(l.list[0].counts, { seq: 1, chat: 1, calls: 3, callers: 2, rings: 1, memories: 2, media: 1 });
  // Nouveau projet vide, ouvert
  const c = await pj(page, () => projectCreate({ name: 'Tournage B', from: 'empty' }));
  assert.equal(c.ok, true);
  const sw = await pj(page, (id) => projectSwitch(id), c.id);
  assert.equal(sw.ok, true, JSON.stringify(sw));
  const empty = await pj(page, () => ({ calls: CALL_LISTS.map((k) => callList[k].length), seq: seqSaved.length, chat: chatSaved.length, callers: callers.length, rings: ringLib.length, col: colorMemories.length, fx: fxMemories.length, cur: _seq.steps.length, thread: _chat.msgs.length, avatar: _chatAvatar, pool: _mediaPool.length }));
  assert.deepEqual(empty, { calls: [0, 0, 0], seq: 0, chat: 0, callers: 0, rings: 0, col: 0, fx: 0, cur: 0, thread: 0, avatar: null, pool: 1 });
  // Travail dans B
  await pj(page, () => { saveColorMemory(); });
  // Retour à « Mon projet » : tout revient à l'identique
  const mine = (await pj(page, () => projectsList())).list.find((p) => p.name === 'Mon projet');
  assert.equal((await pj(page, (id) => projectSwitch(id), mine.id)).ok, true);
  assert.deepEqual(await state(page), before);
  // B a gardé son travail
  l = await pj(page, () => projectsList());
  assert.deepEqual(l.list.map((p) => [p.name, p.active, p.counts.memories]), [['Mon projet', true, 2], ['Tournage B', false, 1]]);
  assert.ok(l.list[1].size > 0);
  // Supprimer le projet ouvert : refusé
  const d = await pj(page, (id) => projectDelete(id), mine.id);
  assert.deepEqual([d.ok, d.code, d.message], [false, 'active', 'Le projet ouvert ne peut pas être supprimé : ouvrez-en un autre d\'abord.']);
  // Dupliquer (ouvert : contenu actuel), renommer, exporter sans ouvrir, supprimer
  const dup = await pj(page, (id) => projectDuplicate(id), mine.id);
  assert.equal(dup.name, 'Mon projet (copie)');
  assert.equal((await pj(page, ([id]) => projectRename(id, 'Tournage B'), [dup.id])).name, 'Tournage B (2)');
  const ex = await pj(page, async (id) => { const r = await projectExportStored(id); return { name: r.name, ins: await projectInspect(r.blob) }; }, dup.id);
  assert.equal(ex.ins.name, 'Tournage B (2)');
  assert.deepEqual(ex.ins.counts.calls, 3);
  const exB = await pj(page, async (id) => { const r = await projectExportStored(id); const z = await projectInspect(r.blob); return [z.name, z.counts.memories]; }, c.id);
  assert.deepEqual(exB, ['Tournage B', 1]);
  assert.equal((await pj(page, (id) => projectDelete(id), dup.id)).ok, true);
  assert.deepEqual((await pj(page, () => projectsList())).list.map((p) => p.name), ['Mon projet', 'Tournage B']);
  // Les écrans, l'appairage et les réglages ne changent pas
  assert.ok(await pj(page, () => !!_session && !!localStorage.getItem('setremote-session-v1')));
  assert.deepEqual(errors, []);
  await close();
});

test('projets : « à partir du projet actuel », importer comme nouveau projet, ouvrir, refus pendant le jeu, quota', async () => {
  const A = await remote();
  await seed(A.page);
  const b64 = await exportB64(A.page, { name: 'Venu d\'ailleurs' });
  const B = await remote();
  const { page } = B;
  // Données existantes de B
  await pj(page, () => { saveColorMemory(); });
  await setFile(page, Buffer.from(b64, 'base64'));
  const n = await pj(page, () => projectImport(window.__f, { mode: 'new' }));
  assert.equal(n.ok, true, JSON.stringify(n));
  assert.equal(n.name, 'Venu d\'ailleurs');
  assert.equal(await pj(page, () => colorMemories.length), 1, 'projet ouvert inchangé');
  // Ouvrir : séquence en cours et fil en cours repris aussi (état de travail)
  assert.equal((await pj(page, (id) => projectSwitch(id), n.id)).ok, true);
  const s = await state(page);
  const a = await state(A.page);
  for (const k of ['callList', 'chatSaved', 'callers', 'ringLib', 'colorMemories', 'fxMemories', 'seqSaved', 'seq', 'chat', 'avatar', 'assets', 'rings']) assert.deepEqual(s[k], a[k], k);
  // Copie du projet ouvert
  const cp = await pj(page, () => projectCreate({ from: 'current' }));
  assert.equal(cp.name, 'Venu d\'ailleurs (copie)');
  // Refus pendant le jeu
  await pj(page, () => { _chat.open = true; });
  const busy = await pj(page, (id) => projectSwitch(id), cp.id);
  assert.deepEqual([busy.ok, busy.code], [false, 'busy']);
  await pj(page, () => { _chat.open = false; _seqRun.state = 'running'; });
  assert.equal((await pj(page, (id) => projectSwitch(id), cp.id)).code, 'busy');
  await pj(page, () => { _seqRun.state = 'idle'; });
  // Quota
  await pj(page, () => { PRJ_LIMITS.store = 1000; });
  const q = await pj(page, () => projectCreate({ from: 'current' }));
  assert.deepEqual([q.ok, q.code], [false, 'quota']);
  await pj(page, () => { PRJ_LIMITS.store = 1024 * 1024 * 1024; PRJ_LIMITS.projects = 3; });
  assert.equal((await pj(page, () => projectCreate({}))).code, 'quota');
  await pj(page, () => { PRJ_LIMITS.projects = 50; });
  // Opérations simultanées
  const both = await pj(page, () => Promise.all([projectsList(), projectsList()]));
  assert.deepEqual(both.map((r) => r.ok === true || r.code), [true, 'pending']);
  assert.deepEqual(A.errors, []); assert.deepEqual(B.errors, []);
  await A.close(); await B.close();
});

test('projets : la migration reprend les données d\'une version précédente comme « Mon projet »', async () => {
  const init = () => {
    if (localStorage.getItem('setremote-call-list-v1')) return;
    localStorage.setItem('setremote-call-list-v1', JSON.stringify({ v: 1, call: [{ id: 'eOld', kind: 'call', style: 'tonal', name: 'Ancien', label: '', ringVolume: 1 }], sms: [], notif: [] }));
    localStorage.setItem('setremote-color-memories', JSON.stringify([{ id: 'c1', name: 'Vieille', spec: { kelvin: 3200, tint: 0, dimmer: 100, wheelHex: '#ffffff', crossfade: 0 } }]));
  };
  const { page, close } = await remote({ init });
  const l = await pj(page, () => projectsList());
  assert.deepEqual(l.list.map((p) => [p.name, p.active, p.counts.calls, p.counts.memories]), [['Mon projet', true, 1, 1]]);
  // Une deuxième fois : pas de nouveau projet
  assert.equal((await pj(page, () => projectsList())).list.length, 1);
  await close();
});

test('nouvelle séquence / nouvelle discussion : repartir de zéro, enregistrer crée une nouvelle entrée', async () => {
  const { page, errors, close } = await remote();
  await seed(page);
  // Séquence chargée et modifiée : refus tant que l'appelant n'a pas choisi
  await pj(page, () => { _seq.name = 'Modifiée'; _seq.steps.pop(); seqSave(); });
  let r = await pj(page, () => seqNew());
  assert.deepEqual(r, { ok: false, code: 'dirty', name: 'Modifiée' });
  r = await pj(page, () => seqNew({ save: 'Scène 12 bis' }));
  assert.deepEqual(r, { ok: true });
  let s = await pj(page, () => ({ saved: seqSaved.map((e) => [e.name, e.steps.length]), cur: [_seq.name, _seq.steps.length, _seq.savedId] }));
  assert.deepEqual(s.saved, [['Scène 12', 9], ['Scène 12 bis', 2]]);
  assert.deepEqual(s.cur, ['', 0, null]);
  // La nouvelle séquence, enregistrée, est une nouvelle entrée ; « Scène 12 » reste telle quelle
  await pj(page, () => { _seq.steps.push({ id: 'n1', kind: 'battery', ref: null, target: { k: 'all' }, trig: { k: 'go' }, opt: { level: 5 } }); saveCurrentSeq('Neuve'); });
  s = await pj(page, () => seqSaved.map((e) => [e.name, e.steps.length]));
  assert.deepEqual(s, [['Scène 12', 9], ['Scène 12 bis', 2], ['Neuve', 1]]);
  // Abandon des modifications
  await pj(page, () => { _seq.steps.push({ id: 'n2', kind: 'off', ref: null, target: { k: 'all' }, trig: { k: 'go' }, opt: {} }); seqSave(); });
  assert.deepEqual(await pj(page, () => seqNew({ discard: true })), { ok: true });
  assert.equal(await pj(page, () => seqSaved.find((e) => e.name === 'Neuve').steps.length), 1);
  // Discussion : fil en cours non enregistré
  r = await pj(page, () => chatNew());
  assert.deepEqual(r, { ok: false, code: 'dirty', name: 'Thomas ‹› Julie' });
  r = await pj(page, () => chatNew({ save: '' }));
  assert.deepEqual(r, { ok: true });
  s = await pj(page, () => ({ saved: chatSaved.map((e) => e.name), cur: [_chat.name, _chat.actor, _chat.style, _chat.msgs.length, _chat.savedId, _chatAvatar] }));
  assert.deepEqual(s.saved, ['Séq. 12 — Maman', 'Thomas ‹› Julie']);
  assert.deepEqual(s.cur, ['', 'Julie', 'tonal', 0, null, null]);
  assert.deepEqual(await pj(page, () => chatNew()), { ok: true }, 'fil vierge : rien à enregistrer');
  await pj(page, () => { _chat.open = true; });
  assert.deepEqual(await pj(page, () => chatNew({ discard: true })), { ok: false, code: 'live' });
  await pj(page, () => { _chat.open = false; });
  // Rechargement : fil vierge gardé
  await page.reload();
  await pj(page, () => startMode('remote'));
  assert.deepEqual(await pj(page, () => [_chat.msgs.length, _seq.steps.length]), [0, 0]);
  assert.deepEqual(errors, []);
  await close();
});

test('nouvelle séquence / discussion verrouillées en aperçu sans licence', async () => {
  const L = await openPage(browser, { init: licenceInit() });
  await L.page.evaluate(() => startMode('remote'));
  await waitFor(L.page, () => licLocked('tel') && licLocked('seq'));
  assert.deepEqual(await L.page.evaluate(() => seqNew({ discard: true })), { ok: false, code: 'locked' });
  assert.deepEqual(await L.page.evaluate(() => chatNew({ discard: true })), { ok: false, code: 'locked' });
  await L.close();
});
