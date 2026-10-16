// ══════════════════════════ PASSERELLE DMX (télécommande en mode passerelle) ══════════════════════════
// La télécommande, dans l'app native, reçoit le sACN ou l'Art-Net de la
// console (UDP, impossible dans un navigateur) et pilote chaque écran patché
// comme une fixture. Le moteur est packages/dmx (globale SRDMX) ; le natif ne
// fait que l'UDP (expo-app/modules/setremote-udp). Contrat du pont
// (docs/DMX-NATIVE.md § 9, côté page : § 10) :
//   PWA → coque (nativePost)  dmx:listen { protocol, universes, multicast } · dmx:stop
//                              udp:send { host, port, data (base64) } · net:info
//   coque → PWA (window.SRNative.receive, 00-native-bridge.js)
//                              dmx:packets { packets: [{ src, port, data }] } · net:info { interfaces } · dmx:error { reason }
// La coque n'envoie pas net:info d'elle-même au démarrage : la page le demande
// à chaque ouverture de la passerelle. Les lots de dmx:packets arrivent toutes
// les 20 ms sans accusé de réception : chacun est traité aussitôt.
// Le moteur envoie, dans la session chiffrée, un « dmx:look » par écran (au
// changement, ≤ 30/s, maintien chaque seconde, live:false une fois à la perte
// du signal), et déclenche les entrées n° n des listes d'appels / SMS
// enregistrées (82-call-list.js) par les messages call:start / call:end
// habituels, ciblés sur les écrans concernés.
// Le patch (écran → univers, adresse, mode) est mémorisé par session.
const DMX_LS_KEY = 'setremote-dmx-v1';
const DMX_PATCH_SESSIONS_MAX = 8;
const DMX_DEFAULT_PERSONALITY = 'extended16';
const DMX_LED_MS = 80;           // durée d'un éclat du voyant de réception
const DMX_SIGNAL_MS = 1000;      // « Signal reçu » : un paquet dans la dernière seconde
const DMX_MAX_PACKETS = 2000;    // par lot remonté par la coque
const DMX_MAX_B64 = 4096;        // plus grand datagramme utile (découverte sACN) ≈ 1,5 Ko en base64
const DMX_MAX_UNIVERSES = 64;    // par dmx:listen (contrat du pont)

let _gw = null; // passerelle en marche : { engine, statsTimer, pendingTrig, trigChain }
const gwState = {
  protocol: 'sacn',
  multicast: true,               // sACN : groupes 239.255.x.y ; Art-Net : ArtPoll en broadcast (abandonné après un refus)
  multicastRefused: null,        // 'multicast-not-permitted' | 'multicast-failed' : l'unicast continue (conseil affiché)
  patch: new SRDMX.Patch(),
  patchSession: null,            // channelId de la session dont le patch est chargé
  ifaces: [], iface: null,       // interfaces annoncées par la coque (net:info)
  error: null,                   // dernier dmx:error
  rx: new Map(),                 // 'protocole:univers' → { protocol, universe, ip, lastAt, count, hz }
  lastPacketAt: -Infinity,
  ledBlinks: 0,
};

// ── Persistance : protocole + patch par session (les 8 plus récentes) ──
function _gwStore() {
  try {
    const o = JSON.parse(_lsGet(DMX_LS_KEY));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_) { return {}; }
}
function gwLoadSettings() {
  const o = _gwStore();
  if (o.protocol === 'sacn' || o.protocol === 'artnet') gwState.protocol = o.protocol;
}
function gwLoadPatch() {
  const sid = _session && _session.channelId;
  const rec = sid ? (_gwStore().patches || {})[sid] : null;
  let p = new SRDMX.Patch();
  if (rec && rec.patch) { try { p = SRDMX.Patch.fromJSON(rec.patch); } catch (_) { p = new SRDMX.Patch(); } }
  gwState.patch = p;
  gwState.patchSession = sid || null;
}
function gwSave() {
  const o = _gwStore();
  o.v = 1;
  o.protocol = gwState.protocol;
  const sid = gwState.patchSession;
  if (sid) {
    const pts = (o.patches && typeof o.patches === 'object') ? o.patches : {};
    pts[sid] = { patch: gwState.patch.toJSON(), at: Date.now() };
    const ids = Object.keys(pts).sort((a, b) => (pts[b].at || 0) - (pts[a].at || 0));
    for (const id of ids.slice(DMX_PATCH_SESSIONS_MAX)) delete pts[id];
    o.patches = pts;
  }
  _lsSet(DMX_LS_KEY, JSON.stringify(o));
}

// ── Base64 (datagrammes de la coque, ArtPollReply vers la coque) ──
function _gwB64Decode(s) {
  try {
    const bin = atob(s);
    const b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  } catch (_) { return null; }
}
function _gwB64Encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ── Marche / arrêt ──
function gwRunning() { return !!_gw; }

function gwStart() {
  if (!IN_NATIVE_APP || mode !== 'remote') return false;
  if (_gw) return true;
  gwLoadSettings();
  gwLoadPatch();
  gwState.rx.clear();
  gwState.error = null;
  const engine = new SRDMX.GatewayEngine({
    patch: new SRDMX.Patch(gwState.patch.toJSON()),
    send: gwSendToScreens,
    sendUdp: (bytes, host, port) => nativePost({ type: 'udp:send', host, port, data: _gwB64Encode(bytes) }),
    artPollReply: gwArtPollIdentity(),
    onTrigger: gwOnTrigger,
  });
  _gw = { engine, pendingTrig: [], trigChain: Promise.resolve(), statsTimer: setInterval(gwStatsTick, 1000) };
  gwSyncTriggerEntries();
  engine.start();
  gwListen();
  gwRender();
  return true;
}

// Arrêt : chaque écran garde son look (live:false) et la télécommande reprend
// la main. nativeStopped : la coque a déjà arrêté l'écoute (erreur fatale).
function gwStop(nativeStopped) {
  if (!_gw) return;
  const g = _gw;
  _gw = null;
  clearInterval(g.statsTimer);
  g.engine.stop();
  if (!nativeStopped) nativePost({ type: 'dmx:stop' });
  gwState.rx.clear();
  gwState.lastPacketAt = -Infinity;
  gwRender();
}

function gwToggleRun() { if (_gw) gwStop(); else gwStart(); }

// Écoute UDP (remplace la précédente) : univers du patch, sinon le premier.
// multicast : sACN = groupes 239.255.x.y, Art-Net = ArtPoll en broadcast
// (Android : MulticastLock) ; abandonné après un refus, l'unicast suffit.
function gwListen() {
  if (!_gw) return;
  const p = gwState.protocol;
  let universes = gwState.patch.universes(p).slice(0, DMX_MAX_UNIVERSES);
  if (!universes.length) universes = [p === 'sacn' ? 1 : 0];
  nativePost({ type: 'dmx:listen', protocol: p, universes, multicast: gwState.multicast });
}

// Nouvelle session (« Nouvelle session ») : le patch de cette session s'applique
function gwOnSessionChanged() {
  if (!_gw) return;
  _gw.engine.releaseAll();
  gwLoadPatch();
  _gw.engine.setPatch(new SRDMX.Patch(gwState.patch.toJSON()));
  gwListen();
  gwRender();
}

// ── Coque → PWA ──
function gwOnNativePackets(packets) {
  if (!_gw || !Array.isArray(packets)) return false;
  const n = Math.min(packets.length, DMX_MAX_PACKETS);
  let got = 0;
  for (let i = 0; i < n && _gw; i++) {
    const p = packets[i];
    if (!p || typeof p.data !== 'string' || p.data.length > DMX_MAX_B64) continue;
    const bytes = _gwB64Decode(p.data);
    if (!bytes) continue;
    const src = typeof p.src === 'string' ? p.src.slice(0, 64) : '';
    const r = _gw.engine.handlePacket(bytes, { address: src, port: Number.isInteger(p.port) ? p.port : undefined });
    if (!r.ok) continue;
    got++;
    _gwNoteRx(r, bytes, src);
  }
  if (got) gwLedPulse();
  gwScheduleRender();
  return true;
}

const _GW_DROPPED = ['ignored-preview', 'out-of-sequence', 'ignored-extra-source', 'terminated'];
function _gwNoteRx(r, b, src) {
  let universe = null;
  if (r.protocol === 'sacn' && r.kind === 'data') universe = (b[113] << 8) | b[114];
  else if (r.protocol === 'artnet' && r.kind === 'dmx') universe = ((b[15] & 0x7f) << 8) | b[14];
  if (universe === null || _GW_DROPPED.includes(r.outcome)) return;
  const k = r.protocol + ':' + universe;
  let s = gwState.rx.get(k);
  if (!s) {
    if (gwState.rx.size >= 64) return;
    s = { protocol: r.protocol, universe, ip: '', lastAt: 0, count: 0, hz: 0 };
    gwState.rx.set(k, s);
  }
  s.ip = src;
  s.lastAt = Date.now();
  s.count++;
}

// Cadence (paquets par seconde) de chaque univers, rafraîchie chaque seconde
function gwStatsTick() {
  for (const s of gwState.rx.values()) { s.hz = s.count; s.count = 0; }
  gwRender();
}

// Voyant : un éclat à chaque paquet. Allumé DMX_LED_MS puis éteint au moins
// autant : à 44 paquets/s il clignote nettement au lieu de rester allumé.
let _gwLedTimer = null;
function gwLedPulse() {
  gwState.lastPacketAt = Date.now();
  const led = document.getElementById('gwLed');
  if (!led || _gwLedTimer) return;
  led.classList.add('rx', 'blink');
  gwState.ledBlinks++;
  _gwLedTimer = setTimeout(() => {
    led.classList.remove('blink');
    _gwLedTimer = setTimeout(() => { _gwLedTimer = null; }, DMX_LED_MS);
  }, DMX_LED_MS);
}

const _IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function gwOnNetInfo(list) {
  if (!Array.isArray(list)) return false;
  const ifaces = [];
  for (const it of list.slice(0, 16)) {
    if (!it || typeof it !== 'object' || typeof it.ip !== 'string' || !_IPV4_RE.test(it.ip)) continue;
    ifaces.push({
      name: typeof it.name === 'string' ? it.name.slice(0, 32) : '',
      kind: ['ethernet', 'wifi'].includes(it.kind) ? it.kind : 'other',
      ip: it.ip,
      mask: typeof it.mask === 'string' && _IPV4_RE.test(it.mask) ? it.mask : '',
    });
  }
  gwState.ifaces = ifaces;
  // Interface affichée : filaire d'abord (configuration conseillée), puis Wi-Fi
  const rank = { ethernet: 0, wifi: 1, other: 2 };
  gwState.iface = ifaces.slice().sort((a, b) => rank[a.kind] - rank[b.kind])[0] || null;
  if (_gw) _gw.engine.artPollReply = gwArtPollIdentity();
  gwRender();
  return true;
}

// Identité annoncée en réponse aux ArtPoll (Art-Net) : il faut l'IP de l'appareil
function gwArtPollIdentity() {
  const ip = gwState.iface && gwState.iface.ip;
  return ip ? { ip, shortName: 'SetRemote GW', longName: 'SetRemote passerelle DMX' } : null;
}

// dmx:error : raisons de la coque (expo-app/modules/setremote-udp/src/bridge.ts,
// docs/DMX-NATIVE.md § 9.2).
//   multicast-not-permitted / multicast-failed : l'unicast continue → conseil
//     « unicast » affiché, plus de multicast demandé ensuite (pas de réécoute) ;
//   bind-failed / socket-failed / listen-failed : la coque a arrêté l'écoute →
//     passerelle arrêtée (les écrans gardent leur look), « Démarrer » relance ;
//   native-unavailable : binaire sans le module → passerelle arrêtée.
const GW_FATAL_REASONS = ['bind-failed', 'socket-failed', 'listen-failed', 'native-unavailable'];
function gwOnNativeError(reason) {
  const r = typeof reason === 'string' && /^[a-z0-9-]{1,40}$/.test(reason) ? reason : 'unknown';
  if (r === 'multicast-not-permitted' || r === 'multicast-failed') {
    gwState.multicast = false;
    gwState.multicastRefused = r;
  } else {
    gwState.error = r;
    if (GW_FATAL_REASONS.includes(r)) gwStop(true);
  }
  gwRender();
  return true;
}

// ── Vers les écrans ──
// dmx:look part tel quel. Les déclenchements (call:start / call:end) sont mis
// de côté jusqu'à onTrigger (appelé juste après, avec le n° d'entrée) puis
// envoyés dans l'ordre : photo et bande son de l'entrée d'abord.
function gwSendToScreens(msg) {
  if (msg.type === 'call:start' || msg.type === 'call:end') { if (_gw) _gw.pendingTrig.push(msg); return; }
  sendMsg(msg);
}

function gwOnTrigger(t) {
  if (!_gw) return;
  const msgs = _gw.pendingTrig.splice(0);
  if (!msgs.length) return;
  const list = callList[t.kind === 'call' ? 'call' : 'sms'];
  const entry = t.index > 0 ? list[t.index - 1] || null : null;
  _gw.trigChain = _gw.trigChain.then(async () => {
    if (entry) await sendCallEntry(entry, msgs.map((m) => m.target));
    else for (const m of msgs) sendMsg(m); // call:end (raccrocher / fermer la notification)
  }).catch(() => {});
}

// Entrées 1 à 20 des listes enregistrées → canaux Appel et SMS. Leurs sons
// importés partent d'avance vers les écrans : un appel déclenché par la
// console sonne aussitôt, sans transfert.
function gwSyncTriggerEntries() {
  if (!_gw) return;
  const conv = (e) => ({ kind: e.kind, style: e.style, name: e.name });
  _gw.engine.setTriggerEntries({
    call: callList.call.slice(0, CALL_LIST_DMX_ITEMS).map(conv),
    sms: callList.sms.slice(0, CALL_LIST_DMX_ITEMS).map(conv),
  });
  ringPreloadGatewayEntries();
}

// ── Patch ──
// Écrans proposés : appairés (screenId annoncé dans caps), puis patchés absents
function gwKnownScreens() {
  const ids = [];
  const seen = new Set(_screenOfSender.values());
  const paired = [..._pairedScreens.entries()].filter(([id]) => seen.has(id)).sort((a, b) => a[1].n - b[1].n);
  for (const [id] of paired) ids.push(id);
  for (const id of gwState.patch.ids()) if (!ids.includes(id)) ids.push(id);
  return ids;
}
// Nom donné sur la télécommande (28-screens.js), sinon « Écran n »
function gwScreenName(id) { return scrName(id); }
// Ordre d'affichage : patchés par univers puis adresse, puis non patchés
function gwPatchOrder() {
  const p = gwState.patch;
  const known = gwKnownScreens();
  const patched = known.filter((id) => p.has(id)).sort((a, b) => {
    const ea = p.get(a), eb = p.get(b);
    return ea.universe - eb.universe || ea.address - eb.address || known.indexOf(a) - known.indexOf(b);
  });
  return patched.concat(known.filter((id) => !p.has(id)));
}
function gwDefaultUniverse() {
  const us = gwState.patch.universes(gwState.protocol);
  return us.length ? us[0] : (gwState.protocol === 'sacn' ? 1 : 0);
}
// Première adresse libre après les écrans de l'univers (proposition pour un nouvel écran)
function gwNextAddress(universe, personality) {
  let next = 1;
  for (const [, e] of gwState.patch.entries()) {
    if (e.protocol === gwState.protocol && e.universe === universe) next = Math.max(next, SRDMX.lastChannel(e) + 1);
  }
  return next + SRDMX.footprint(personality) - 1 <= 512 ? next : 1;
}
function gwProposedEntry(id) {
  const e = gwState.patch.get(id);
  if (e) return e;
  const universe = gwDefaultUniverse();
  return { protocol: gwState.protocol, universe, address: gwNextAddress(universe, DMX_DEFAULT_PERSONALITY), personality: DMX_DEFAULT_PERSONALITY };
}

function gwPatchChanged() {
  gwSave();
  if (_gw) { _gw.engine.setPatch(new SRDMX.Patch(gwState.patch.toJSON())); gwListen(); }
  gwRender();
}

// Ajoute ou modifie le patch d'un écran ; false si la valeur est invalide
function gwPatchSet(id, changes) {
  if (!gwState.patchSession) gwLoadPatch();
  const next = Object.assign({}, gwProposedEntry(id), changes, { protocol: gwState.protocol });
  delete next.name;
  if (SRDMX.validateEntry(id, next).length) return false;
  gwState.patch.set(id, next);
  gwPatchChanged();
  return true;
}

function gwPatchDelete(id) {
  if (!gwState.patch.delete(id)) return false;
  gwPatchChanged(); // le moteur rend l'écran à la télécommande (live:false)
  return true;
}

// Auto-adressage : écrans à la suite (patchés d'abord, dans l'ordre affiché),
// chacun avec son mode, à partir de l'adresse 1 du premier univers
function gwAutoAddress() {
  if (!gwState.patchSession) gwLoadPatch();
  const ids = gwPatchOrder();
  if (!ids.length) return { overflow: [] };
  const personalities = {};
  for (const id of ids) personalities[id] = (gwState.patch.get(id) || {}).personality || DMX_DEFAULT_PERSONALITY;
  const r = gwState.patch.autoAddress(ids, { protocol: gwState.protocol, universe: gwDefaultUniverse(), startAddress: 1, personalities });
  gwPatchChanged();
  return r;
}

// Protocole de la passerelle : tous les écrans patchés suivent
function gwSetProtocol(p) {
  if ((p !== 'sacn' && p !== 'artnet') || p === gwState.protocol) return;
  if (!gwState.patchSession) gwLoadPatch();
  if (_gw) _gw.engine.releaseAll();
  gwState.protocol = p;
  gwState.error = null;
  const [uMin, uMax] = SRDMX.UNIVERSE_RANGE[p];
  const next = new SRDMX.Patch();
  for (const [id, e] of gwState.patch.entries()) {
    next.set(id, { protocol: p, universe: Math.min(uMax, Math.max(uMin, e.universe)), address: e.address, personality: e.personality });
  }
  gwState.patch = next;
  gwState.rx.clear();
  gwPatchChanged();
}

// ── État pour l'interface ──
function gwSnapshot() { return _gw ? _gw.engine.snapshot() : { universes: [], screens: [], counters: null }; }

// Écran sous contrôle de la console (badge « Console »)
function gwScreenLive(id) {
  const s = gwSnapshot().screens.find((x) => x.id === id);
  return !!(s && s.live);
}

// Valeurs DMX actuelles de l'empreinte d'un écran (0 si rien reçu)
function gwScreenSlice(e) {
  const out = new Array(SRDMX.footprint(e.personality)).fill(0);
  if (!_gw) return out;
  const u = (e.protocol === 'sacn' ? _gw.engine.sacn : _gw.engine.artnet).getUniverse(e.universe);
  if (!u || !u.data) return out;
  for (let i = 0; i < out.length; i++) {
    const a = e.address + i;
    out[i] = a <= 512 ? u.data[a - 1] : 0;
  }
  return out;
}

function gwIdentify(id) {
  const target = id || _gwMonitorId;
  if (target) sendMsg({ type: 'screen:identify', target: { screens: [target] } });
}
