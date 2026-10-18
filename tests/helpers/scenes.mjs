// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// Écrans clés capturés pour la non-régression visuelle. Chaque scène part
// d'une page neuve, horloge figée (T0) et aléa déterministe : deux rendus du
// même HTML dans le même environnement sont identiques au pixel près.
import { openPage } from './harness.mjs';
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
  await page.clock.runFor(400);
};
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
const scrollTo = (id, top = 120) => (page) => page.evaluate(([id, top]) => {
  const el = document.getElementById(id);
  document.getElementById('remote-mode').scrollTop += el.getBoundingClientRect().top - top;
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
  }, kind);
  await scrollTo('callRingPanel')(page);
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

export const SCENES = {
  'splash': async (page) => { await page.clock.runFor(1000); },
  'screen-connect': async (page) => { await page.evaluate(() => startMode('screen')); await page.clock.runFor(600); },
  'remote-color': remote(null),
  'remote-color-strobe': remote(null, scrollTo('strobeToggle')),
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
  // Tuile « Son » ouverte : son de notification propre (indépendant des SMS)
  'remote-call-notif-sound': remote('call', async (page) => {
    await page.evaluate(() => { setCallKind('notif'); toggleNotifDetail('sound'); });
    await scrollTo('ntSendBtn', 80)(page);
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
    await scrollTo('dcTabs', 60)(page);
  }),
  // 26c · Discussions enregistrées : quatre entrées, la première chargée dans « Fil en cours »
  'remote-call-discussion-saved': remote('call', async (page) => {
    await page.evaluate(() => {
      const msgs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + (i + 1), from: i % 2 ? 'actor' : 'contact', text: 'Message ' + (i + 1) }));
      const e = (id, name, contact, actor, style, n) => ({ id, name, contact, actor, style, msgs: msgs(n), hasPhoto: false, photoSig: null });
      chatSaved = [
        e('c12', 'Séq. 12 — Maman inquiète', 'Maman', 'Julie', 'glass', 7), e('c14', 'Séq. 14 — Rupture', 'Thomas', 'Julie', 'minimal', 11),
        e('c21', 'Séq. 21 — Agence', 'Agence Riviera', 'Marc', 'tonal', 4), e('c30', 'Séq. 30 — Groupe famille', 'Papa', 'Julie', 'minimal', 9),
      ];
      _chat.savedId = 'c12';
      setCallKind('discussion'); setChatView('saved');
    });
    await scrollTo('dcTabs', 80)(page);
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
  'remote-call-list': remote('call', async (page) => {
    await page.evaluate(async () => {
      const photo = (c) => { const k = document.createElement('canvas'); k.width = k.height = 8; const g = k.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 8, 8); return k.toDataURL('image/jpeg', 0.7); };
      const add = async (f) => {
        setCallKind(f.kind || 'call'); setCallStyle(f.style); setCallPresent(f.present || 'full');
        document.getElementById('callName').value = f.name;
        document.getElementById('callAutoSlider').value = String(f.auto || 0); onCallAutoChange();
        document.getElementById('lockToggle').checked = !!f.lock;
        _callPhoto = f.photo ? photo(f.photo) : null;
        _callAudioData = f.audio ? 'data:audio/mpeg;base64,AAAA' : null;
        await saveCurrentCall();
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
    });
    await scrollTo('callListPanel')(page);
  }),
  // 11 · Avertissement stroboscope : interrupteur ouvert derrière la boîte
  'remote-strobe-warning': remote(null, async (page) => {
    await scrollTo('strobeToggle', 96)(page);
    await page.evaluate(() => { document.getElementById('strobeToggle').checked = true; onStrobeToggle(); });
  }),
  // 13 · Réglages (engrenage de l'en-tête)
  'remote-settings': remote(null, (page) => page.evaluate(() => openSettings())),
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
  'screen-effect-police': async (page) => {
    await joinScreen(page);
    await page.evaluate(() => receiveEffect({ name: 'police', active: true, params: { speed: 3, intensity: 100, chaos: 0, drift: 0 } }));
    await page.clock.runFor(250);
  },
};

// Fige les effets canvas sur une frame déterministe : chaque moteur actif est
// relancé (t = 0, frame dessinée immédiatement) ; l'horloge étant en pause,
// toutes les frames suivantes sont identiques — plus de course entre la
// dernière frame peinte et la capture.
function freezeCanvasFx() {
  if (typeof _pvFxMain !== 'undefined' && _pvFxMain && _pvFxMain.current()) {
    const n = _pvFxMain.current();
    _pvFxMain.start(n, { ..._lastEffectParams });
    _pvFxSticky.start(n, { ..._lastEffectParams });
  }
  if (typeof _screenFxR !== 'undefined' && _screenFxR.current()) _screenFxR.start(_screenFxR.current(), { ...(_screenFxParams || {}) });
}

// Capture d'une scène pour un fichier HTML donné
export async function captureScene(browser, file, name) {
  const { page, errors, close } = await openPage(browser, { file, clock: true, init: NATIVE_SCENES.has(name) ? NATIVE_INIT : null });
  try {
    await SCENES[name](page);
    await page.evaluate(freezeCanvasFx);
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    return { png, errors: [...errors] };
  } finally { await close(); }
}
