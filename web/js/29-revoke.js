// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ CLÉS PAR ÉCRAN & RETRAIT D'UN ÉCRAN ══════════════════════════
// Maquettes validées 5b (« Retirer l'écran » + confirmation) et 5c (écran retiré).
//
// Tous les écrans partagent la clé de session : ignorer un écran ne suffit pas
// à le retirer. Chaque écran a donc AUSSI une clé propre avec la télécommande
// (packages/protocol/pairwise.js), établie par ECDH P-256 éphémère DANS la
// session chiffrée, juste après l'appairage (QR ou code) ou à la première
// connexion d'un écran appairé avant cette version (caps.kx = 1) :
//   key:offer (session) → key:answer (session) → key:confirm (pairwise) → key:ok (pairwise)
// Télécommande : secret conservé par écran dans le registre de la session
// (28-screens.js, pk) ; écran : dans setremote-screen-pairwise-v1. caps.kid
// permet de vérifier que les deux côtés ont la même clé ; un écran qui en a
// déjà une avec cette télécommande ignore toute nouvelle offre (premier échange
// retenu) ; une clé qui diffère n'est jamais remplacée d'office (pkConflict).
//
// Retrait (scrRevoke) :
//   1. l'écran retiré reçoit screen:revoked (clé de session, ancien topic) :
//      il efface sa session et ses clés et affiche 5c ;
//   2. nouvelle session (channelId + clé, même dérivation) ; registre, patch
//      DMX et choix « ne plus demander » du stroboscope y passent, sans
//      l'écran retiré (nom, groupes et clé oubliés) ;
//   3. chaque autre écran reçoit session:rekey (nouvelle session, son nom et
//      ses groupes) scellé avec SA clé pairwise, sur l'ancien topic ; il
//      accuse (rekey:ok), passe sur le nouveau topic et garde affichage, cache
//      et état : la resynchronisation n'y renvoie que ce qui manque ;
//   4. la télécommande bascule dès que les écrans en ligne ont accusé (ou au
//      bout de REKEY_WAIT_MS) ; le QR et le code d'appairage sont renouvelés ;
//   5. elle garde un ÉCOUTEUR LÉGER sur l'ancien topic pendant RK_LISTEN_MS
//      (24 h, conservé) : un écran absent pendant le retrait y revient et
//      reçoit la session en cours (sa clé pairwise) ; l'écran retiré, ou tout
//      appareil inconnu (ancien QR rejoué), reçoit screen:revoked.
// Les écrans sans clé pairwise (version antérieure jamais reconnectée, clé en
// conflit) ne peuvent pas suivre : à leur retour sur l'ancien topic, ils
// reçoivent screen:revoked { reason: 'renewed' } et doivent être réappairés.
const REKEY_WAIT_MS = 3000;                  // accusés des écrans en ligne avant la bascule
const RK_LISTEN_MS = 24 * 60 * 60 * 1000;    // écoute de l'ancien topic après un retrait
const RK_RECORDS_MAX = 4;                    // anciens topics écoutés au plus (retraits successifs)
const RK_RESEND_MS = 4000;                   // pas plus d'un envoi par écran et par période
const KX_RETRY_MS = 10000;                   // échange de clés sans réponse : relancé ensuite
const RK_LS_KEY = 'setremote-rekey-v1';

// ══════════ Télécommande : clé par écran ══════════
const _pwCache = new Map(); // screenId → Promise<{ r2s, s2r, kid }>
const _kx = new Map();      // screenId → échange en cours { xid, kp, at, ch }

function pkOf(id) { const e = _scrReg.screens.get(id); return e && e.pk && !e.pkConflict ? e.pk : null; }
function pwKeys(id) {
  const pk = pkOf(id);
  if (!pk) return Promise.resolve(null);
  const c = _pwCache.get(id);
  if (c && c.s === pk.s) return c.p;
  const p = SRP.pairwiseKeys(pk.s, { remoteId: remoteId(), screenId: id }).catch(() => null);
  _pwCache.set(id, { s: pk.s, p });
  return p;
}
// Trames pairwise reçues sur la session : clé de l'écran rattaché à l'émetteur
async function remotePairwiseCandidates(sender) {
  const id = _screenOfSender.get(sender);
  const keys = id ? await pwKeys(id) : null;
  return keys ? [{ keys, tag: id }] : null;
}

// À chaque « caps » d'un écran connu
function kxOnCaps(id, caps) {
  if (mode !== 'remote' || caps.kx !== 1) return; // écran sans échange de clés (ancienne version)
  const e = _scrReg.screens.get(id);
  if (!e) return;
  const kid = typeof caps.kid === 'string' ? caps.kid : null;
  if (e.pk && kid === e.pk.kid) {
    if (!e.pk.ok || e.pkConflict) { e.pk.ok = true; e.pkConflict = false; scrSave(); }
    return;
  }
  if (kid) { e.pkConflict = true; scrChanged(); return; } // l'écran détient une AUTRE clé : jamais remplacée d'office
  kxStart(id); // l'écran n'a pas (ou plus) de clé avec nous
}
async function kxStart(id) {
  const cur = _kx.get(id);
  if (cur && Date.now() - cur.at < KX_RETRY_MS) return;
  const at = Date.now();
  _kx.set(id, { at });
  let kp;
  try { kp = await SRP.ecdhKeyPair(); } catch (_) { _kx.delete(id); return; }
  if (mode !== 'remote' || !_session) return;
  const xid = SRP.createExchangeId();
  _kx.set(id, { xid, kp, at, ch: _session.channelId });
  sendMsg({ type: 'key:offer', rid: remoteId(), xid, jwk: kp.publicJwk, target: { screens: [id] } });
}
// key:answer (session) : seulement de l'émetteur rattaché à l'écran visé, pour notre offre
async function remoteOnKeyAnswer(m) {
  const sid = _rxFrom;
  if (!sid || m.sid !== sid || m.rid !== remoteId()) return;
  const x = _kx.get(sid);
  if (!x || !x.kp || x.xid !== m.xid || !_session || x.ch !== _session.channelId) return;
  _kx.delete(sid);
  let r;
  try {
    r = await SRP.derivePairwiseSecret(x.kp, { offerJwk: x.kp.publicJwk, answerJwk: m.jwk, channelId: x.ch, remoteId: remoteId(), screenId: sid, exchangeId: x.xid });
  } catch (_) { return; }
  const e = _scrReg.screens.get(sid);
  if (!e) return;
  e.pk = { s: r.secret, kid: r.kid, ok: false };
  e.pkConflict = false;
  scrSave();
  const keys = await pwKeys(sid);
  if (keys) sendPairwise({ type: 'key:confirm', sid, rid: remoteId(), xid: x.xid }, keys);
}
// Trame pairwise d'un écran (sur la session en cours)
function remoteOnPairwise(sid, m) {
  if (!sid || m.sid !== sid) return;
  const e = _scrReg.screens.get(sid);
  if (m.type === 'key:ok') { if (e && e.pk && !e.pk.ok) { e.pk.ok = true; scrSave(); } }
  else if (m.type === 'rekey:ok') rkAcked(sid);
}

// ══════════ Télécommande : retrait ══════════
let _revokeChain = Promise.resolve();
let _rkAcks = null; // accusés attendus pendant un retrait : Set des écrans passés
// Retraits successifs : l'un après l'autre
function scrRevoke(id) {
  const p = _revokeChain.then(() => _scrRevoke(id));
  _revokeChain = p.catch((e) => console.warn('SetRemote : retrait d\'écran', e));
  return p;
}
// Écrans qui pourront suivre (clé pairwise) / qui devront être réappairés
function scrRevokeFollowers(id) {
  const all = [..._scrReg.screens.keys()].filter((s) => s !== id);
  return { follow: all.filter((s) => pkOf(s)), lost: all.filter((s) => !pkOf(s)) };
}

async function _scrRevoke(id) {
  if (mode !== 'remote' || !_session || !scrKnown(id)) return false;
  const old = { channelId: _session.channelId, key: _session.key };
  // 1. Ce qui concerne l'écran retiré s'arrête ; il est prévenu (ancien topic)
  _vidStopJobs([id]);
  _kx.delete(id);
  const st = _scrStates.get(id);
  if (st && st.call) sendMsg({ type: 'call:end', target: { screens: [id] } });
  if (st && st.chatShown) sendMsg({ type: 'chat:close', target: { screens: [id] } });
  sendMsg({ type: 'screen:revoked', target: { screens: [id] } });
  // 2. Nouvelle session ; clés des écrans qui suivent (avant tout oubli)
  const next = SRP.createPairing();
  const { follow } = scrRevokeFollowers(id);
  const keys = {};
  for (const s of follow) keys[s] = await pwKeys(s);
  // 3. Tout est ENREGISTRÉ avant le premier envoi : une télécommande rechargée
  // au milieu du retrait repart sur la nouvelle session et écoute l'ancienne
  rkUpdateRecords((recs) => {
    for (const r of recs) { r.pending = r.pending.filter((s) => s !== id); if (!r.revoked.includes(id)) r.revoked.push(id); }
    recs.unshift({ ch: old.channelId, key: old.key, until: Date.now() + RK_LISTEN_MS, revoked: [id], pending: follow.slice() });
  });
  saveRemoteSession(next);
  scrForget(id, next.channelId);
  gwMigrateSession(old.channelId, next.channelId, id);
  _rkMigrateFlashWarning(old.channelId, next.channelId);
  // 4. Nouvelle session remise à chaque écran qui suit (sa clé, ancien topic)
  _rkAcks = new Set();
  for (const s of follow) {
    const e = _scrReg.screens.get(s);
    if (keys[s]) sendPairwise(rkMessage(s, e, next), keys[s]);
  }
  // 5. Bascule dès que les écrans en ligne ont accusé (ou au bout du délai)
  const online = follow.filter(scrOnline);
  const t0 = Date.now();
  while (Date.now() - t0 < REKEY_WAIT_MS && !online.every((s) => _rkAcks.has(s))) await new Promise((r) => setTimeout(r, 50));
  _rkAcks = null;
  if (mode !== 'remote') return true; // télécommande quittée entre-temps : la nouvelle session est déjà enregistrée
  remoteSwitchSession(next);
  return true;
}
function rkMessage(sid, e, p) {
  const m = { type: 'session:rekey', sid, rid: remoteId(), channelId: p.channelId, key: p.key };
  if (e && e.name) m.name = e.name;
  if (e && e.groups.length) m.groups = e.groups.slice();
  return m;
}
// Oubli de l'écran retiré (nom, groupes, clé, état) et registre passé sur la nouvelle session
function scrForget(id, newSid) {
  const oldSid = _scrReg.sid;
  _scrReg.screens.delete(id);
  _scrStates.delete(id);
  _pwCache.delete(id);
  _pairedScreens.delete(id);
  for (const [snd, s] of [..._screenOfSender]) if (s === id) _screenOfSender.delete(snd);
  linkForgetScreen(id); // ses pairs Wi-Fi local / Bluetooth (21-links.js)
  _scrReg.sid = newSid;
  scrSave();
  if (oldSid && oldSid !== newSid) {
    const o = _scrStore();
    if (o.sessions && o.sessions[oldSid]) { delete o.sessions[oldSid]; _lsSet(SCR_LS_KEY, JSON.stringify(o)); }
  }
  const t = _scrReg.target;
  if (_scrValidTarget(t).k !== t.k) scrSetTarget({ k: 'all' }); else scrRefreshCachedView();
  scrChanged();
}
// « Ne plus demander » (avertissement stroboscope, par session) : suit la session
function _rkMigrateFlashWarning(oldSid, newSid) {
  try {
    const o = JSON.parse(_lsGet(FLASH_WARN_KEY));
    if (o && o.skip === oldSid) _lsSet(FLASH_WARN_KEY, JSON.stringify({ skip: newSid }));
  } catch (_) {}
}
// La télécommande passe sur la nouvelle session : même état, mêmes écrans
function remoteSwitchSession(p) {
  remoteStopAllPairing(); // code de rendez-vous et remises en cours : ancien secret
  _screenOfSender.clear(); // les écrans se réannonceront (nouvelles étiquettes)
  connectRemote(p, { keep: true });
  rkStartListeners();
  renderLinkStatus();
}
// Accusé d'un écran passé sur la nouvelle session (pendant le retrait ou plus tard)
function rkAcked(sid) {
  if (_rkAcks) _rkAcks.add(sid);
  rkUpdateRecords((recs) => { for (const r of recs) r.pending = r.pending.filter((s) => s !== sid); });
}

// ── Écouteur léger des anciens topics (conservé) ──
function rkRecords() {
  try {
    const o = JSON.parse(_lsGet(RK_LS_KEY));
    const recs = o && Array.isArray(o.records) ? o.records : [];
    const ids = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string' && SRP.SCREEN_ID_RE.test(s)).slice(0, SCR_MAX) : []);
    return recs.filter((r) => r && SRP.isValidPairing({ channelId: r.ch, key: r.key }) && typeof r.until === 'number' && r.until > Date.now())
      .map((r) => ({ ch: r.ch, key: r.key, until: r.until, revoked: ids(r.revoked), pending: ids(r.pending) }))
      .slice(0, RK_RECORDS_MAX);
  } catch (_) { return []; }
}
function rkUpdateRecords(fn) {
  const recs = rkRecords();
  fn(recs);
  _lsSet(RK_LS_KEY, recs.length ? JSON.stringify({ v: 1, records: recs.slice(0, RK_RECORDS_MAX) }) : null);
  for (const L of _rkListeners.values()) L.rec = recs.find((r) => r.ch === L.rec.ch) || L.rec;
}
function rkClearAll() { rkStopListeners(); _lsSet(RK_LS_KEY, null); }

const _rkListeners = new Map(); // ancien channelId → { rec, ch, client, senders, last, chain }
let _rkTimer = null;
function rkStartListeners() {
  if (mode !== 'remote') return;
  const recs = rkRecords();
  for (const [ch, L] of [..._rkListeners]) if (!recs.some((r) => r.ch === ch)) rkStopListener(L);
  for (const r of recs) if (!_rkListeners.has(r.ch) && (!_session || r.ch !== _session.channelId)) rkStartListener(r);
  if (!_rkTimer && _rkListeners.size) _rkTimer = setInterval(rkStartListeners, 10 * 60 * 1000); // expirations
}
function rkStopListener(L) {
  _rkListeners.delete(L.rec.ch);
  L.closed = true;
  try { L.client && L.client.end(true); } catch (_) {}
}
function rkStopListeners() {
  for (const L of [..._rkListeners.values()]) rkStopListener(L);
  if (_rkTimer) { clearInterval(_rkTimer); _rkTimer = null; }
}
async function rkStartListener(rec) {
  const L = { rec, ch: null, client: null, senders: new Map(), last: new Map(), chain: Promise.resolve(), closed: false };
  _rkListeners.set(rec.ch, L);
  try { L.ch = await SRP.createSecureChannel({ pairing: { channelId: rec.ch, key: rec.key }, role: 'remote' }); }
  catch (_) { _rkListeners.delete(rec.ch); return; }
  if (L.closed) return;
  const topic = L.ch.mqttTopic;
  const client = transportConnect(topic, L.ch.relayAuth, { clientId: _newClientId('rk'), clean: true, connectTimeout: 8000, reconnectPeriod: 3000 });
  L.client = client;
  client.on('connect', () => {
    if (L.closed) return;
    // Les écrans encore sur l'ancien topic s'annoncent (caps) : servis un à un
    client.subscribe(topic, { qos: 0 }, () => { if (!L.closed) rkPublish(L, L.ch.seal({ type: 'hello' })); });
  });
  client.on('message', (t, payload) => {
    if (L.closed || t !== topic) return;
    L.chain = L.chain.then(() => rkOnFrame(L, String(payload))).catch(() => {});
  });
}
function rkPublish(L, framePromise) {
  return Promise.resolve(framePromise).then((f) => {
    if (!L.closed && L.client && L.client.connected) L.client.publish(L.ch.mqttTopic, f, { qos: 0 });
  }).catch(() => {});
}
async function rkOnFrame(L, str) {
  let r;
  try {
    r = await L.ch.receive(str, {
      pairwise: async (snd) => { const sid = L.senders.get(snd); const k = sid ? await pwKeys(sid) : null; return k ? [{ keys: k, tag: sid }] : null; },
    });
  } catch (_) { return; }
  if (!r || L.closed) return;
  if (r.kind === 'pairwise') {
    if (r.message.type === 'rekey:ok' && r.message.sid === r.tag) rkAcked(r.tag);
    return;
  }
  if (r.kind !== 'message') return;
  const m = r.message;
  if (m.type === 'caps' && typeof m.screenId === 'string' && SRP.SCREEN_ID_RE.test(m.screenId)) L.senders.set(r.sender, m.screenId);
  if (m.type !== 'caps' && m.type !== 'screen:alive') return;
  const sid = L.senders.get(r.sender);
  if (sid) rkServe(L, sid);
}
// Un écran resté sur l'ancien topic : la session en cours s'il peut suivre, sinon le retrait
async function rkServe(L, sid) {
  const now = Date.now();
  if (now - (L.last.get(sid) || 0) < RK_RESEND_MS || !_session || mode !== 'remote') return;
  L.last.set(sid, now);
  const keys = !L.rec.revoked.includes(sid) && scrKnown(sid) ? await pwKeys(sid) : null;
  if (keys) {
    rkPublish(L, L.ch.sealPairwise(rkMessage(sid, _scrReg.screens.get(sid), _session), keys));
    return;
  }
  const reason = L.rec.revoked.includes(sid) || !scrKnown(sid) ? 'revoked' : 'renewed';
  rkPublish(L, L.ch.seal({ type: 'screen:revoked', reason, target: { screens: [sid] } }));
}

// ══════════ Écran : clé par écran ══════════
let _pw = null;        // clé établie { rid, s, kid, ch, keys }
let _pwPending = null; // échange en cours { rid, xid, s, kid, keys }
async function screenPwLoad() {
  const r = screenStoredPairwise();
  _pwPending = null;
  _pw = r ? Object.assign(r, { keys: await SRP.pairwiseKeys(r.s, { remoteId: r.rid, screenId: screenId() }).catch(() => null) }) : null;
  if (_pw && !_pw.keys) _pw = null;
}
// Rejoindre une AUTRE session (QR, code) : la clé d'une autre lignée est effacée
function screenPwOnJoin(p) {
  const r = screenStoredPairwise();
  if (r && (!p || r.ch !== p.channelId)) screenSavePairwise(null);
}
function screenPwWipe() { screenSavePairwise(null); _pw = null; _pwPending = null; }
function screenPairwiseCandidates() {
  const c = [];
  if (_pw && _pw.keys) c.push({ keys: _pw.keys, tag: 'active' });
  if (_pwPending && _pwPending.keys) c.push({ keys: _pwPending.keys, tag: 'pending' });
  return c;
}
// key:offer (session, adressé à cet écran)
async function screenOnKeyOffer(m) {
  if (!_session) return;
  if (_pw && _pw.rid === m.rid) return; // clé déjà établie avec cette télécommande : la première est retenue
  const ch = _session.channelId, me = screenId();
  let r, keys;
  try {
    const kp = await SRP.ecdhKeyPair();
    r = await SRP.derivePairwiseSecret(kp, { offerJwk: m.jwk, answerJwk: kp.publicJwk, channelId: ch, remoteId: m.rid, screenId: me, exchangeId: m.xid });
    keys = await SRP.pairwiseKeys(r.secret, { remoteId: m.rid, screenId: me });
    if (!_session || _session.channelId !== ch) return;
    _pwPending = { rid: m.rid, xid: m.xid, s: r.secret, kid: r.kid, keys };
    sendMsg({ type: 'key:answer', sid: me, rid: m.rid, xid: m.xid, jwk: kp.publicJwk });
  } catch (_) {}
}
// Trame pairwise ouverte (tag : clé établie « active » ou échange « pending »)
function screenOnPairwise(m, tag) {
  const me = screenId();
  if (m.sid !== me) return;
  // Clé de l'échange en cours : key:confirm, ou une session:rekey scellée avec
  // elle (key:confirm perdu) — seule la télécommande qui a fait l'échange la
  // détient : la clé est adoptée
  if (tag === 'pending' && _pwPending && m.rid === _pwPending.rid
      && ((m.type === 'key:confirm' && m.xid === _pwPending.xid) || m.type === 'session:rekey')) {
    const p = _pwPending;
    _pwPending = null;
    _pw = { rid: p.rid, s: p.s, kid: p.kid, ch: _session.channelId, keys: p.keys };
    screenSavePairwise(_pw);
    sendPairwise({ type: 'key:ok', sid: me, xid: p.xid }, _pw.keys);
    if (m.type === 'session:rekey') screenOnRekey(m);
  } else if (m.type === 'session:rekey' && tag === 'active' && _pw && m.rid === _pw.rid) {
    screenOnRekey(m);
  }
}
// Nouvelle session remise par la télécommande (retrait d'un autre écran) :
// accusé sur l'ancien topic, puis bascule, sans rien effacer de l'affichage
async function screenOnRekey(m) {
  const p = { channelId: m.channelId, key: m.key };
  if (!SRP.isValidPairing(p) || !_session || _session.channelId === p.channelId) return;
  await sendPairwise({ type: 'rekey:ok', sid: screenId(), channelId: p.channelId }, _pw.keys);
  screenSaveSession(p);
  _pw.ch = p.channelId;
  screenSavePairwise(_pw);
  _session = p;
  _screenCfg = { name: typeof m.name === 'string' ? scrCleanName(m.name) : _screenCfg.name, groups: Array.isArray(m.groups) ? m.groups.slice() : _screenCfg.groups };
  screenSaveConfig(p, _screenCfg);
  renderScreenIdentity();
  connectSession(p, screenOnSessionConnected);
}

// ══════════ Écran retiré (maquette 5c) ══════════
// screen:revoked (session, adressé à cet écran) : session et clés effacées,
// plus aucune connexion ; « Rejoindre une session » mène à l'appairage.
function screenOnRevoked(m) {
  screenSaveSession(null);
  _lsSet(_LS_KEYS.screenConfig, null);
  screenPwWipe();
  _screenCfg = { name: '', groups: [] };
  renderScreenIdentity();
  goBackToSplash(); // arrête tout (médias, appel, effets, strobe, torche) et ferme la session
  _session = null;
  showScreenRevoked(m && m.reason === 'renewed' ? 'renewed' : 'revoked');
}
const _REVOKED_TEXT = {
  revoked: 'La télécommande a retiré cet écran de la session. Il ne reçoit plus aucune commande.',
  renewed: 'La télécommande a renouvelé sa session sans pouvoir y inviter cet écran. Appairez-le de nouveau pour le réutiliser.',
};
function showScreenRevoked(reason) {
  document.getElementById('splash').style.display = 'none';
  const t = document.getElementById('srvText');
  if (t) t.textContent = _REVOKED_TEXT[reason] || _REVOKED_TEXT.revoked;
  document.getElementById('screen-revoked').style.display = 'flex';
}
function hideScreenRevoked() { document.getElementById('screen-revoked').style.display = 'none'; }
function screenRevokedJoin() { hideScreenRevoked(); startMode('screen'); }
function screenRevokedHome() { hideScreenRevoked(); document.getElementById('splash').style.display = 'flex'; }
