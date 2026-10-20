// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Écrans clés capturés pour la non-régression visuelle. Chaque scène part
// d'une page neuve, horloge figée (T0) et aléa déterministe : deux rendus du
// même HTML dans le même environnement sont identiques au pixel près.
import { openPage, waitFor, T0 } from './harness.mjs';
import { licenceInit, signToken, payloadFor, DEVICE_ID } from './licence.mjs';
import { buildSacnDataPacket } from '../../packages/dmx/index.js';

// Session et code d'appairage déterministes (QR identique d'un rendu à
// l'autre), lien d'appairage indépendant du chemin local du fichier.
const fixRandom = (page) => page.evaluate(() => {
  if (typeof crypto === 'undefined') return;
  let x = 0x2545f491;
  crypto.getRandomValues = (a) => {
    const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let i = 0; i < b.length; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 255; }
    return a;
  };
  window.pairingBaseUrl = () => 'https://setremote.app/';
});
// Session fixe des scènes « écran » (aucune connexion réelle)
const VISUAL_SESSION = { channelId: 'A'.repeat(22), key: 'A'.repeat(43) };
const joinScreen = (page) => page.evaluate((p) => screenJoinSession(p), VISUAL_SESSION);

const remote = (tab, extra) => async (page) => {
  await fixRandom(page);
  await page.evaluate(() => startMode('remote'));
  await page.clock.runFor(400);
  if (tab) await page.evaluate((t) => switchTab(t), tab);
  if (extra) await extra(page);
  // Rendus asynchrones des projets (IndexedDB : carte « Projet » des Réglages, vues) terminés
  await page.evaluate(() => (typeof projectUiIdle === 'function' ? projectUiIdle() : null));
  await page.clock.runFor(400);
};
// ── Projets (maquettes 45 à 46c) : données d'un projet « Tournage B » écrites dans le stockage ──
const projectSeed = async (page) => { await importTones(page); await page.evaluate(async () => {
  const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + (i + 1), from: i % 2 ? 'actor' : 'contact', text: 'Message ' + (i + 1) }));
  localStorage.setItem(CHAT_SAVED_KEY, JSON.stringify({ v: 2, list: [['cD1', 'Séq. 12 — Maman', 'Maman', 'Julie'], ['cD2', 'Séq. 14 — Rupture', 'Thomas', 'Julie'], ['cD3', 'Séq. 21 — Agence', 'Agence', 'Marc']]
    .map(([id, name, contact, actor]) => ({ id, name, contact, actor, style: 'glass', msgs: msgs(4), hasPhoto: false, photoSig: null })) }));
  const call = (id, name) => ({ id, kind: 'call', style: 'glass', name, label: 'mobile', ring: 'classic', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false });
  const sms = (id, name, msg) => ({ id, kind: 'sms', style: 'glass', name, label: '', msg, appName: 'Messages', ring: 'digital', ringVolume: 1, autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false });
  localStorage.setItem(CALL_LIST_KEY, JSON.stringify({ v: 1,
    call: [call('eA1', 'Maman'), call('eA2', 'Agence'), call('eA3', 'Inconnu'), call('eA4', 'Hôpital'), call('eA5', 'Julien')],
    sms: [sms('eS1', 'Léa', 'Tu viens ?'), sms('eS2', 'Maman', 'Rappelle-moi stp')],
    notif: [{ id: 'eN1', kind: 'notif', style: 'glass', name: 'Alerte', label: '', msg: 'Nouveau message', appName: 'Insta', ring: 'soft', ringVolume: 0.5, present: 'banner', phone: { date: '2026-07-17', time: '14:32' }, received: { mode: 'ago', min: 5 }, hasPhoto: false, hasAudio: false }] }));
  localStorage.setItem(CALLERS_KEY, JSON.stringify({ v: 1, list: ['Maman', 'Agence', 'Léa', 'Thomas', 'Hôpital', 'Julien'].map((name, i) => ({ id: 'pC' + i, name, label: '', hasPhoto: false })) }));
  const spec = (k) => ({ kelvin: k, tint: 0, dimmer: 80, wheelHex: '#ffffff', crossfade: 0 });
  localStorage.setItem('setremote-color-memories', JSON.stringify([['col1', 'Chaud', 3200], ['col2', 'Nuit', 5600], ['col3', 'Bougie', 1900]].map(([id, name, k]) => ({ id, name, spec: spec(k), strobe: null }))));
  const fx = Object.keys(EFFECT_CONFIG);
  localStorage.setItem('setremote-fx-memories', JSON.stringify([{ id: 'fx1', name: 'Orage', effect: fx[0], params: {} }, { id: 'fx2', name: 'TV', effect: fx[1], params: {} }]));
  const st = (id, kind, ref) => ({ id, kind, ref, target: { k: 'all' }, trig: { k: 'go' }, opt: {} });
  localStorage.setItem(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: [['qS1', 'Scène 12'], ['qS2', 'Scène 14'], ['qS3', 'Scène 21'], ['qS4', 'Scène 30']]
    .map(([id, name]) => ({ id, name, steps: [st('s1', 'color', 'col1'), st('s2', 'call', 'eA1'), st('s3', 'sms', 'eS1'), st('s4', 'chat', 'cD1')] })) }));
  _licReloadTel(); seqLoad(); loadSavedSeqs(); renderSeq();
  loadColorMemories(); renderColorMemories(); loadFxMemories(); renderFxMemories();
  await projectsInit();
  await projectRename(projectActiveId(), 'Tournage B');
}); };
// Autres projets rangés (liste, maquette 46)
const projectMore = (page) => page.evaluate(async () => {
  await projectCreate({ name: 'Mon projet', from: 'current' });
  await projectCreate({ name: 'Court « La Nuit »' });
  await projectCreate({ name: 'Pub Orangina' });
});
// Fichier « tournage-b.rem » exporté des données du projet (sans les médias)
const projectFile = (page) => page.evaluate(async () => {
  window.__rem = new File([await projectExport({ name: 'Tournage B' })], 'tournage-b.rem', { type: 'application/zip' });
});
const projectScene = (extra) => remote(null, async (page) => {
  await projectSeed(page);
  if (extra) await extra(page);
});
// Notification d'application de la maquette 24 / 25
const NOTIF = {
  kind: 'notif', name: 'Virement reçu', appName: 'Banque Atlas',
  msg: 'Vous avez reçu 2 400,00 € de SARL Prod Nord. Solde disponible : 3 182,45 €.',
  phone: { date: '2025-10-17', time: '14:32' }, received: { mode: 'ago', min: 15 },
};
// Discussion sur l'écran (maquette 27), réponse du comédien tapée au vrai clavier
const screenChat = (style) => async (page) => {
  await joinScreen(page);
  await page.evaluate((style) => {
    const msgs = [['d1', 'contact', 'Tu es où ?'], ['d2', 'contact', 'Ton père t\'attend depuis une heure'], ['d6', 'contact', 'Réponds-moi s\'il te plaît'],
      ['d3', 'actor', 'je suis chez Léa, j\'arrive'], ['d4', 'contact', 'Je t\'ai vue avec lui. On en parlera ce soir.']];
    for (const [id, from, text] of msgs) screenChatMsg({ id, from, text });
    screenChatOpen({ name: 'Maman', style, ids: msgs.map((m) => m[0]), sent: ['d1', 'd2', 'd6'], typed: 0 });
  }, style);
  await page.keyboard.type('je suis chez L');
  await page.keyboard.press('a');
  await page.clock.runFor(600);
};
const screenCall = (m, after) => async (page) => {
  await joinScreen(page);
  await page.evaluate((m) => screenCallStart({ ring: 'silent', ...m }), m);
  await page.clock.runFor(1200);
  if (after) { await after(page); await page.clock.runFor(1200); }
};
// Cadre de la politique de confidentialité chargé, polices comprises
async function policyFrameReady(page, file) {
  for (let i = 0; i < 400; i++) {
    const f = page.frames().find((fr) => fr.url().endsWith('/' + file));
    if (f) { await f.waitForLoadState('load'); await f.evaluate(() => document.fonts.ready); return; }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('cadre absent : ' + file);
}
// Seul #nv-scroll défile (en-tête et barre d'onglets fixes) : top = distance voulue du haut du contenu,
// jamais sous le segmenté collant (≈ 64 px)
const scrollTo = (id, top = 72) => (page) => page.evaluate(([id, top]) => {
  const el = document.getElementById(id), sc = document.getElementById('nv-scroll');
  sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - top;
}, [id, Math.max(top, 72)]);
// Vue « Style et sonnerie » de l'onglet Tel (maquette 36b), défilée jusqu'à un élément
const scrollView = (id, top = 120) => (page) => page.evaluate(([id, top]) => {
  const el = document.getElementById(id);
  document.getElementById('tel-style-view').scrollTop += el.getBoundingClientRect().top - top;
}, [id, top]);

// ── Sonneries importées (maquette 12) ──
// Vrais sons WAV (sinusoïdes) importés par le chemin de l'app (type, décodage,
// IndexedDB) ; aucune minuterie en jeu : compatible avec l'horloge figée.
function wavB64(sec, freq, rate = 8000) {
  const n = Math.round(sec * rate), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * freq * i / rate)), 44 + i * 2);
  return b.toString('base64');
}
const importTones = (page) => page.evaluate(async (tones) => {
  for (const [name, b64] of tones) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    await onRingImport([new File([bytes], name, { type: 'audio/wav' })]);
  }
}, [['sonnerie-prod.m4a', wavB64(12, 440)], ['vieux-telephone.mp3', wavB64(8, 660)]]);
const ringScene = (kind) => remote('call', async (page) => {
  await importTones(page);
  await page.evaluate((kind) => {
    setCallKind(kind);
    selectRingTone(ringLib[kind === 'call' ? 0 : 1].id);
    document.getElementById('ringVolSlider').value = kind === 'call' ? '80' : '60'; onRingVolume();
    // Bande son du décroché arrivée sur l'écran (accusé media:cached)
    _callAudioData = 'data:audio/mpeg;base64,AAAA'; _callAudioName = 'voix-maman.m4a'; _callAudioDur = 34;
    _screenCached.add('__callaudio'); renderCallAudioRow();
    _ringSetStatus('');
    openTelStyle();
  }, kind);
  await scrollView('callRingPanel')(page);
});

// ── Licence (version officielle) : configuration imposée par la scène ──
// Identifiant d'appareil fixe (tests/helpers/licence.mjs) ; le service est
// injoignable (harnais hermétique) : sans licence, aperçu ; « active », jeton
// gardé de la veille, valable hors ligne (vérifié il y a 2 h).
const LIC_ACTIVE_TOKEN = {
  token: await signToken({ ...payloadFor(DEVICE_ID, { features: ['tel', 'seq'], holder: 'Prod Nord', end: Date.parse('2027-04-17T12:00:00+02:00'), devices: { n: 3, max: 5 } }, T0 - 2 * 3600e3) }),
  checked: T0 - 2 * 3600e3,
};
export const SCENE_INIT = {
  'remote-call-preview': licenceInit({ fixedDevice: true }),
  'remote-seq-preview': licenceInit({ fixedDevice: true }),
  'remote-seq-prepare-preview': licenceInit({ fixedDevice: true }),
  'remote-settings-licence': licenceInit({ fixedDevice: true }),
  'remote-settings-licence-active': licenceInit({ fixedDevice: true, token: LIC_ACTIVE_TOKEN }),
};
// Identité prête, première vérification finie (échec réseau silencieux)
const licScene = (tab, extra) => remote(tab, async (page) => {
  await waitFor(page, () => !!licDeviceId() && !_lic.busy && !!_lic.error);
  await page.clock.runFor(100);
  if (extra) await extra(page);
});

// ── Passerelle DMX (maquettes 14 à 18) ──
// Scènes rendues « dans l'app native » : pont simulé (la passerelle exige l'UDP de la coque)
const NATIVE_INIT = { fn: () => { window.SETREMOTE_NATIVE = { platform: 'ios', bridge: 1 }; window.ReactNativeWebView = { postMessage: () => {} }; } };
export const NATIVE_SCENES = new Set(['remote-qr-dmx-entry', 'dmx-gateway', 'dmx-patch', 'dmx-monitor', 'dmx-channels',
  'remote-offline', 'remote-screens-links', 'remote-link-lan', 'remote-link-ble']);
const DMX_IDS = ['ScreenOne0000001', 'ScreenTwo0000002', 'ScreenTri0000003'];
const DMX_CID = '5f1e7a52-3c4b-4d8e-9a10-2b3c4d5e6f70';
const _dmxSeq = new Map();
// Datagramme sACN (base64) tel que la coque le remet à la page
function sacnB64(universe, slots) {
  const sequence = ((_dmxSeq.get(universe) || 0) + 1) & 0xff;
  _dmxSeq.set(universe, sequence);
  return Buffer.from(buildSacnDataPacket({ cid: DMX_CID, universe, data: slots, sequence, sourceName: 'Console Eos' })).toString('base64');
}
const feed = (page, packets) => page.evaluate((p) => window.SRNative.receive({ type: 'dmx:packets', packets: p }), packets);
const pkt = (universe, slots) => ({ src: '10.0.0.10', port: 5568, data: sacnB64(universe, slots) });
// Télécommande dans l'app : liaison établie, 3 écrans appairés, passerelle
// ouverte, IP connue. Capture juste après la dernière action (voyant allumé
// par le dernier paquet reçu).
const gateway = (extra) => async (page) => {
  _dmxSeq.clear();
  await fixRandom(page);
  await page.evaluate(() => startMode('remote'));
  await page.clock.runFor(400);
  await page.evaluate((ids) => {
    setConnStatus('connected');
    ids.forEach((id, i) => remoteNoteScreen('s' + i + 'AAAAAAA', { type: 'caps', screenId: id }));
    openDmxGateway();
    window.SRNative.receive({ type: 'net:info', interfaces: [{ name: 'en1', kind: 'ethernet', ip: '10.0.0.42', mask: '255.255.255.0' }] });
  }, DMX_IDS);
  if (extra) await extra(page);
};
const patchAll = (page, entries) => page.evaluate(([ids, entries]) => entries.forEach((e, i) => gwPatchSet(ids[i], e)), [DMX_IDS, entries]);

// ── Plusieurs écrans (maquettes 5 et 6) ──
// Trois écrans en ligne, nommés ; groupes « Salon » (Julie, TV) et « Cuisine »
// (tablette) ; tous à 3200 K / 60 %, puis un appel sur le téléphone de Julie,
// l'effet TV (lissage 40 %) sur la TV ; cible : Salon.
const SCR_IDS = ['JulieScreen00001', 'TvSalonScreen002', 'TabletteCuisine3'];
const multiScreen = (extra) => remote(null, async (page) => {
  await page.evaluate((ids) => {
    setConnStatus('connected');
    ids.forEach((id, i) => remoteNoteScreen('s' + i + 'SCRAAAAA', { type: 'caps', screenId: id }));
    const [julie, tv, tab] = ids;
    scrRenameScreen(julie, 'Téléphone de Julie'); scrRenameScreen(tv, 'TV salon'); scrRenameScreen(tab, 'Tablette cuisine');
    scrCreateGroup('Salon', [julie, tv]);
    scrCreateGroup('Cuisine', [tab]);
    setKelvin(3200);
    document.getElementById('dimmerSlider').value = 60; onDimmerChange();
  }, SCR_IDS);
  await page.clock.runFor(200);
  await page.evaluate(async (ids) => {
    const [julie, tv] = ids;
    scrSetTarget({ k: 'screen', id: julie });
    document.getElementById('callName').value = 'Maman';
    await triggerCall();
    scrSetTarget({ k: 'screen', id: tv });
    selectEffect('tv');
    document.getElementById('effectSmoothSlider').value = 40; onEffectParamChange();
  }, SCR_IDS);
  await page.clock.runFor(200);
  await page.evaluate(() => scrSetTarget({ k: 'group', id: _scrReg.groups[0].id }));
  await page.clock.runFor(300);
  if (extra) await extra(page);
});
const E16 = (universe, address) => ({ universe, address, personality: 'extended16' });
// Scènes de navigation (phase 3) : trois écrans en ligne puis le troisième muet depuis plus de 40 s
const navScene = (tab, extra) => multiScreen(async (page) => {
  await page.evaluate((id) => { _pairedScreens.get(id).lastSeen -= 60000; renderLinkStatus(); }, SCR_IDS[2]);
  await page.evaluate((t) => switchTab(t), tab);
  if (extra) await extra(page);
  await page.clock.runFor(300);
});

// ── Tourner sans réseau (maquettes 4, 5 et 10) ──
// Liaison locale simulée côté télécommande : pairs annoncés par la coque, et
// liaison qui a porté les dernières trames de chaque écran.
const linkScene = (links, inet) => (page) => page.evaluate(([ids, links, inet]) => {
  if (!inet) _linkState = 'connecting';
  links.forEach((l, i) => {
    if (l === 'internet') return;
    _linkPeers.set(l + ':p' + i, { key: l + ':p' + i, peer: 'p' + i, mode: l, name: '' });
    _pairedScreens.get(ids[i]).via = { [l]: Date.now() };
  });
  renderLinkStatus();
}, [SCR_IDS, links, inet]);
// Maquette 10 : « Téléphone de Julie » prêt (18 médias, sonnerie, fond
// d'écran, bande son), « TV salon » en cours (64 %), « Tablette cuisine »
// hors ligne, jamais préparée
const offlineScene = (extra) => multiScreen(async (page) => {
  // Internet relié (abonnement, puis délai de grâce des écrans) AVANT de mettre la tablette hors ligne
  await page.evaluate(() => {
    for (const c of window.__mqttClients) if (!c.connected && !c.disconnecting) c._connect();
    // Coque : Wi-Fi local et Bluetooth disponibles (ignoré dans un navigateur)
    window.SRNative.receive({ type: 'link:state', lan: { available: true, active: true }, ble: { available: true, active: true } });
  });
  await page.clock.runFor(100);
  await page.evaluate(async (ids) => {
    const [julie, tv, tab] = ids;
    _mediaPool = Array.from({ length: 18 }, (_, i) => ({ id: 'm' + (i + 1), kind: i < 15 ? 'img' : 'vid', name: 'plan-' + (i + 1), file: null, thumb: null }));
    ringLib = [{ id: '__ring_0123456789abcdef', name: 'sonnerie-prod.m4a', mime: 'audio/mp4', size: 80000, dur: 12, at: 1 }];
    ringSettings.call.sound = '__ring_0123456789abcdef';
    _lockWallData = 'data:image/jpeg;base64,AAAA';
    callList.call = [{ id: 'e1', kind: 'call', style: 'glass', name: 'Maman', hasAudio: true }];
    const au = '__au_' + 'a'.repeat(40);
    _clPrepIds.set('e1', { photo: null, audio: au });
    const all = [..._mediaPool.map((m) => m.id), '__ring_0123456789abcdef', '__lockwall', au];
    for (const id of all) scrState(julie).cached.add(id);
    for (const id of all.slice(0, 12).concat('__ring_0123456789abcdef')) scrState(tv).cached.add(id);
    _pairedScreens.get(tab).lastSeen -= 60000;
    await prepRefreshItems();
  }, SCR_IDS);
  if (extra) await extra(page);
  await page.evaluate(() => { openOfflineView(); });
});

// ── Séquence (maquettes 28 à 32) ──
// « Séq. 12 — « Le message » » : les éléments enregistrés des autres onglets
// (mémoire de couleur, SMS, appel, discussion, média du pool), huit étapes ;
// étapes 1 à 3 jouées, l'appel sonne depuis 4 s.
// Image d'écran d'accueil de test (dégradé de la maquette 32), dessinée dans la page
const seqHomeImage = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, w * 0.55, h);
  gr.addColorStop(0, '#3d5a80'); gr.addColorStop(0.6, '#98c1d9'); gr.addColorStop(1, '#e0fbfc');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.85)';
  for (let i = 0; i < 16; i++) g.fillRect(w * (0.1 + (i % 4) * 0.22), h * (0.12 + Math.floor(i / 4) * 0.12), w * 0.14, w * 0.14);
  return c.toDataURL('image/jpeg', 0.85);
};
// Fond d'écran de test (maquette 42) : dégradé chaud de plage, horizon clair
const seqWallImage = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, w * 0.4, h);
  gr.addColorStop(0, '#e8c9a0'); gr.addColorStop(0.45, '#c9a27a'); gr.addColorStop(1, '#5a3d2b');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, h * 0.42, w, h * 0.02);
  return c.toDataURL('image/jpeg', 0.85);
};
const seqScene = (extra) => multiScreen(async (page) => {
  await page.evaluate(async ([julie, tv, imgFn]) => {
    const T = { k: 'screen', id: julie };
    const img = (0, eval)('(' + imgFn + ')')(90, 160);
    colorMemories = [{ id: 'k1', name: 'ambiance nuit', spec: { kelvin: 3200, tint: 0, dimmer: 40, wheelHex: '#ffffff', crossfade: 0 }, strobe: { active: false, random: false, freq: 2, dur: 50, freqMax: 8, durMax: 200, torch: false } }];
    callList.call = [{ id: 'c1', kind: 'call', style: 'glass', name: 'Maman', label: 'mobile', ring: 'silent', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0 }];
    callList.sms = [
      { id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ?', appName: 'SMS', ring: 'silent', ringVolume: 1, lock: { time: '', date: '' } },
      { id: 's2', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Rappelle-moi stp', appName: 'SMS', ring: 'silent', ringVolume: 1, lock: null },
    ];
    chatSaved = [{ id: 'cm', name: 'Séq. 12 — Maman', contact: 'Maman', actor: 'Julie', style: 'glass', msgs: [{ id: 'd1', from: 'contact', text: 'Rappelle-moi stp' }, { id: 'd2', from: 'actor', text: 'j\'arrive' }], hasPhoto: false, photoSig: null }];
    _mediaPool = [{ id: 'm1', kind: 'img', name: 'photo plage', file: null, thumb: null }];
    const sig = seqImageSig(img);
    await callAssetPut(seqHomeKey(sig), img);
    _seq = { name: 'Séq. 12 — « Le message »', savedId: null, steps: seqSanitizeSteps([
      { id: 'a1', kind: 'color', ref: 'k1', target: T, trig: { k: 'go' } },
      { id: 'a2', kind: 'sms', ref: 's1', target: T, trig: { k: 'go' } },
      { id: 'a3', kind: 'call', ref: 'c1', target: T, trig: { k: 'after', s: 6 } },
      { id: 'a4', kind: 'missed', ref: 'c1', target: T, trig: { k: 'gesture', g: 'hangup', t: 12 } },
      { id: 'a5', kind: 'sms', ref: 's2', target: T, trig: { k: 'after', s: 4 } },
      { id: 'a6', kind: 'unlock', target: T, trig: { k: 'gesture', g: 'touch' }, opt: { code: 4, then: 'home', img: sig, imgName: 'accueil-julie.jpg' } },
      { id: 'a7', kind: 'chat', ref: 'cm', target: T, trig: { k: 'gesture', g: 'unlock' } },
      { id: 'a8', kind: 'media', ref: { id: 'm1', name: 'photo plage', kind: 'img' }, target: { k: 'screen', id: tv }, trig: { k: 'go' }, opt: { end: 'loop' } },
    ]) };
    switchTab('seq');
  }, [SCR_IDS[0], SCR_IDS[1], seqHomeImage.toString()]);
  if (extra) await extra(page);
});
// Onglet Tel, liste enregistrée (maquettes 18, 43) : cinq appels, trois SMS, enregistrés
// par le chemin de l'app ; titles : noms des appels (maquette 43), sinon nom par défaut
const CALL_TITLES = ['Maman — scène 12', 'Agence — appel du matin', 'Inconnu — nuit', 'Hôpital — annonce', 'Julien — rappel'];
const callListScene = (titles, extra) => remote('call', async (page) => {
  await page.evaluate(async (titles) => {
    const photo = (c) => { const k = document.createElement('canvas'); k.width = k.height = 8; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8); return k.toDataURL('image/jpeg', 0.7); };
    let i = 0;
    const add = async (f) => {
      setCallKind(f.kind || 'call'); setCallStyle(f.style); setCallPresent(f.present || 'full');
      document.getElementById('callName').value = f.name;
      document.getElementById('callAutoSlider').value = String(f.auto || 0); onCallAutoChange();
      document.getElementById('lockToggle').checked = !!f.lock;
      _callPhoto = f.photo ? photo(f.photo) : null;
      _callAudioData = f.audio ? 'data:audio/mpeg;base64,AAAA' : null;
      await saveCurrentCall(titles && !f.kind ? titles[i++] : '');
    };
    await add({ name: 'Maman', style: 'glass', photo: '#c08060', audio: true });
    await add({ name: 'Agence immobilière', style: 'tonal', auto: 8 });
    await add({ name: 'Numéro masqué', style: 'minimal' });
    await add({ name: 'Hôpital Saint-Louis', style: 'glass', present: 'banner' });
    await add({ name: 'Julien', style: 'tonal', photo: '#406080' });
    await add({ kind: 'sms', name: 'Léa', style: 'glass', lock: true });
    await add({ kind: 'sms', name: 'Régie', style: 'tonal' });
    await add({ kind: 'sms', name: 'Tom', style: 'minimal' });
    setCallKind('call');
    _callListSel.call = callList.call[0].id;
    setCallListKind('call');
  }, titles || null);
  await scrollTo('callListPanel')(page);
  if (extra) await extra(page);
});
// Faux téléphone sur l'écran de jeu (maquettes 30 à 32) : état tel que l'envoie la télécommande
const SEQ_NOTIFS = [
  { id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Tu es où ?', ago: 125 },
  { id: 'n2', kind: 'missed', app: 'Téléphone', name: 'Appel manqué', msg: 'Maman', ago: 65 },
  { id: 'n3', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Rappelle-moi stp', ago: 0 },
];
// Maquette 44 : notification avec son icône importée (préparée __ph_…), SMS à la
// couleur de leur app, appel manqué aux initiales de l'appelant
const SEQ_ICON_ID = '__ph_' + '4'.repeat(40);
const SEQ_NOTIFS_44 = [
  { id: 'n1', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Tu es où ?', color: '#2d8cff', ago: 125 },
  { id: 'n2', kind: 'missed', app: 'Téléphone', name: 'Appel manqué', msg: 'Maman', who: 'Maman', ago: 65 },
  { id: 'n3', kind: 'sms', app: 'SMS', name: 'Maman', msg: 'Rappelle-moi stp', color: '#2d8cff', ago: 0 },
  { id: 'n4', kind: 'notif', app: 'Banque Atlas', name: 'Virement reçu', msg: 'Vous avez reçu 2 400,00 €.', img: SEQ_ICON_ID, ago: 0 },
];
// Icône d'application de test : carré dégradé bleu, « B » blanc
const seqAppIcon = (n) => {
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, n, n);
  gr.addColorStop(0, '#1e6fd9'); gr.addColorStop(1, '#12b5e8');
  g.fillStyle = gr; g.fillRect(0, 0, n, n);
  g.fillStyle = '#fff'; g.font = '700 ' + Math.round(n * 0.46) + 'px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('B', n / 2, n * 0.54);
  return c.toDataURL('image/png');
};
// Barre d'état de la séquence (phone:state.bar), heure figée 00:10
const SEQ_BAR = { clock: { mode: 'frozen', date: '2026-07-17', time: '00:10' }, net: { bars: 4, type: '5G', plane: false, wifi: true }, bat: { level: 76, charging: false, pct: false } };
// Fond d'écran clair de test (ciel et nuages)
const seqLightWallImage = (w, h) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#bfe0f7'); gr.addColorStop(0.6, '#e8f3f8'); gr.addColorStop(1, '#f6ecd8');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.75)';
  for (const [x, y, r] of [[.2, .3, .09], [.46, .3, .08], [.7, .45, .1], [.58, .47, .12]]) { g.beginPath(); g.ellipse(w * x, h * y, w * r * 1.6, w * r * .6, 0, 0, 7); g.fill(); }
  return c.toDataURL('image/jpeg', 0.9);
};
const screenPhone = (m, after) => async (page) => {
  await joinScreen(page);
  await page.evaluate((m) => screenPhoneState(Object.assign({ unlock: null, home: false, watch: [], chime: null }, m)), m);
  await page.clock.runFor(600);
  if (after) { await after(page); await page.clock.runFor(600); }
};

export const SCENES = {
  'splash': async (page) => { await page.clock.runFor(1000); },
  'screen-connect': async (page) => { await page.evaluate(() => startMode('screen')); await page.clock.runFor(600); },
  'remote-color': remote(null),
  'remote-color-strobe': remote('flash', scrollTo('strobeToggle')),
  'remote-color-rgb': remote(null, async (page) => {
    await page.evaluate(() => { setColorPickMode('rgb'); document.getElementById('rgbBlueSlider').value = 40; onRgbChange(); setCrossfade(70); onCrossfadeChange(); });
  }),
  'remote-effects': remote('effects'),
  'remote-effects-chaser': remote('effects', async (page) => {
    await page.evaluate(() => selectEffect('chaser'));
    await page.clock.runFor(300);
    await scrollTo('effectSettingsPanel')(page);
  }),
  'remote-flash': remote('flash'),
  'remote-media': remote('media'),
  'remote-call': remote('call'),
  'remote-call-sms': remote('call', (page) => page.evaluate(() => { setCallKind('sms'); setCallStyle('tonal'); })),
  // 24 · Notification d'application : écran verrouillé, heure du téléphone, reçue il y a 15 min
  'remote-call-notif': remote('call', async (page) => {
    await page.evaluate(() => {
      setCallKind('notif'); setNotifPresent('lock');
      document.getElementById('ntPhoneDate').value = '2025-10-17'; document.getElementById('ntPhoneTime').value = '14:32';
      setNotifReceived('ago');
    });
    await scrollTo('callkind-call', 80)(page);
  }),
  // 36f · Vue « Style et son » de la notification : style, fond, son de notification propre (indépendant des SMS), vibreur
  'remote-call-notif-sound': remote('call', async (page) => {
    await page.evaluate(() => { setCallKind('notif'); setCallRing('digital'); openTelStyle(); });
    await scrollView('callRingPanel', 200)(page);
  }),
  // 36f · Rangée « Style et son » sous « Envoyer la notification » (plus de tuiles)
  'remote-call-notif-style': remote('call', async (page) => {
    await page.evaluate(() => { setCallKind('notif'); setTelVib(true); });
    await scrollTo('ntShowPanel', 80)(page);
  }),
  // 36b · Vue « Style et sonnerie » de l'appel : aperçu (vibreur), style, présentation, photo, sonnerie, vibreur
  'remote-call-style': remote('call', (page) => page.evaluate(() => { setTelVib(true); openTelStyle(); })),
  // 36d · Discussion : rangée « Style et son » (son des messages, vibreur), contact « Enregistrés (n) › »
  'remote-call-discussion-style': remote('call', async (page) => {
    await page.evaluate(() => {
      callers = [{ id: 'p1', name: 'Maman', label: 'mobile', hasPhoto: false, photoSig: null }, { id: 'p2', name: 'Agence immobilière', label: 'bureau', hasPhoto: false, photoSig: null }];
      setCallKind('discussion'); setCallRing('soft'); setTelVib(true);
    });
    await scrollTo('callkind-call', 80)(page);
  }),
  // 36e · Appelants enregistrés (SMS) : l'appelant du formulaire en orange, « + Enregistrer » de l'actuel
  'remote-call-callers': remote('call', async (page) => {
    await page.evaluate(async () => {
      const k = document.createElement('canvas'); k.width = k.height = 8; const g = k.getContext('2d'); g.fillStyle = '#8a6a5a'; g.fillRect(0, 0, 8, 8);
      const photo = k.toDataURL('image/jpeg', 0.7);
      setCallKind('sms');
      const add = async (name, label, p) => { document.getElementById('callName').value = name; document.getElementById('callLabel').value = label; _callPhoto = p; await saveCurrentCaller(); };
      await add('Maman', 'mobile', photo); await add('Agence immobilière', 'bureau', null); await add('Numéro masqué', '', null);
      document.getElementById('callName').value = 'Maman'; document.getElementById('callLabel').value = 'mobile'; _callPhoto = null;
      openCallersSheet();
    });
    await page.clock.runFor(100);
  }),
  // 26 · Discussion : 2 messages postés, réponse de Julie en frappe sur l'écran (14 / 26)
  'remote-call-discussion': multiScreen(async (page) => {
    await page.evaluate((julie) => {
      switchTab('call'); setCallKind('discussion');
      scrSetTarget({ k: 'screen', id: julie });
      openChatOnTarget(); sendNextChatMessage(); sendNextChatMessage();
      _chat.progress = { id: 'd3', typed: 14, total: 26 }; renderChatPanel();
    }, SCR_IDS[0]);
    await scrollTo('dcContactPanel', 80)(page);
  }),
  // 26b · « Reprendre ici » au n° 3 : 1 et 2 affichés comme historique, repère orange, bouton « ↶ »
  'remote-call-discussion-resume': multiScreen(async (page) => {
    await page.evaluate((julie) => {
      switchTab('call'); setCallKind('discussion');
      scrSetTarget({ k: 'screen', id: julie });
      openChatOnTarget(); resumeChatAt('d3');
    }, SCR_IDS[0]);
    await scrollTo('dcThreadPanel', 84)(page);
  }),
  // 26c / 4d · Discussions enregistrées (liste sous le fil, ▶ charge) : quatre entrées, la première chargée dans le fil
  'remote-call-discussion-saved': remote('call', async (page) => {
    await page.evaluate(() => {
      const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + (i + 1), from: i % 2 ? 'actor' : 'contact', text: 'Message ' + (i + 1) }));
      const e = (id, name, contact, actor, style, n) => ({ id, name, contact, actor, style, msgs: msgs(n), hasPhoto: false, photoSig: null });
      chatSaved = [
        e('c12', 'Séq. 12 — Maman inquiète', 'Maman', 'Julie', 'glass', 7), e('c14', 'Séq. 14 — Rupture', 'Thomas', 'Julie', 'minimal', 11),
        e('c21', 'Séq. 21 — Agence', 'Agence Riviera', 'Marc', 'tonal', 4), e('c30', 'Séq. 30 — Groupe famille', 'Papa', 'Julie', 'minimal', 9),
      ];
      _chat.savedId = 'c12';
      setCallKind('discussion');
    });
    await scrollTo('dcSavedPanel', 80)(page);
  }),
  // 12 · Sonnerie de l'appel : sons intégrés, « Vos sonneries », volume, bande son au décroché
  'remote-call-ring': ringScene('call'),
  // Son de notification d'un SMS (même bibliothèque, choix propre au type, sans décroché)
  'remote-call-ring-sms': ringScene('sms'),
  'remote-qr': remote('qr'),
  // Liaison établie, deux écrans appairés dont un muet depuis plus de 40 s
  'remote-qr-screens': remote('qr', async (page) => {
    await page.evaluate(() => {
      setConnStatus('connected');
      remoteNoteScreen('sAAAAAAAA', { type: 'caps', screenId: 'ScreenOne0000001' });
      remoteNoteScreen('sBBBBBBBB', { type: 'caps', screenId: 'ScreenTwo0000002' });
      _pairedScreens.get('ScreenTwo0000002').lastSeen -= 60000;
      renderLinkStatus();
    });
    await scrollTo('pairScreens')(page);
  }),
  // Trames authentiques refusées comme périmées : horloge d'un appareil décalée
  'remote-clock-skew': remote(null, (page) => page.evaluate(() => { setConnStatus('connected'); setClockSkewed(true); })),
  'remote-pair-verify': remote('qr', (page) => page.evaluate(() => showPairVerify('remote', '482917', () => {}))),
  'screen-pair-verify': async (page) => {
    await page.evaluate(() => startMode('screen'));
    await page.evaluate(() => { document.getElementById('pairCodeInput').value = 'K7M-4QP'; showPairVerify('screen', '482917', () => {}); });
    await page.clock.runFor(600);
  },
  'screen-call-glass': screenCall({ kind: 'call', style: 'glass', name: 'Maman', label: 'mobile' }),
  'screen-call-tonal-banner': screenCall({ kind: 'call', style: 'tonal', name: 'Agent Martin', label: 'Bureau', present: 'banner' }),
  'screen-incall-tonal': screenCall({ kind: 'call', style: 'tonal', name: 'Maman' }, (page) => page.evaluate(() => screenCallAnswer())),
  'screen-incall-glass': screenCall({ kind: 'call', style: 'glass', name: 'Maman' }, (page) => page.evaluate(() => screenCallAnswer())),
  'screen-sms-lock-minimal': screenCall({ kind: 'sms', style: 'minimal', name: 'Léa', msg: 'Tu es où ??', lock: { time: '', date: '' } }),
  // 25 · Notification d'application sur le faux écran verrouillé (heure du téléphone imposée, reçue il y a 15 min)
  'screen-notif-lock-glass': screenCall({ ...NOTIF, style: 'glass', present: 'lock' }),
  // Notification en bandeau sur un écran allumé (reçue à une date et une heure : « hier »)
  'screen-notif-banner-tonal': screenCall({ ...NOTIF, style: 'tonal', present: 'banner', received: { mode: 'at', date: '2025-10-16', time: '18:05' } }),
  'screen-notif-banner-minimal': screenCall({ ...NOTIF, style: 'minimal', present: 'banner', received: { mode: 'now' } }),
  // 27 · Discussion : messages du contact postés, réponse du comédien en cours de frappe
  'screen-discussion-minimal': screenChat('minimal'),
  'screen-discussion-glass': screenChat('glass'),
  'screen-discussion-tonal': screenChat('tonal'),
  // Accès à la passerelle (onglet QR, app native seulement)
  'remote-qr-dmx-entry': remote('qr', async (page) => {
    await page.evaluate(() => { setConnStatus('connected'); remoteNoteScreen('sAAAAAAAA', { type: 'caps', screenId: 'ScreenOne0000001' }); renderLinkStatus(); });
    await scrollTo('gwEntryBtn')(page);
  }),
  // ── Phase 3 : navigation. Trois écrans (dont un hors ligne : badge « 1 » de l'onglet Écrans), effet TV en cours ──
  'nav-light-color': navScene('color'),
  'nav-light-flash': navScene('flash'),
  'nav-scenario-tel': navScene('call'),
  'nav-scenario-seq': navScene('seq', (page) => page.evaluate(() => { _seq = { name: 'Séq. 12', savedId: null, steps: [] }; renderSeq(); })),
  'nav-screens': navScene('screens'),
  // En-tête avec la barre « Stroboscope actif · 2 Hz · +1 » et « Tout arrêter »
  'nav-header-strip': navScene('color', (page) => page.evaluate(() => { setFlashWarningSkipped(true); document.getElementById('strobeToggle').checked = true; onStrobeToggle(); })),
  'nav-target-sheet': navScene('color', (page) => page.evaluate(() => openTargetSheet())),
  'nav-screen-sheet': navScene('screens', (page) => page.evaluate((id) => openScreenSheet(id), SCR_IDS[1])),
  'nav-rail-tablet': navScene('color'),
  'nav-rail-landscape': navScene('color'),
  // 14 · Passerelle : univers 1 reçu (≈ 44 Hz), univers 2 perdu depuis 6 s
  'dmx-gateway': gateway(async (page) => {
    await patchAll(page, [E16(1, 1), E16(1, 17), E16(2, 1)]);
    const u1 = [204, 0, 255, 180, 96, 82, 128, 40];
    await feed(page, [pkt(1, u1), pkt(2, [255])]);
    for (let i = 0; i < 10; i++) { await page.clock.runFor(500); await feed(page, [pkt(1, u1)]); }
    await feed(page, Array.from({ length: 43 }, () => pkt(1, u1)));
    await page.clock.runFor(1000);
    await feed(page, [pkt(1, u1)]);
    await page.evaluate(() => gwRender());
  }),
  // Navigateur seul : la passerelle demande l'app
  'dmx-gateway-browser': remote(null, (page) => page.evaluate(() => openDmxGateway())),
  // 15 · Patch : « Écran 3 » (21–36) chevauche « Écran 2 » (17–32)
  'dmx-patch': gateway(async (page) => {
    await patchAll(page, [E16(1, 1), E16(1, 17), E16(1, 21)]);
    await page.evaluate(() => gwShowView('patch'));
  }),
  // 16 · Écran patché sous la console : les 16 canaux, valeurs et sens
  'dmx-monitor': gateway(async (page) => {
    await patchAll(page, [E16(1, 1), E16(1, 17), E16(1, 33)]);
    const slots = new Array(48).fill(0);
    [204, 0, 255, 180, 96, 82, 128, 40, 0, 0, 0, 30, 0, 0, 0, 0].forEach((v, i) => { slots[16 + i] = v; });
    await feed(page, [pkt(1, slots)]);
    await page.evaluate((id) => gwOpenMonitor(id), DMX_IDS[1]);
  }),
  // 17 · Table des canaux (Étendu 16)
  'dmx-channels': gateway(async (page) => {
    await patchAll(page, [E16(1, 1)]);
    await page.evaluate(() => gwOpenChannels('extended16'));
  }),
  // 18 · Onglet Appel : appels et SMS numérotés (plages DMX)
  'remote-call-list': callListScene(),
  // 43 · Entrées nommées ; la n° 1, chargée : « Mettre à jour » / « Enregistrer comme nouveau »
  'remote-call-list-loaded': callListScene(CALL_TITLES, async (page) => {
    await page.evaluate(() => selectCallEntry(callList.call[0].id));
    await scrollTo('callListRows', 60)(page);
  }),
  // 43b · Nommer l'enregistrement (sixième appel : n° 6, DMX 60–69)
  'remote-call-list-name': callListScene(null, async (page) => {
    await page.evaluate(() => {
      document.getElementById('callName').value = 'Maman';
      openSaveCallSheet();
      document.getElementById('srName').value = 'Maman — scène 12';
    });
  }),
  // 43c · Menu « ⋯ » d'une entrée nommée
  'remote-call-list-menu': callListScene(CALL_TITLES, (page) => page.evaluate(() => openCallEntryMenu(callList.call[0].id))),
  // 11 · Avertissement stroboscope : interrupteur ouvert derrière la boîte
  'remote-strobe-warning': remote('flash', async (page) => {
    await scrollTo('strobeToggle', 96)(page);
    await page.evaluate(() => { document.getElementById('strobeToggle').checked = true; onStrobeToggle(); });
  }),
  // 13 · Réglages (engrenage de l'en-tête)
  'remote-settings': remote(null, (page) => page.evaluate(() => openSettings())),
  // 45 · Réglages : carte « Projet » (projet ouvert, compteurs, exporter, importer, dernier export)
  'remote-project': projectScene((page) => page.evaluate(async () => { await projectNoteExport(null, 'Tournage B.rem'); openSettings(); })),
  // 45b · Exporter le projet : sections cochées, Mémoires décochée (avertissement « introuvables »), taille estimée
  'remote-project-export': projectScene((page) => page.evaluate(async () => {
    openSettings(); await openProjectExport(); projectExportToggle('memories');
  })),
  // 45c · Aperçu de l'import « tournage-b.rem » : sections, mode « Ajouter à mes données »
  'remote-project-import': projectScene(async (page) => {
    await projectFile(page);
    await page.evaluate(async () => { openSettings(); await projectImportFile(window.__rem); });
  }),
  // 45c · Mode « Remplacer » : ce qui sera supprimé, sonneries comprises
  'remote-project-import-replace': projectScene(async (page) => {
    await projectFile(page);
    await page.evaluate(async () => {
      openSettings(); await projectImportFile(window.__rem); projectImportMode('replace');
      const v = document.getElementById('project-view'); v.scrollTop = v.scrollHeight;
    });
  }),
  // 45d · Compte rendu : ajouté au projet ouvert (doublons renommés « (2) », appelants déjà là)
  'remote-project-report': projectScene(async (page) => {
    await projectFile(page);
    await page.evaluate(async () => { openSettings(); await projectImportFile(window.__rem); await projectImportGo(); });
  }),
  // 45e · Fichier non reconnu : rien n'a été modifié
  'remote-project-error': projectScene((page) => page.evaluate(async () => {
    openSettings();
    await projectImportFile(new File(['ceci n\'est pas un projet, juste un texte assez long'], 'vacances.zip', { type: 'application/zip' }));
  })),
  // 46 · Projets : projet ouvert en orange, « ⋯ », nouveau projet, importer
  'remote-projects': projectScene(async (page) => {
    await projectMore(page);
    await page.evaluate(async () => { openSettings(); await openProjectsView(); });
  }),
  // 46 · Menu « ⋯ » d'un projet rangé
  'remote-projects-menu': projectScene(async (page) => {
    await projectMore(page);
    await page.evaluate(async () => { openSettings(); await openProjectsView(); openProjectMenu(_pju.list.list[1].id); });
  }),
  // 46b · Nouveau projet : nom, « Vide » / « À partir du projet actuel »
  'remote-projects-new': projectScene(async (page) => {
    await projectMore(page);
    await page.evaluate(async () => { openSettings(); await openProjectsView(); openNewProjectSheet(); document.getElementById('srName').value = 'Tournage C'; });
  }),
  // 46c · Ouvrir un autre projet : confirmation
  'remote-projects-open': projectScene(async (page) => {
    await projectMore(page);
    await page.evaluate(async () => { openSettings(); await openProjectsView(); askOpenProject(_pju.list.list[1].id); });
  }),
  // Réglages : anglais choisi (note « bientôt ») et avertissement désactivé pour la session
  'remote-settings-en': remote(null, (page) => page.evaluate(() => { setFlashWarningSkipped(true); openSettings(); setAppLanguage('en'); })),
  // Politique de confidentialité ouverte depuis les Réglages (page embarquée)
  'remote-privacy': remote(null, async (page) => {
    await page.evaluate(() => { openSettings(); openPrivacyPolicy(); });
    await policyFrameReady(page, 'confidentialite.html');
  }),
  // Page publique de la politique, thème clair du système
  'privacy-light': async (page) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(new URL('confidentialite.html', page.url()).href);
    await page.evaluate(() => document.fonts.ready);
  },
  // 5 · Écrans connectés & groupes
  'remote-screens': multiScreen((page) => page.evaluate(() => openScreensView())),
  // 6 · Choisir la cible (feuille), et le bouton « Cible » sous l'aperçu
  'remote-target': multiScreen((page) => page.evaluate(() => openTargetSheet())),
  'remote-target-chip': multiScreen(),
  // Groupe : nom et écrans membres ; renommer un écran (feuilles, même présentation que la maquette 6)
  'remote-group-edit': multiScreen((page) => page.evaluate(() => { openScreensView(); openGroupEditor(_scrReg.groups[0].id); })),
  'remote-screen-rename': multiScreen((page) => page.evaluate((id) => { openScreensView(); openRenameScreen(id); }, SCR_IDS[1])),
  // 5b · Retirer « Tablette cuisine » : confirmation (tous les autres écrans ont leur clé)
  'remote-revoke-confirm': multiScreen((page) => page.evaluate((ids) => {
    for (const id of ids) _scrReg.screens.get(id).pk = { s: 'A'.repeat(43), kid: 'kkkkkkkkkkk', ok: true };
    openScreensView();
    openRevokeDialog(ids[2]);
  }, SCR_IDS)),
  // Confirmation quand un écran (ancienne version, sans clé par écran) ne pourra pas suivre
  'remote-revoke-lost': multiScreen((page) => page.evaluate((ids) => {
    _scrReg.screens.get(ids[1]).pk = { s: 'A'.repeat(43), kid: 'kkkkkkkkkkk', ok: true };
    openScreensView();
    openRevokeDialog(ids[2]);
  }, SCR_IDS)),
  // 10 · Tourner sans réseau : liaison Auto, préparation (Prêt / 64 % / Non préparé)
  'remote-offline': offlineScene((page) => page.evaluate((tv) => {
    _prep = { running: true, targets: [tv], cur: { id: 'm13', sids: [tv], fracOf: () => 0.44 }, failed: new Set() };
  }, SCR_IDS[1])),
  // Navigateur seul : Wi-Fi local et Bluetooth demandent l'app ; préparation par Internet
  'remote-offline-browser': offlineScene(),
  // 5 · Liaison de chaque écran : Internet, Wi-Fi local, Bluetooth
  'remote-screens-links': multiScreen(async (page) => {
    await linkScene(['internet', 'lan', 'ble'], true)(page);
    await page.evaluate(() => openScreensView());
  }),
  // 4 · Pastille « Wi-Fi local » (Internet perdu) et « Bluetooth » (commandes seulement)
  'remote-link-lan': multiScreen(linkScene(['lan', 'lan', 'lan'], false)),
  'remote-link-ble': multiScreen(linkScene(['lan', 'ble', 'lan'], false)),
  // 5c · Écran de jeu retiré par la télécommande
  'screen-revoked': async (page) => {
    await joinScreen(page);
    await page.clock.runFor(300);
    await page.evaluate(() => screenOnRevoked({ type: 'screen:revoked' }));
    await page.clock.runFor(300);
  },
  // Écran de jeu nommé par la télécommande : son nom dans son menu
  'screen-menu-named': async (page) => {
    await joinScreen(page);
    await page.evaluate(() => { screenApplyConfig({ type: 'screen:config', name: 'TV salon', groups: [] }); openScreenMenu(); });
    await page.clock.runFor(300);
  },
  // 28 · Séquence en Préparer : huit étapes, 1 à 3 jouées (repères), l'appel sonne depuis 4 s
  'remote-seq': seqScene(async (page) => {
    await page.evaluate(async () => { seqGo(); seqGo(); seqGo(); await _seqChain; });
    await page.clock.runFor(4000); // sans défilement : la mini-carte collante ne s'en mêle pas (rendu stable)
  }),
  // 29 · Éditer l'étape 6 : code 4 chiffres, puis écran d'accueil (image), au toucher de l'écran, téléphone de Julie
  'remote-seq-step': seqScene((page) => page.evaluate(async () => { openSeqStep('a6'); await _seqPaintHomeThumb(_seqEdit.step.opt.img); })),
  // 30 · Écran verrouillé : trois notifications empilées, la plus récente en haut
  // 44 · Icône importée de la notification, SMS à la couleur de leur app, appel manqué aux initiales
  'screen-seq-lock': async (page) => {
    await joinScreen(page);
    await page.evaluate(([imgFn, id, notifs]) => {
      _mediaCache.set(id, { kind: 'img', data: (0, eval)('(' + imgFn + ')')(80) });
      screenPhoneState({ mode: 'locked', style: 'glass', notifs, unlock: { code: 4, then: 'home' }, home: false, watch: [], chime: null });
    }, [seqAppIcon.toString(), SEQ_ICON_ID, SEQ_NOTIFS_44]);
    await page.clock.runFor(600);
  },
  // 31 · Pavé du code : deux touches, deux points remplis
  'screen-seq-code': screenPhone({ mode: 'code', style: 'glass', notifs: SEQ_NOTIFS, unlock: { code: 4, then: 'home' } }, (page) => page.evaluate(() => { _spKey(); _spKey(); })),
  // 42 · Écran verrouillé sur le fond d'écran de la séquence (__seqwall), sous le voile
  'screen-seq-lock-wall': async (page) => {
    await joinScreen(page);
    await page.evaluate(([imgFn, notifs]) => {
      _mediaCache.set('__seqwall', { kind: 'img', data: (0, eval)('(' + imgFn + ')')(390, 844) });
      screenPhoneState({ mode: 'locked', style: 'glass', notifs, unlock: { code: 4, then: 'home' }, home: false, wall: true, watch: [], chime: null });
    }, [seqWallImage.toString(), SEQ_NOTIFS]);
    await page.clock.runFor(600);
  },
  // 32 · Écran d'accueil : image importée, plein écran
  'screen-seq-home': async (page) => {
    await joinScreen(page);
    await page.evaluate((imgFn) => {
      _mediaCache.set('__seqhome', { kind: 'img', data: (0, eval)('(' + imgFn + ')')(390, 844) });
      screenPhoneState({ mode: 'home', style: 'glass', notifs: [], unlock: null, home: true, watch: ['home'], chime: null });
    }, seqHomeImage.toString());
    await page.clock.runFor(600);
  },
  // 28b · Téléphone au départ : l'heure avance depuis ven. 17 oct. 2026 23:47, 2 barres 4G, Wi-Fi, 18 % affiché
  'remote-seq-phone': seqScene((page) => page.evaluate(() => {
    _seq.phone = { clock: { mode: 'run', date: '2026-10-17', time: '23:47' }, net: { bars: 2, type: '4G', plane: false, wifi: true }, bat: { level: 18, charging: false, pct: true } };
    openPhoneParams('seq');
  })),
  // 42 · Téléphone au départ : fond d'écran choisi (vignette, nom, CHANGER… / RETIRER)
  'remote-seq-phone-wall': seqScene(async (page) => {
    await page.evaluate(async (imgFn) => {
      const img = (0, eval)('(' + imgFn + ')')(180, 320);
      const sig = seqImageSig(img);
      await callAssetPut(seqHomeKey(sig), img);
      _seq.wall = { img: sig, name: 'plage-julie.jpg' };
      _seq.phone = { clock: { mode: 'frozen', date: '2026-07-17', time: '14:32' }, net: { bars: 4, type: '4G', plane: false, wifi: true }, bat: { level: 80, charging: false, pct: true } };
      openPhoneParams('seq');
      await _seqHomeData(sig);
    }, seqWallImage.toString());
    await page.clock.runFor(100);
    await page.evaluate(() => { const v = document.getElementById('phone-params-view'); v.scrollTop = v.scrollHeight; });
  }),
  // 41 · Étape Discussion : lecture « tout automatique » (trois choix, note avec le comédien)
  'remote-seq-step-chat': seqScene(async (page) => {
    await page.evaluate(() => {
      _seq.steps.find((s) => s.id === 'a7').opt = { auto: true, full: true };
      openSeqStep('a7');
      const v = document.getElementById('seq-step-view');
      v.scrollTop += document.getElementById('ssRefCard').getBoundingClientRect().top - 360;
    });
  }),
  // 29b · Étape « Veille » en tête de séquence : se rallume aux notifications et au toucher, se rendort après 8 s
  'remote-seq-step-sleep': seqScene((page) => page.evaluate(() => {
    _seq.steps.unshift(seqSanitizeStep({ id: 'a0', kind: 'sleep', target: _seq.steps[0].target, trig: { k: 'go' }, opt: { notif: true, touch: true, after: 8 } }));
    openSeqStep('a0');
  })),
  // 47 · « Nouvelle séquence » : bouton visible sous la carte de séquence (Préparer)
  'remote-seq-new': seqScene(scrollTo('seqNewBtn', 120)),
  // 47 · Séquence modifiée : « Enregistrer « … » avant ? » (Enregistrer / Ne pas enregistrer / Annuler)
  'remote-seq-new-ask': seqScene(async (page) => {
    await scrollTo('seqNewBtn', 120)(page);
    await page.evaluate(() => seqNewAsk());
  }),
  // 46c · Refus : une séquence est lancée sur les écrans, pas d'autre projet
  'remote-projects-busy': seqScene(async (page) => {
    await page.evaluate(async () => {
      seqGo(); await _seqChain;
      await projectsInit(); await projectRename(projectActiveId(), 'Tournage B'); await projectCreate({ name: 'Mon projet' });
      openSettings(); await openProjectsView(); askOpenProject(_pju.list.list[1].id);
    });
  }),
  // 47b · « Nouvelle discussion » : ⋯ du titre « Fil » (menu : nouvelle, enregistrer, repartir de zéro, fermer)
  'remote-call-discussion-new': remote('call', async (page) => {
    await page.evaluate(() => { setCallKind('discussion'); openChatThreadMenu(); });
    await scrollTo('dcThreadPanel', 84)(page);
  }),
  // 47b · Fil modifié depuis son entrée enregistrée : « Enregistrer « … » avant ? »
  'remote-call-discussion-new-ask': remote('call', async (page) => {
    await page.evaluate(async () => {
      chatSaved = [{ id: 'c12', name: 'Séq. 12 — Maman inquiète', contact: 'Maman', actor: 'Julie', style: 'glass', msgs: [{ id: 'm1', from: 'contact', text: 'Tu es où ?' }], hasPhoto: false, photoSig: null }];
      _chat.savedId = 'c12';
      setCallKind('discussion'); setChatView('thread');
    });
    await scrollTo('dcThreadPanel', 84)(page);
    await page.evaluate(() => chatNewAsk());
  }),
  // 26d · Timings du fil et lecture automatique : messages 1 et 2 postés, le n° 3 (texte automatique en 4 s) en cours
  'remote-call-discussion-timing': multiScreen(async (page) => {
    await page.evaluate((julie) => {
      switchTab('call'); setCallKind('discussion');
      scrSetTarget({ k: 'screen', id: julie });
      const m = (id, from, text, pause, write, auto, send) => ({ id, from, text, pause, write, auto, send });
      _chat.msgs = [
        m('d1', 'contact', 'Tu es où ?', 2, 3, false, 'auto'), m('d2', 'contact', 'Ton père t\'attend depuis une heure', 4, 5, false, 'auto'),
        m('d3', 'actor', 'je suis chez Léa, j\'arrive', 1, 4, true, 'auto'), m('d4', 'contact', 'Je t\'ai vue avec lui.', 6, 4, false, 'auto'),
      ];
      openChatOnTarget();
      _chat.sent = ['d1', 'd2'];
      _chatTimingId = 'd3'; // message touché : ses timings sous le fil
      chatAutoStart();
    }, SCR_IDS[0]);
    await scrollTo('dcThreadPanel', 84)(page);
  }),
  // 33 · Batterie faible : alerte sur l'écran verrouillé, icône rouge, heure figée à 23:47
  'screen-seq-battery': screenPhone({
    mode: 'locked', style: 'glass', notifs: [], alert: { id: 'b1', level: 5 },
    bar: { clock: { mode: 'frozen', date: '2026-10-17', time: '23:47' }, net: { bars: 3, type: '4G', plane: false, wifi: false }, bat: { level: 5, charging: false, pct: false } },
  }),
  // 34 · Pas de réseau : « Pas de service », appel impossible, message non envoyé
  'screen-seq-nonetwork': screenPhone({
    mode: 'locked', style: 'glass',
    notifs: [
      { id: 'n1', kind: 'sms', app: 'SMS', name: 'Message non envoyé', msg: '« j\'arrive » — Toucher pour réessayer', ago: 40 },
      { id: 'n2', kind: 'missed', app: 'Téléphone', name: 'Appel impossible', msg: 'Aucun réseau disponible.', ago: 0 },
    ],
    bar: { clock: { mode: 'frozen', date: '2026-10-17', time: '23:47' }, net: { bars: 0, type: '4G', plane: false, wifi: false }, bat: { level: 52, charging: false, pct: false } },
  }),
  // 44b · Réseau perdu : alerte « Aucun réseau » (même allure que « Batterie faible »)
  'screen-seq-nonetwork-popup': screenPhone({
    mode: 'locked', style: 'glass', notifs: [], alert: { id: 'r1', kind: 'net' },
    bar: { clock: { mode: 'frozen', date: '2026-10-17', time: '23:47' }, net: { bars: 0, type: '4G', plane: false, wifi: false }, bat: { level: 52, charging: false, pct: false } },
  }),
  // Barre d'état en bandeau au-dessus d'un média du pool (photo), réglée dans l'onglet Média
  'screen-media-statusbar': async (page) => {
    await joinScreen(page);
    await page.evaluate((imgFn) => {
      _mediaCache.set('m1', { kind: 'img', data: (0, eval)('(' + imgFn + ')')(390, 844) });
      screenShowCached('m1');
      screenMediaBar({ clock: { mode: 'run', date: '2026-10-17', time: '08:05', el: 0 }, net: { bars: 4, type: '5G', plane: false, wifi: true }, bat: { level: 76, charging: false, pct: true } });
    }, seqHomeImage.toString());
    await page.clock.runFor(600);
  },
  // ── Phase 5 : faux téléphone harmonisé (71-phone-ui.js, 79-phone-ui.css) ──
  // Fond d'écran clair : voile et cartes denses (texte ≥ 4,5:1), barre d'état
  'screen-seq-lock-light': async (page) => {
    await joinScreen(page);
    await page.evaluate(([imgFn, notifs, bar]) => {
      _mediaCache.set('__seqwall', { kind: 'img', data: (0, eval)('(' + imgFn + ')')(390, 844) });
      screenPhoneState({ mode: 'locked', style: 'glass', notifs, unlock: { code: 4, then: 'home' }, home: false, wall: true, watch: [], chime: null, bar });
    }, [seqLightWallImage.toString(), SEQ_NOTIFS, SEQ_BAR]);
    await page.clock.runFor(600);
  },
  // Accueil générique (aucune image) : icônes neutres, widgets, dock ; barre d'état
  'screen-seq-home-generic': screenPhone({ mode: 'home', style: 'glass', notifs: [], unlock: null, watch: ['home'], bar: SEQ_BAR }),
  // Accueil : l'image de l'utilisateur sert de fond d'écran sous les icônes génériques (Tonal)
  'screen-seq-home-wall': async (page) => {
    await joinScreen(page);
    await page.evaluate(([imgFn, bar]) => {
      _mediaCache.set('__seqhome', { kind: 'img', data: (0, eval)('(' + imgFn + ')')(390, 844) });
      screenPhoneState({ mode: 'home', style: 'tonal', notifs: [], unlock: null, home: true, homeWall: true, watch: ['home'], chime: null, bar });
    }, [seqWallImage.toString(), SEQ_BAR]);
    await page.clock.runFor(600);
  },
  // Discussion (Verre) avec la barre d'état de la séquence
  'screen-discussion-statusbar': async (page) => {
    await screenChat('glass')(page);
    await page.evaluate((bar) => screenSeqBar(bar), SEQ_BAR);
    await page.clock.runFor(300);
  },
  // Appel entrant (Épuré) avec la barre d'état
  'screen-call-minimal-statusbar': async (page) => {
    await screenCall({ kind: 'call', style: 'minimal', name: 'Maman', label: 'mobile' })(page);
    await page.evaluate((bar) => screenSeqBar(bar), SEQ_BAR);
    await page.clock.runFor(300);
  },
  // Pavé du code en paysage (Épuré), deux touches
  'screen-seq-code-landscape': screenPhone({ mode: 'code', style: 'minimal', notifs: [], unlock: { code: 4, then: 'home' }, bar: SEQ_BAR }, (page) => page.evaluate(() => { _spKey(); _spKey(); })),
  'screen-effect-police': async (page) => {
    await joinScreen(page);
    await page.evaluate(() => receiveEffect({ name: 'police', active: true, params: { speed: 3, intensity: 100, chaos: 0, drift: 0 } }));
    await page.clock.runFor(250);
  },
  // ── Licence, version officielle (maquettes 39, 39b, 37, 37b ; sans compteur du jour) ──
  'remote-call-preview': licScene('call'),
  'remote-seq-preview': licScene('seq'),
  'remote-settings-licence': licScene(null, (page) => page.evaluate(() => openSettings())),
  'remote-settings-licence-active': licScene(null, (page) => page.evaluate(() => openSettings())),
  // ── Garde-fous du plateau ──
  // Accueil (en-tête) : confirmation avant de tout arrêter
  'remote-home-confirm': remote(null, (page) => page.evaluate(() => askGoBack())),
  // Nouvelle étape modifiée puis « ← Séquence » : abandon confirmé
  'remote-seq-step-leave': seqScene((page) => page.evaluate(() => { openSeqStep(null); seqEditKind('sms'); seqStepLeave(); })),
  // Paysage (844 × 390, SCENE_VIEWPORT) : Accepter / Refuser entiers, notifications de l'écran verrouillé visibles
  'screen-call-glass-landscape': screenCall({ kind: 'call', style: 'glass', name: 'Maman', label: 'mobile' }),
  'screen-incall-tonal-landscape': screenCall({ kind: 'call', style: 'tonal', name: 'Maman' }, (page) => page.evaluate(() => screenCallAnswer())),
  'screen-notif-lock-glass-landscape': screenCall({ ...NOTIF, style: 'glass', present: 'lock' }),
  'screen-seq-lock-landscape': async (page) => {
    await joinScreen(page);
    await page.evaluate(([imgFn, id, notifs]) => {
      _mediaCache.set(id, { kind: 'img', data: (0, eval)('(' + imgFn + ')')(80) });
      screenPhoneState({ mode: 'locked', style: 'glass', notifs, unlock: { code: 4, then: 'home' }, home: false, watch: [], chime: null });
    }, [seqAppIcon.toString(), SEQ_ICON_ID, SEQ_NOTIFS_44]);
    await page.clock.runFor(600);
  },
};
// ── Phase 4 : Tel « composer puis envoyer » et Séquence « Préparer / Plateau » (maquettes 4a à 4i) ──
// Tel : trois appels (le premier chargé), un SMS, une notification, une discussion ; cible : Téléphone de Julie
const telScene = (extra) => multiScreen(async (page) => {
  await page.evaluate(async (julie) => {
    telCallPhase('idle', ''); // l'appel lancé par multiScreen ne laisse pas la barre en « Raccrocher / Décrocher »
    scrSetTarget({ k: 'screen', id: julie });
    const call = (id, name, title, meta) => Object.assign({ id, kind: 'call', style: 'glass', name, label: 'mobile', title, ring: 'classic', ringVolume: 1, present: 'full', photoMode: 'avatar', autoAnswer: 0, lock: null, hasPhoto: false, hasAudio: false }, meta);
    callList.call = [
      call('e1', 'Maman', 'Maman — scène 12', { hasAudio: true }),
      call('e2', 'Agence', 'Agence — appel du matin', { style: 'tonal', autoAnswer: 8 }),
      call('e3', 'Inconnu', 'Inconnu — nuit', { style: 'minimal' }),
      call('e4', 'Hôpital', 'Hôpital — annonce', { present: 'banner' }),
      call('e5', 'Julien', 'Julien — rappel', { style: 'tonal' }),
    ];
    callList.sms = [
      { id: 's1', kind: 'sms', style: 'glass', name: 'Maman', msg: 'Tu es où ??', title: 'Maman — « Tu es où ?? »', appName: 'SMS', appColor: '#2f8cf0', ring: 'classic', ringVolume: 0.6, lock: { time: '00:10', date: '' }, hasPhoto: false, hasAudio: false },
      { id: 's2', kind: 'sms', style: 'tonal', name: 'Régie', msg: 'Retard de 10 min', title: 'Régie — « Retard de 10 min »', appName: 'SMS', appColor: '#2f8cf0', ring: 'classic', ringVolume: 0.6, lock: null, hasPhoto: false, hasAudio: false },
    ];
    callList.notif = [
      { id: 'n1', kind: 'notif', style: 'glass', name: 'Virement reçu', msg: 'Vous avez reçu 2 400,00 €', title: 'Virement reçu — Banque Atlas', appName: 'Banque Atlas', ring: 'classic', ringVolume: 0.6, present: 'banner', phone: {}, received: { mode: 'now' }, hasPhoto: false, hasAudio: false },
      { id: 'n2', kind: 'notif', style: 'tonal', name: 'Colis livré', msg: 'Votre colis est arrivé', title: 'Colis livré — Relais 24', appName: 'Relais 24', ring: 'classic', ringVolume: 0.6, present: 'lock', phone: {}, received: { mode: 'now' }, hasPhoto: false, hasAudio: false },
    ];
    persistCallList();
    switchTab('call'); setCallKind('call');
    await selectCallEntry('e1');
  }, SCR_IDS[0]);
  if (extra) await extra(page);
  await page.clock.runFor(300);
});
const telKind = (k, extra) => telScene(async (page) => {
  await page.evaluate((k) => setCallKind(k), k);
  if (extra) await extra(page);
});
// Discussion : deux messages postés, la lecture automatique tourne (3 / 5), le n° 4 touché (↑ ↓, Reprendre ici)
const telChat = (extra) => telKind('discussion', async (page) => {
  await page.evaluate(() => {
    openChatOnTarget(); sendNextChatMessage(); sendNextChatMessage();
    editChatMessage('d4');
  });
  if (extra) await extra(page);
});
// Séquence : le déroulé jusqu'à l'étape n (GO répétés), mode Plateau
const seqPlay = (n, extra) => seqScene(async (page) => {
  await page.evaluate(async (n) => { setSeqMode('play'); for (let i = 0; i < n; i++) seqGo(); await _seqChain; }, n);
  if (extra) await extra(page);
  await page.clock.runFor(4000);
});
Object.assign(SCENES, {
  // 4a · Appel : « À jouer », trois appels enregistrés avec leur ▶, une seule barre « FAIRE SONNER »
  'remote-tel-call': telScene(),
  // 4a2 · L'appel sonne depuis 4 s (décroché auto dans 4 s) : Raccrocher / Décrocher
  'remote-tel-call-ringing': telScene(async (page) => {
    await page.evaluate(() => { document.getElementById('callAutoSlider').value = '8'; onCallAutoChange(); telCallSent('call', 8); remoteOnCallState({ state: 'ringing' }); });
    await page.clock.runFor(4000);
  }),
  // 4b · SMS : message modifiable sur place, « ENVOYER LE SMS »
  'remote-tel-sms': telKind('sms', (page) => page.evaluate(() => {
    document.getElementById('callMsgText').value = 'Tu es où ??';
    document.getElementById('lockToggle').checked = true; document.getElementById('lockTime').value = '00:10';
    renderTelRows();
  })),
  // 4c · Notification : titre et contenu sur place, « ENVOYER LA NOTIFICATION »
  'remote-tel-notif': telKind('notif'),
  // 4d · Discussion ouverte : fil, ↑ ↓ sur la ligne touchée, barre ↶ / Pause / Envoyer n°3
  'remote-tel-discussion-open': telChat(async (page) => {
    await page.evaluate(() => { chatAutoStart(); });
    await page.clock.runFor(1500);
    await scrollTo('dcThreadPanel', 84)(page);
  }),
  // 4d2 · Discussion avant ouverture : « OUVRIR SUR L'ÉCRAN »
  'remote-tel-discussion-closed': telKind('discussion'),
  // 4e · « Inconnu — nuit » supprimé : bandeau « Annuler », les numéros suivants ont avancé
  'remote-tel-list-deleted': telScene(async (page) => {
    await page.evaluate(() => { deleteCallEntry('e3'); });
    await scrollTo('callListPanel', 100)(page);
  }),
  // 4e2 · Menu ⋯ d'une ligne : monter / descendre, console DMX (n° 3, DMX 30–39)
  'remote-tel-list-menu': telScene((page) => page.evaluate(() => openCallEntryMenu('e3'))),
  // 4e3 · Signet d'une entrée chargée : mettre à jour / enregistrer comme nouveau
  'remote-tel-save-loaded': telScene((page) => page.evaluate(() => openSaveCallSheet())),
  // 4f · Séquence, Préparer : carte, étapes, « + Étape » et « Jouer la séquence »
  'remote-seq-prepare': seqScene(),
  // 4f2 · Préparer sans licence : bandeau d'aperçu, liste en lecture seule
  'remote-seq-prepare-preview': licScene('seq'),
  // 4g · Plateau : l'appel (étape 3) sonne depuis 4 s ; ENSUITE ; GO 96 px
  'remote-seq-plateau': seqPlay(3),
  // 4g2 · Plateau pendant la discussion : lecture auto « le comédien tape » sous l'étape en cours
  'remote-seq-plateau-chat': seqScene(async (page) => {
    await page.evaluate(async () => {
      _seq.steps.find((s) => s.id === 'a7').opt = { auto: true, full: false };
      setSeqMode('play');
      for (let i = 0; i < 7; i++) seqGo();
      await _seqChain;
    });
    await page.clock.runFor(1500);
  }),
  // 4h · Éditeur d'étape en quatre questions : phrase de synthèse, Quoi ? Lequel ? Quand ? Sur quel écran ?
  'remote-seq-step-questions': seqScene((page) => page.evaluate(() => { openSeqStep('a3'); })),
  // 4i · « + Nouvel appel ici » : création sur place, même composeur que Tel
  'remote-seq-step-new-here': seqScene((page) => page.evaluate(() => { openSeqStep('a3'); seqCreateInline(); })),
});

// Fenêtre propre à une scène (sinon 390 × 844)
const LANDSCAPE = { width: 844, height: 390 };
export const SCENE_VIEWPORT = {
  'nav-rail-tablet': { width: 1024, height: 768 },
  'nav-rail-landscape': LANDSCAPE,
  'screen-call-glass-landscape': LANDSCAPE,
  'screen-incall-tonal-landscape': LANDSCAPE,
  'screen-notif-lock-glass-landscape': LANDSCAPE,
  'screen-seq-lock-landscape': LANDSCAPE,
  'screen-seq-code-landscape': LANDSCAPE,
};

// Fige les effets canvas sur une frame déterministe : chaque moteur actif est
// relancé (t = 0, frame dessinée immédiatement) ; l'horloge étant en pause,
// toutes les frames suivantes sont identiques — plus de course entre la
// dernière frame peinte et la capture.
function freezeCanvasFx() {
  if (typeof _pvFxMain !== 'undefined' && _pvFxMain && _pvFxMain.current()) {
    const n = _pvFxMain.current();
    _pvFxMain.start(n, { ..._lastEffectParams });
  }
  if (typeof _screenFxR !== 'undefined' && _screenFxR.current()) _screenFxR.start(_screenFxR.current(), { ...(_screenFxParams || {}) });
}

// Capture d'une scène pour un fichier HTML donné
export async function captureScene(browser, file, name) {
  const init = SCENE_INIT[name] || (NATIVE_SCENES.has(name) ? NATIVE_INIT : null);
  const { page, errors, close } = await openPage(browser, { file, clock: true, init, ...(SCENE_VIEWPORT[name] ? { viewport: SCENE_VIEWPORT[name] } : {}) });
  try {
    await SCENES[name](page);
    // Luminance du fond d'écran du faux téléphone (voile des fonds clairs) : échantillonnée de façon asynchrone
    await page.waitForFunction(() => typeof PhoneUI === 'undefined' || PhoneUI.pending() === 0);
    await page.evaluate(freezeCanvasFx);
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    return { png, errors: [...errors] };
  } finally { await close(); }
}
