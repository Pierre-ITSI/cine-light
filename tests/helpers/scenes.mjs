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
export const NATIVE_SCENES = new Set(['remote-qr-dmx-entry', 'dmx-gateway', 'dmx-patch', 'dmx-monitor', 'dmx-channels']);
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
  'screen-chat-lock-glass': screenCall({ kind: 'chat', style: 'glass', name: 'Léa', msg: 'On t’attend sur le plateau', appName: 'Chatly', lock: { time: '07:42', date: '' } }),
  'screen-chat-banner-tonal': screenCall({ kind: 'chat', style: 'tonal', name: 'Régie', msg: 'Moteur demandé dans 5 min', appName: 'Chatly', appColor: '#22aa66' }),
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
      await add({ kind: 'chat', name: 'Chatly — Tom', style: 'minimal' });
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
