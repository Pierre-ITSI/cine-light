// Écrans clés capturés pour la non-régression visuelle. Chaque scène part
// d'une page neuve, horloge figée (T0) et aléa déterministe : deux rendus du
// même HTML dans le même environnement sont identiques au pixel près.
import { openPage } from './harness.mjs';

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
const scrollTo = (id) => (page) => page.evaluate((id) => {
  const el = document.getElementById(id);
  document.getElementById('remote-mode').scrollTop += el.getBoundingClientRect().top - 120;
}, id);

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
  const { page, errors, close } = await openPage(browser, { file, clock: true });
  try {
    await SCENES[name](page);
    await page.evaluate(freezeCanvasFx);
    const png = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    return { png, errors: [...errors] };
  } finally { await close(); }
}
