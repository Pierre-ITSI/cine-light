// ══════════════════════════ APPAIRAGE PAR CODE (sans caméra) ══════════════════════════
// Un code court par écran (6 caractères sans I/L/O/0/1, valable 2 min). Les
// deux appareils échangent des clés ECDH P-256 en clair sur un topic de
// rendez-vous dérivé du code, avec engagement (commit / reveal), puis
// comparent un nombre à 6 chiffres (SAS) : un appareil qui s'interpose
// produit deux nombres différents. Après confirmation des deux côtés, la
// télécommande remet à l'écran le secret de session COMMUN, chiffré pour lui
// (SRP.sealSessionForPeer) : tous les écrans appairés jouent ensemble.
//
//   écran                         télécommande
//   pair:commit  H(clé écran) ──►
//                             ◄── pair:key     clé télécommande
//   pair:reveal  clé écran    ──►  (vérifie l'engagement)
//         [ les deux affichent la SAS ; l'utilisateur compare ]
//                             ◄── pair:session secret de session chiffré
// Chaque message est répété toutes les 1,5 s jusqu'à la réponse (QoS 0).
const PAIR_RESEND_MS = 1500;
const PAIR_SESSION_RESEND_MS = 20000; // télécommande : durée de remise du secret
let _rdv = null;                  // rendez-vous affiché (télécommande) ou en cours (écran)
const _rdvBackground = new Set(); // télécommande : remises qui se terminent en arrière-plan

// — Transport du rendez-vous : client MQTT dédié, messages JSON validés —
function _rdvOpen(r) {
  const client = mqtt.connect(BROKER, { clientId: _newClientId('rdv'), clean: true, connectTimeout: 8000, reconnectPeriod: 3000 });
  r.client = client;
  client.on('connect', () => {
    if (r.closed) return;
    client.subscribe(r.mqttTopic, { qos: 0 }, () => { if (!r.closed && r.out) _rdvSend(r, r.out); });
  });
  client.on('message', (topic, payload) => {
    if (r.closed || topic !== r.mqttTopic) return;
    let m;
    try { m = JSON.parse(String(payload)); } catch (_) { return; }
    if (!SRP.validateRendezvousMessage(m)) return;
    r.chain = r.chain.then(() => (r.closed ? null : r.onMessage(m))).catch(() => {}); // un message à la fois
  });
}
function _rdvSend(r, msg) {
  if (r.client && r.client.connected && !r.closed) r.client.publish(r.mqttTopic, JSON.stringify(msg), { qos: 0 });
}
// Répète « msg » jusqu'au prochain message ou à la fermeture
function _rdvRepeat(r, msg) {
  _rdvStopRepeat(r);
  r.out = msg;
  _rdvSend(r, msg);
  r.repeat = setInterval(() => _rdvSend(r, msg), PAIR_RESEND_MS);
}
function _rdvStopRepeat(r) { if (r.repeat) { clearInterval(r.repeat); r.repeat = null; } r.out = null; }
function _rdvClose(r) {
  if (!r || r.closed) return;
  r.closed = true;
  _rdvStopRepeat(r);
  clearTimeout(r.expiryTimer); clearTimeout(r.doneTimer);
  if (r.client) { try { r.client.end(true); } catch (_) {} r.client = null; }
}
// Dernier message (abandon, remise du secret) répété quelques secondes, puis fermeture
function _rdvFinishInBackground(r, msg, ms) {
  if (_rdv === r) _rdv = null;
  _rdvBackground.add(r);
  _rdvRepeat(r, msg);
  r.doneTimer = setTimeout(() => { _rdvClose(r); _rdvBackground.delete(r); }, ms);
}

// ══════════ Télécommande ══════════
function _fmtPairCode(code) { return code.slice(0, 3) + '·' + code.slice(3); }

// Nouveau code (bouton ⟳, expiration, ou après chaque écran appairé)
async function remoteNewPairCode() {
  if (mode !== 'remote') return;
  if (_rdv) { _rdvClose(_rdv); _rdv = null; }
  const { code, expiresAt } = SRP.createRendezvous();
  const r = { role: 'remote', code, expiresAt, phase: 'waiting', chain: Promise.resolve(), closed: false };
  _rdv = r;
  const el = document.getElementById('pairCode');
  if (el) el.textContent = _fmtPairCode(code);
  // Expiré sans écran : un nouveau code s'affiche. Pendant une vérification, on
  // laisse l'utilisateur finir (2 min de plus au maximum).
  const onExpire = () => {
    if (_rdv !== r) return;
    if (r.phase === 'waiting' || Date.now() > expiresAt + SRP.RENDEZVOUS_TTL_MS) {
      if (r.phase !== 'waiting') hidePairVerify();
      remoteNewPairCode();
    } else r.expiryTimer = setTimeout(onExpire, 5000);
  };
  r.expiryTimer = setTimeout(onExpire, Math.max(0, expiresAt - Date.now()));
  r.mqttTopic = SRP.RENDEZVOUS_TOPIC_PREFIX + await SRP.rendezvousTopic(code);
  if (r.closed) return;
  r.onMessage = (m) => _remoteRdvMessage(r, m);
  _rdvOpen(r);
}

// Arrête le code affiché (sauf vérification en cours, si keepBusy)
function remoteStopPairCode(keepBusy) {
  if (_rdv && _rdv.role === 'remote' && !(keepBusy && _rdv.phase !== 'waiting')) {
    _rdvClose(_rdv); _rdv = null;
    hidePairVerify();
  }
}
function remoteStopAllPairing() {
  remoteStopPairCode(false);
  for (const r of _rdvBackground) _rdvClose(r);
  _rdvBackground.clear();
}

async function _remoteRdvMessage(r, m) {
  if (m.type === 'pair:commit') {
    if (r.phase !== 'waiting') return; // un seul écran par code ; répétitions ignorées
    r.phase = 'keyed';
    r.commit = m.commit;
    r.kp = await SRP.ecdhKeyPair();
    if (!r.closed) _rdvRepeat(r, { type: 'pair:key', v: 1, jwk: r.kp.publicJwk });
  } else if (m.type === 'pair:reveal') {
    if (r.phase !== 'keyed') return;
    // Révélation qui ne correspond pas à l'engagement : autre appareil, ignorée
    if (!(await SRP.verifyCommitment(m.jwk, r.commit))) return;
    let d;
    try { d = await SRP.deriveSharedPairing(r.kp, m.jwk, { code: r.code }); } catch (_) { return; }
    if (r.closed || r.phase !== 'keyed') return;
    r.phase = 'verify'; r.temp = d.pairing;
    _rdvStopRepeat(r);
    showPairVerify('remote', d.sas, (ok) => _remotePairAnswer(r, ok));
  } else if (m.type === 'pair:abort') {
    if (r.phase === 'keyed' || r.phase === 'verify') { hidePairVerify(); remoteNewPairCode(); }
  }
}

async function _remotePairAnswer(r, ok) {
  hidePairVerify();
  if (r.closed || r.phase !== 'verify') return;
  if (!ok) {
    r.phase = 'aborted';
    _rdvFinishInBackground(r, { type: 'pair:abort', v: 1, reason: 'mismatch' }, 3000);
    remoteNewPairCode();
    return;
  }
  r.phase = 'sending';
  let frame;
  try { frame = await SRP.sealSessionForPeer(_session, r.temp); } catch (_) { _rdvClose(r); remoteNewPairCode(); return; }
  _rdvFinishInBackground(r, { type: 'pair:session', v: 1, frame }, PAIR_SESSION_RESEND_MS);
  remoteNewPairCode(); // un nouveau code par écran
}

// ══════════ Écran ══════════
function _pairHelp(text) {
  const el = document.getElementById('pairCodeHelp');
  if (el) el.textContent = text || PAIR_HELP_DEFAULT;
}
const PAIR_HELP_DEFAULT = 'Avec le code, un nombre à 6 chiffres s\'affichera ici et sur la télécommande pour confirmer l\'appairage.';

async function screenPairWithCode() {
  const input = document.getElementById('pairCodeInput');
  const code = SRP.normalizeRendezvousCode(input ? input.value : '');
  if (!code) { _pairHelp('Code incomplet : 6 caractères, par exemple K7M-4QP.'); if (input) input.focus(); return; }
  screenStopPairCode();
  const r = { role: 'screen', code, phase: 'commit', chain: Promise.resolve(), closed: false };
  _rdv = r;
  _pairHelp('Recherche de la télécommande…');
  r.expiryTimer = setTimeout(() => _screenPairFailed(r, 'Code expiré : demandez un nouveau code à la télécommande.'), SRP.RENDEZVOUS_TTL_MS);
  const [kp, topic] = await Promise.all([SRP.ecdhKeyPair(), SRP.rendezvousTopic(code)]);
  r.kp = kp;
  r.commit = await SRP.commitPublicKey(kp.publicJwk);
  if (r.closed) return;
  r.mqttTopic = SRP.RENDEZVOUS_TOPIC_PREFIX + topic;
  r.onMessage = (m) => _screenRdvMessage(r, m);
  _rdvOpen(r);
  _rdvRepeat(r, { type: 'pair:commit', v: 1, commit: r.commit });
}

function screenStopPairCode() {
  if (_rdv && _rdv.role === 'screen') { _rdvClose(_rdv); _rdv = null; hidePairVerify(); }
}

async function _screenRdvMessage(r, m) {
  if (m.type === 'pair:key') {
    if (r.phase !== 'commit') return;
    let d;
    try { d = await SRP.deriveSharedPairing(r.kp, m.jwk, { code: r.code }); } catch (_) { return; }
    if (r.closed || r.phase !== 'commit') return;
    r.phase = 'verify'; r.temp = d.pairing;
    _rdvRepeat(r, { type: 'pair:reveal', v: 1, jwk: r.kp.publicJwk });
    showPairVerify('screen', d.sas, (ok) => _screenPairAnswer(r, ok));
  } else if (m.type === 'pair:session') {
    if (r.phase !== 'verify' && r.phase !== 'confirmed') return;
    if (!r.frame) r.frame = m.frame;
    _rdvStopRepeat(r); // la télécommande a reçu notre clé
    if (r.phase === 'confirmed') await _screenPairFinish(r);
  } else if (m.type === 'pair:abort') {
    if (r.phase !== 'commit') _screenPairFailed(r, 'Appairage annulé sur la télécommande : demandez un nouveau code.');
  }
}

async function _screenPairAnswer(r, ok) {
  if (r.closed) return;
  if (!ok) {
    hidePairVerify();
    r.phase = 'aborted';
    _rdvFinishInBackground(r, { type: 'pair:abort', v: 1, reason: 'mismatch' }, 3000);
    _pairHelp('');
    return;
  }
  r.phase = 'confirmed';
  if (r.frame) await _screenPairFinish(r);
  else setPairVerifyWaiting();
}

async function _screenPairFinish(r) {
  let res;
  try { res = await SRP.openSessionFromPeer(r.frame, r.temp); }
  catch (_) { _screenPairFailed(r, 'Échec de l\'appairage : réessayez avec un nouveau code.'); return; }
  if (r.closed) return;
  r.phase = 'done';
  _rdvClose(r);
  if (_rdv === r) _rdv = null;
  hidePairVerify();
  _pairHelp('');
  const input = document.getElementById('pairCodeInput');
  if (input) input.value = '';
  screenJoinSession(res.pairing);
}

function _screenPairFailed(r, text) {
  if (r.closed) return;
  _rdvClose(r);
  if (_rdv === r) _rdv = null;
  hidePairVerify();
  _pairHelp(text);
}

// ══════════ Vérification du nombre (SAS), commune aux deux rôles ══════════
let _pvAnswer = null;
function showPairVerify(role, sas, onAnswer) {
  const el = document.getElementById('pair-verify');
  if (!el) return;
  _pvAnswer = onAnswer;
  document.getElementById('pvText').innerHTML = (role === 'remote'
    ? 'L\'écran de jeu affiche maintenant un nombre.'
    : 'La télécommande affiche maintenant un nombre.')
    + ' Il doit être <b>identique</b> à celui-ci :';
  document.getElementById('pvSas').textContent = SRP.formatSas(sas);
  const ok = document.getElementById('pvOk');
  ok.disabled = false; ok.textContent = 'Identique';
  el.style.display = 'block';
}
function hidePairVerify() {
  _pvAnswer = null;
  const el = document.getElementById('pair-verify');
  if (el) el.style.display = 'none';
}
// Écran : confirmé avant la télécommande → on attend la remise du secret
function setPairVerifyWaiting() {
  const ok = document.getElementById('pvOk');
  if (ok) { ok.disabled = true; ok.textContent = 'En attente…'; }
}
function pairVerifyAnswer(ok) {
  const f = _pvAnswer;
  if (!f) return;
  if (!ok) _pvAnswer = null;
  f(!!ok);
}

// ══════════ Écran : scan du QR dans l'app (BarcodeDetector) ══════════
// Sans BarcodeDetector (iPhone, Firefox…) ou sans caméra : on invite à viser
// le QR avec l'appareil photo du téléphone, qui ouvre le lien d'appairage.
let _scan = null;
async function startPairScan() {
  stopPairScan();
  const box = document.getElementById('pairScanBox'), label = document.getElementById('pairScanLabel');
  if (!box || !label) return;
  const s = { stopped: false };
  _scan = s;
  const fallback = () => {
    if (_scan !== s) return;
    box.classList.remove('live');
    label.textContent = 'Visez le QR avec l\'appareil photo';
  };
  fallback();
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    if (!formats.includes('qr_code') || s.stopped) return;
    s.detector = new BarcodeDetector({ formats: ['qr_code'] });
    s.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (s.stopped) { s.stream.getTracks().forEach((t) => t.stop()); return; }
    const v = document.getElementById('pairScanVideo');
    v.srcObject = s.stream;
    await v.play();
    if (s.stopped) return;
    box.classList.add('live');
    label.textContent = 'Caméra active — visez le QR';
    const tick = async () => {
      if (s.stopped) return;
      try {
        for (const c of await s.detector.detect(v)) {
          const p = SRP.parsePairingUrl(String((c && c.rawValue) || ''));
          if (p) { stopPairScan(); screenJoinSession(p); return; }
        }
      } catch (_) {}
      if (!s.stopped) s.timer = setTimeout(tick, 250);
    };
    tick();
  } catch (_) { fallback(); }
}
function stopPairScan() {
  const s = _scan;
  if (!s) return;
  _scan = null;
  s.stopped = true;
  clearTimeout(s.timer);
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  const v = document.getElementById('pairScanVideo');
  if (v) v.srcObject = null;
  const box = document.getElementById('pairScanBox');
  if (box) box.classList.remove('live');
}
