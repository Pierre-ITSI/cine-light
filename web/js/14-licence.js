// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ LICENCE TEL + SÉQUENCE : identité, vérification, statistiques ══════════════════════════
// Version officielle seulement (01-config.js : LICENSING 'on', LICENCE_PUBKEY
// et un service, LICENCE_API ou l'hôte du relais). Sinon LIC_ON = false : rien
// ne tourne, aucune clé n'est créée, aucune requête ne part, tout est débloqué.
// Contrat client complet : docs/LICENCE-API.md ; aperçu et Réglages :
// 77-licence-ui.js.
//
// Identifiant d'appareil : paire ECDSA P-256 créée sur l'appareil (WebCrypto),
// clé privée NON extractible, rangée dans IndexedDB (setremote-licence). id =
// base32 de Crockford des 40 premiers bits de SHA-256(SPKI) : « K7Q2-9XMB ».
// L'id dérive de la clé publique : recopié ailleurs, il ne sert à rien sans la
// clé privée. Sans IndexedDB utilisable (certaines vues web en file://), repli :
// clé extractible en localStorage (JWK), pour que l'identifiant reste stable ;
// elle ne quitte jamais l'appareil.
//
// Vérification (POST /api/v1/licence/check) : au lancement, toutes les 6 h tant
// que l'app est ouverte et en ligne, et sur « Vérifier maintenant ». Requête
// signée (srlic1|id|ts|nonce). Le jeton reçu est signé par le service (ECDSA
// P-256 / SHA-256, signature brute r||s) : vérifié avec LICENCE_PUBKEY, gardé
// en localStorage (il n'a rien de secret), valable hors ligne jusqu'à exp. Un
// échec réseau garde le dernier jeton valide ; un jeton valide sans
// fonctionnalité (licence échue, révoquée) le remplace. Jamais d'exception.
//
// Statistiques anonymes (POST /api/v1/stats) : au plus une fois par jour et par
// mode (télécommande, écran), seulement { os, ver, mode, inst } ; ni
// identifiant, ni clé. L'appareil ne retient que la date du dernier envoi.
const LIC_ON = LICENSING === 'on' && !!LICENCE_PUBKEY && !!LICENCE_API;
const LIC_LS_KEY = 'setremote-licence-v1';       // { token, checked } : dernier jeton valide
const LIC_KEY_LS = 'setremote-licence-key-v1';   // repli sans IndexedDB : { priv, pub } (JWK)
const LIC_STATS_KEY = 'setremote-stats-v1';      // { remote: 'AAAA-MM-JJ', screen: … }
const LIC_DB = 'setremote-licence';
const LIC_EVERY_MS = 6 * 3600e3;
const LIC_SKEW_MS = 10 * 60e3;
const LIC_TIMEOUT_MS = 15e3;
const LIC_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LIC_ID_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

// État : identité, jeton vérifié, dernière vérification
const _lic = {
  id: null, pub: null, priv: null, idP: null,
  payload: null, token: null, checked: 0,  // dernier jeton valide et date de sa réception
  busy: false, error: '',                   // vérification en cours, dernier échec ('offline', 'server', 'invalid')
  listeners: [], timer: null, tick: null, granted: '',
};

// ── Base64url, base32 de Crockford ──
function _licB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _licUnB64u(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) return null;
  try {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch (_) { return null; }
}
// 40 premiers bits → 8 symboles (5 bits chacun), affichés « XXXX-XXXX »
function licIdFromHash(hash) {
  const h = new Uint8Array(hash);
  let v = 0n;
  for (let i = 0; i < 5; i++) v = (v << 8n) | BigInt(h[i]);
  let s = '';
  for (let i = 7; i >= 0; i--) s += LIC_ALPHABET[Number((v >> BigInt(i * 5)) & 31n)];
  return s.slice(0, 4) + '-' + s.slice(4);
}
// Saisie libre → forme canonique « XXXX-XXXX » (null si invalide) :
// espaces et tirets retirés, majuscules, O → 0, I et L → 1
function licNormalizeId(input) {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s-]/g, '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return s.slice(0, 4) + '-' + s.slice(4);
}
async function licDeriveId(spki) {
  return licIdFromHash(await crypto.subtle.digest('SHA-256', spki));
}

// ── Identité de l'appareil (créée à la première demande) ──
const _LIC_EC = { name: 'ECDSA', namedCurve: 'P-256' };
function _licDb() {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) { resolve(null); return; }
      const req = indexedDB.open(LIC_DB, 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('keys'); } catch (_) {} };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}
function _licDbDo(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('keys', mode);
      const r = fn(tx.objectStore('keys'));
      tx.oncomplete = () => resolve(r && 'result' in r ? r.result : true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch (_) { resolve(null); }
  });
}
async function _licKeysFromLs() {
  try {
    const o = JSON.parse(_lsGet(LIC_KEY_LS));
    if (!o || !o.priv || !o.pub) return null;
    return {
      priv: await crypto.subtle.importKey('jwk', o.priv, _LIC_EC, false, ['sign']),
      pub: await crypto.subtle.importKey('jwk', o.pub, _LIC_EC, true, ['verify']),
    };
  } catch (_) { return null; }
}
async function _licKeysToLs() {
  const kp = await crypto.subtle.generateKey(_LIC_EC, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey), pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  if (!_lsPut(LIC_KEY_LS, JSON.stringify({ priv, pub }))) return null;
  return _licKeysFromLs();
}
async function _licLoadKeys() {
  const db = await _licDb();
  if (db) {
    const rec = await _licDbDo(db, 'readonly', (st) => st.get('device'));
    if (rec && rec.priv && rec.pub) return rec;
    const ls = await _licKeysFromLs(); // repli d'un lancement précédent
    if (ls) return ls;
    const kp = await crypto.subtle.generateKey(_LIC_EC, false, ['sign', 'verify']);
    const ok = await _licDbDo(db, 'readwrite', (st) => st.put({ priv: kp.privateKey, pub: kp.publicKey }, 'device'));
    if (ok) {
      // Relue : une écriture refusée sans erreur (moteur sans clés dans IndexedDB) passe au repli
      const back = await _licDbDo(db, 'readonly', (st) => st.get('device'));
      if (back && back.priv && back.pub) return back;
    }
  }
  return (await _licKeysFromLs()) || _licKeysToLs();
}
// Promesse de l'identité { id, pub (SPKI b64url) } ; null si WebCrypto manque
function licIdentity() {
  if (_lic.idP) return _lic.idP;
  _lic.idP = (async () => {
    try {
      if (!(window.crypto && crypto.subtle)) return null;
      const k = await _licLoadKeys();
      if (!k) return null;
      const spki = await crypto.subtle.exportKey('spki', k.pub);
      _lic.priv = k.priv;
      _lic.pub = _licB64u(spki);
      _lic.id = await licDeriveId(spki);
      _licEmit();
      return { id: _lic.id, pub: _lic.pub };
    } catch (e) {
      console.warn('SetRemote : identifiant d\'appareil', e && e.message);
      return null;
    }
  })();
  return _lic.idP;
}
function licDeviceId() { return _lic.id; }

// ── Jeton ──
let _licKeyP = null;
function _licServerKey() {
  return (_licKeyP ||= crypto.subtle.importKey('spki', _licUnB64u(LICENCE_PUBKEY), _LIC_EC, false, ['verify']).catch(() => null));
}
// Charge utile vérifiée, ou null (signature, forme, appareil)
async function licVerifyToken(token) {
  try {
    if (typeof token !== 'string' || token.length > 4096) return null;
    const [p, s, extra] = token.split('.');
    const sig = _licUnB64u(s), raw = _licUnB64u(p);
    if (extra !== undefined || !raw || !sig || sig.length !== 64) return null;
    const key = await _licServerKey();
    if (!key) return null;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(p));
    if (!ok) return null;
    const o = JSON.parse(new TextDecoder().decode(raw));
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!o || o.v !== 1 || typeof o.id !== 'string' || !LIC_ID_RE.test(o.id) || !Array.isArray(o.features) || !num(o.iat) || !num(o.exp)) return null;
    const dev = o.devices && typeof o.devices === 'object' && num(o.devices.n) && num(o.devices.max) ? { n: o.devices.n, max: o.devices.max } : null;
    return {
      id: o.id, features: o.features.filter((f) => f === 'tel' || f === 'seq'),
      holder: typeof o.holder === 'string' ? o.holder.slice(0, 80) : '', end: num(o.end) ? o.end : null,
      devices: dev, iat: o.iat, exp: o.exp,
    };
  } catch (_) { return null; }
}
// Fonctionnalité accordée : jeton valide, pour cet appareil, pas expiré
function licenceHas(f) {
  if (!LIC_ON) return true;
  const p = _lic.payload;
  return !!p && !!_lic.id && p.id === _lic.id && p.features.includes(f) && Date.now() < p.exp + LIC_SKEW_MS;
}
// État pour l'affichage (Réglages, 77-licence-ui.js)
function licStatus() {
  const p = _lic.payload && _lic.payload.id === _lic.id ? _lic.payload : null;
  const active = !!p && p.features.length > 0 && Date.now() < p.exp + LIC_SKEW_MS;
  return { on: LIC_ON, id: _lic.id, active, payload: p, checked: _lic.checked, busy: _lic.busy, error: _lic.error };
}
function licOnChange(fn) { _lic.listeners.push(fn); }
function _licEmit() {
  _lic.granted = ['tel', 'seq'].filter(licenceHas).join(',');
  for (const fn of _lic.listeners) { try { fn(); } catch (e) { console.warn('SetRemote : licence', e && e.message); } }
}
async function _licAccept(token, checked) {
  const p = await licVerifyToken(token);
  if (!p || p.id !== _lic.id) return false;
  // Jeton plus ancien que celui qu'on a (réponses croisées) : ignoré
  if (_lic.payload && p.iat < _lic.payload.iat) return false;
  _lic.payload = p; _lic.token = token; _lic.checked = checked;
  return true;
}

// ── Informations envoyées avec la vérification et les statistiques ──
function licAppInfo() {
  const ua = navigator.userAgent || '';
  const nat = IN_NATIVE_APP && window.SETREMOTE_NATIVE.platform;
  let os = 'other';
  if (nat === 'ios' || nat === 'android') os = nat;
  else if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = 'ios';
  else if (/Android/.test(ua)) os = 'android';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macos';
  else if (/Windows/.test(ua)) os = 'windows';
  else if (/Linux|CrOS/.test(ua)) os = 'linux';
  const inst = IN_NATIVE_APP ? 'native' : _isStandalone() ? 'pwa' : 'browser';
  return { os, ver: APP_VERSION, inst };
}
async function _licPost(path, body) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), LIC_TIMEOUT_MS) : null;
  try {
    return await fetch(LICENCE_API + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined,
    });
  } finally { if (t) clearTimeout(t); }
}

// ── Vérification ──
// Résultat : 'ok' (jeton reçu et valide), 'offline', 'server' (refus, réponse
// inexploitable), 'invalid' (jeton à la signature invalide), 'off'
async function licCheck() {
  if (!LIC_ON) return 'off';
  if (_lic.busy) return 'busy';
  _lic.busy = true; _licEmit();
  let res = 'server';
  try {
    const me = await licIdentity();
    if (!me) { res = 'server'; return res; }
    const ts = Date.now();
    const nonce = _licB64u(crypto.getRandomValues(new Uint8Array(16)));
    const msg = new TextEncoder().encode('srlic1|' + me.id + '|' + ts + '|' + nonce);
    const sig = _licB64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, _lic.priv, msg));
    let r;
    try { r = await _licPost('/api/v1/licence/check', { v: 1, id: me.id, pub: me.pub, ts, nonce, sig, app: licAppInfo() }); } catch (_) { res = 'offline'; return res; }
    if (!r.ok) { res = 'server'; return res; }
    let o = null;
    try { o = await r.json(); } catch (_) { o = null; }
    if (!o || typeof o.token !== 'string') { res = 'server'; return res; }
    res = (await _licAccept(o.token, Date.now())) ? 'ok' : 'invalid';
    if (res === 'ok') _lsPut(LIC_LS_KEY, JSON.stringify({ token: _lic.token, checked: _lic.checked }));
    return res;
  } catch (e) {
    console.warn('SetRemote : vérification de licence', e && e.message);
    return res;
  } finally {
    _lic.busy = false;
    _lic.error = res === 'ok' ? '' : res;
    _licEmit();
  }
}
// Démarrage (99-init.js) : identité, jeton gardé, vérification, minuteries
async function licStart() {
  if (!LIC_ON) return;
  await licIdentity();
  try {
    const o = JSON.parse(_lsGet(LIC_LS_KEY));
    if (o && typeof o.token === 'string') await _licAccept(o.token, typeof o.checked === 'number' ? o.checked : 0);
  } catch (_) {}
  _licEmit();
  const due = () => navigator.onLine !== false && Date.now() - _lic.checked >= LIC_EVERY_MS - 60e3;
  if (!_lic.timer) {
    _lic.timer = setInterval(() => { if (due()) licCheck(); }, 15 * 60e3);
    // Échéance du jeton atteinte pendant l'utilisation : l'aperçu revient
    _lic.tick = setInterval(() => { if (['tel', 'seq'].filter(licenceHas).join(',') !== _lic.granted) _licEmit(); }, 60e3);
    window.addEventListener('online', () => { if (due()) licCheck(); });
  }
  await licCheck();
}

// ── Statistiques anonymes (30-navigation.js : choix du mode) ──
const _licStatsBusy = new Set();
function _licToday() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
async function licStatsPing(mode) {
  if (!LIC_ON || (mode !== 'remote' && mode !== 'screen') || _licStatsBusy.has(mode)) return false;
  let o = null;
  try { o = JSON.parse(_lsGet(LIC_STATS_KEY)); } catch (_) { o = null; }
  if (!o || typeof o !== 'object') o = {};
  const day = _licToday();
  if (o[mode] === day) return false;
  _licStatsBusy.add(mode);
  try {
    const a = licAppInfo();
    const r = await _licPost('/api/v1/stats', { v: 1, os: a.os, ver: a.ver, mode, inst: a.inst });
    if (!r.ok) return false;
    o[mode] = day;
    _lsPut(LIC_STATS_KEY, JSON.stringify({ remote: o.remote, screen: o.screen }));
    return true;
  } catch (_) { return false; } finally { _licStatsBusy.delete(mode); }
}
