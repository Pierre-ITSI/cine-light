// ══════════════════════════ ÉCRANS : NOMS, GROUPES, CIBLE ══════════════════════════
// Maquettes validées 5 (écrans connectés & groupes) et 6 (choisir la cible).
//
// ── Télécommande ──
// Registre par session (localStorage, 8 sessions les plus récentes) :
//   écrans  screenId → { n (« Écran n » par défaut), name (null : jamais
//           nommé ; '' : nom effacé), groups: [ids], pk : clé par écran
//           { s (secret), kid, ok (confirmée par l'écran) } (29-revoke.js) }
//   groupes [{ id, name }]
//   cible   { k: 'all' } | { k: 'group', id } | { k: 'screen', id }
// Chaque ordre émis (sendMsg) porte la cible courante : rien (= tous les
// écrans, comportement historique) ou target: { screens: [...] }. Un groupe
// est RÉSOLU en liste d'écrans au moment de l'envoi : un écran qui aurait
// manqué son screen:config reçoit quand même les ordres de son groupe. Les
// écrans apprennent tout de même leur nom et leurs groupes (screen:config) :
// nom affiché dans leur menu, adressage { group } possible pour d'autres
// émetteurs. Toujours adressés à tous : hello, media:order, media:evict (le
// pool est commun à tous les écrans).
//
// État attendu de chaque écran (en mémoire, par session) : ce que la
// télécommande lui a demandé (couleur, effet, strobe, noir, luminosité, média,
// fin de lecture, avance au clic, appel), son cache (accusés media:cached,
// liste exacte de caps), ses retours (lecture, appel). Tenu à jour par
// scrTrack() sur CHAQUE ordre émis, même hors ligne : la resynchronisation
// (24-resync.js) renvoie à un écran revenu SON état, et seulement ce qui lui
// manque. _scrAllState : dernier état adressé à tous, point de départ d'un
// écran qui apparaît.
//
// Affichage : les variables de l'interface (currentColor, activeScreenEffect,
// strobeActive, remoteBlackout, _activeMediaId…) montrent l'état de la CIBLE
// (tous : _scrAllState ; groupe : son premier écran ; écran : le sien).
// Changer de cible recharge ces variables et les contrôles SANS rien envoyer
// (scrLoadView), puis chaque geste part vers la nouvelle cible.
const SCR_LS_KEY = 'setremote-screens-v1';
const SCR_SESSIONS_MAX = 8;
const SCR_MAX = 64;           // = LIMITS.targetScreens (packages/protocol/schema.js)
const SCR_GROUPS_MAX = 16;    // = LIMITS.screenGroups
const SCR_NAME_MAX = 40;      // = LIMITS.screenNameChars
const SCR_GLOBAL_TYPES = ['hello', 'media:order', 'media:evict'];
// Ordres qui modifient l'état attendu d'un écran
const SCR_TRACKED = new Set(['color', 'effect', 'strobe', 'blackout', 'screen:brightness', 'media:autoadvance',
  'media:endmode', 'media:show', 'media-stop', 'media-img-start', 'media:evict', 'call:start', 'call:end', 'dmx:look']);

let _scrReg = _scrEmptyReg(null);
const _scrStates = new Map();  // screenId → état attendu
let _scrAllState = null;       // état « Tous les écrans »
let _scrMute = 0;              // > 0 : rechargement de l'affichage, aucun envoi
let _scrReplay = false;        // renvoi d'un état déjà connu (resynchronisation) : pas de suivi

function _scrEmptyReg(sid) { return { sid, seq: 0, screens: new Map(), groups: [], target: { k: 'all' } }; }

// Nom saisi : une ligne, sans caractère de contrôle, 40 caractères au plus
function scrCleanName(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SCR_NAME_MAX);
}

// ── Persistance (par session) ──
function _scrStore() {
  try {
    const o = JSON.parse(_lsGet(SCR_LS_KEY));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_) { return {}; }
}
function scrLoad() {
  const sid = (_session && _session.channelId) || null;
  const reg = _scrEmptyReg(sid);
  const all = _scrStore().sessions;
  const rec = sid && all && typeof all === 'object' ? all[sid] : null;
  if (rec && typeof rec === 'object') {
    const gids = new Set();
    for (const g of Array.isArray(rec.groups) ? rec.groups : []) {
      if (!g || typeof g !== 'object' || !SRP.GROUP_ID_RE.test(g.id) || gids.has(g.id) || reg.groups.length >= SCR_GROUPS_MAX) continue;
      gids.add(g.id);
      reg.groups.push({ id: g.id, name: scrCleanName(g.name) || 'Groupe' });
    }
    const screens = rec.screens && typeof rec.screens === 'object' ? rec.screens : {};
    for (const [id, e] of Object.entries(screens)) {
      if (!SRP.SCREEN_ID_RE.test(id) || !e || typeof e !== 'object' || reg.screens.size >= SCR_MAX) continue;
      const n = Number.isInteger(e.n) && e.n > 0 && e.n < 1e6 ? e.n : ++reg.seq;
      reg.screens.set(id, {
        n,
        name: typeof e.name === 'string' ? scrCleanName(e.name) : null,
        groups: (Array.isArray(e.groups) ? e.groups : []).filter((g, i, a) => gids.has(g) && a.indexOf(g) === i),
        at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0,
        pk: e.pk && typeof e.pk === 'object' && SRP.PAIRWISE_SECRET_RE.test(e.pk.s) && SRP.KEY_ID_RE.test(e.pk.kid)
          ? { s: e.pk.s, kid: e.pk.kid, ok: !!e.pk.ok } : null,
      });
      reg.seq = Math.max(reg.seq, n);
    }
    if (Number.isInteger(rec.seq)) reg.seq = Math.max(reg.seq, Math.min(rec.seq, 1e6));
    reg.target = rec.target;
  }
  _scrReg = reg;
  _scrReg.target = _scrValidTarget(reg.target);
  _scrStates.clear();
  scrChanged();
}
function scrSave() {
  const sid = _scrReg.sid;
  if (!sid) return;
  const o = _scrStore();
  const sessions = o.sessions && typeof o.sessions === 'object' && !Array.isArray(o.sessions) ? o.sessions : {};
  const screens = {};
  for (const [id, e] of _scrReg.screens) screens[id] = { n: e.n, name: e.name, groups: e.groups, at: e.at, pk: e.pk || null };
  sessions[sid] = { at: Date.now(), seq: _scrReg.seq, screens, groups: _scrReg.groups, target: _scrReg.target };
  const ids = Object.keys(sessions).sort((a, b) => ((sessions[b] && sessions[b].at) || 0) - ((sessions[a] && sessions[a].at) || 0));
  for (const id of ids.slice(SCR_SESSIONS_MAX)) delete sessions[id];
  _lsSet(SCR_LS_KEY, JSON.stringify({ v: 1, sessions }));
}

// ── Écrans ──
function scrKnown(id) { return _scrReg.screens.has(id); }
function scrName(id) {
  const e = _scrReg.screens.get(id);
  if (e) return e.name || 'Écran ' + e.n;
  const sc = typeof _pairedScreens !== 'undefined' ? _pairedScreens.get(id) : null;
  return 'Écran ' + (sc ? sc.n : String(id).slice(0, 4));
}
function scrOnline(id) {
  const sc = _pairedScreens.get(id);
  return !!sc && Date.now() - sc.lastSeen <= SCREEN_OFFLINE_MS;
}
// Premier « caps » d'un écran : il entre au registre (« Écran n »)
function scrRegister(id) {
  if (!SRP.SCREEN_ID_RE.test(id)) return null;
  let e = _scrReg.screens.get(id);
  if (!e) {
    if (_scrReg.screens.size >= SCR_MAX && !_scrEvictOne()) return null;
    e = { n: ++_scrReg.seq, name: null, groups: [], at: Date.now(), pk: null };
    _scrReg.screens.set(id, e);
    scrSave();
    scrChanged();
  }
  return e;
}
// Registre plein : on oublie l'écran le plus ancien, ni nommé, ni groupé, ni visé, hors ligne
function _scrEvictOne() {
  const t = _scrReg.target;
  const cands = [..._scrReg.screens].filter(([id, e]) => !e.name && !e.groups.length && !e.pk && !(t.k === 'screen' && t.id === id) && !scrOnline(id))
    .sort((a, b) => a[1].at - b[1].at);
  if (!cands.length) return false;
  _scrReg.screens.delete(cands[0][0]);
  _scrStates.delete(cands[0][0]);
  return true;
}
// Écrans listés (maquettes 5 et 6) : vus depuis le lancement, ou nommés / groupés
function scrList() {
  return [..._scrReg.screens].filter(([id, e]) => _pairedScreens.has(id) || e.name || e.groups.length)
    .sort((a, b) => a[1].n - b[1].n).map(([id]) => id);
}
function scrRenameScreen(id, name) {
  const e = _scrReg.screens.get(id);
  if (!e) return false;
  e.name = scrCleanName(name); // '' : retour au nom par défaut « Écran n »
  scrSave();
  scrPushConfig(id);
  scrChanged();
  return true;
}
function scrSetScreenGroups(id, gids) {
  const e = _scrReg.screens.get(id);
  if (!e) return false;
  const known = new Set(_scrReg.groups.map((g) => g.id));
  e.groups = [...new Set(gids)].filter((g) => known.has(g)).slice(0, SCR_GROUPS_MAX);
  scrSave();
  scrPushConfig(id);
  _scrMembershipChanged();
  return true;
}
// L'écran apprend son nom et ses groupes (affichage, adressage { group })
function scrPushConfig(id) {
  const e = _scrReg.screens.get(id);
  if (!e) return;
  sendMsg({ type: 'screen:config', target: { screens: [id] }, name: e.name || '', groups: e.groups.slice() });
}
function scrIdentify(id) {
  if (scrKnown(id)) sendMsg({ type: 'screen:identify', target: { screens: [id] } });
}

// ── Groupes ──
function scrGroup(gid) { return _scrReg.groups.find((g) => g.id === gid) || null; }
function scrGroupMembers(gid) {
  return [..._scrReg.screens].filter(([, e]) => e.groups.includes(gid)).sort((a, b) => a[1].n - b[1].n).map(([id]) => id);
}
function _scrNewGroupId() {
  for (;;) {
    const id = 'g' + Math.random().toString(36).slice(2, 8).padEnd(6, '0');
    if (!scrGroup(id)) return id;
  }
}
// Nouveau groupe (nom + écrans membres) ; null si la limite est atteinte
function scrCreateGroup(name, members) {
  if (_scrReg.groups.length >= SCR_GROUPS_MAX) return null;
  const g = { id: _scrNewGroupId(), name: scrCleanName(name) || 'Groupe ' + (_scrReg.groups.length + 1) };
  _scrReg.groups.push(g);
  scrSetGroupMembers(g.id, members || []);
  return g.id;
}
function scrRenameGroup(gid, name) {
  const g = scrGroup(gid);
  if (!g) return false;
  g.name = scrCleanName(name) || g.name;
  scrSave();
  scrChanged();
  return true;
}
// Membres d'un groupe : chaque écran ajouté / retiré reçoit sa nouvelle liste
function scrSetGroupMembers(gid, members) {
  if (!scrGroup(gid)) return false;
  const want = new Set(members);
  for (const [id, e] of _scrReg.screens) {
    const has = e.groups.includes(gid);
    if (want.has(id) === has) continue;
    if (want.has(id)) { if (e.groups.length >= SCR_GROUPS_MAX) continue; e.groups.push(gid); }
    else e.groups = e.groups.filter((x) => x !== gid);
    scrPushConfig(id);
  }
  scrSave();
  _scrMembershipChanged();
  return true;
}
function scrDeleteGroup(gid) {
  if (!scrGroup(gid)) return false;
  for (const [id, e] of _scrReg.screens) {
    if (!e.groups.includes(gid)) continue;
    e.groups = e.groups.filter((x) => x !== gid);
    scrPushConfig(id);
  }
  _scrReg.groups = _scrReg.groups.filter((g) => g.id !== gid);
  scrSave();
  _scrMembershipChanged();
  return true;
}
// Membres changés : cible vidée → « Tous » ; premier écran changé → affichage rechargé
function _scrMembershipChanged() {
  const t = _scrReg.target;
  if (t.k === 'group') {
    const ok = _scrValidTarget(t);
    if (ok.k !== 'group') { scrSetTarget(ok); return; }
    scrLoadView();
  }
  scrRefreshCachedView();
  scrChanged();
}

// ── Cible ──
function _scrValidTarget(t) {
  if (t && typeof t === 'object') {
    if (t.k === 'screen' && typeof t.id === 'string' && scrKnown(t.id)) return { k: 'screen', id: t.id };
    if (t.k === 'group' && typeof t.id === 'string' && scrGroup(t.id) && scrGroupMembers(t.id).length) return { k: 'group', id: t.id };
  }
  return { k: 'all' };
}
function scrTarget() { return _scrReg.target; }
// Écrans connus de la cible (tous : écrans listés)
function scrTargetIds() {
  const t = _scrReg.target;
  if (t.k === 'screen') return scrKnown(t.id) ? [t.id] : [];
  if (t.k === 'group') return scrGroupMembers(t.id);
  return scrList();
}
function scrInTarget(id) {
  const t = _scrReg.target;
  if (t.k === 'all') return true;
  if (t.k === 'screen') return t.id === id;
  const e = _scrReg.screens.get(id);
  return !!e && e.groups.includes(t.id);
}
function scrSetTarget(t) {
  _scrReg.target = _scrValidTarget(t);
  scrSave();
  scrLoadView();
  scrRefreshCachedView();
  if (typeof renderScreensUi === 'function') renderScreensUi(); // geste de l'utilisateur : bouton « Cible » à jour tout de suite
}
// Adresse d'un ordre de la télécommande : cible courante, sauf adresse
// explicite (passerelle DMX, transferts, resynchronisation) ou ordre global.
// null : cible vide, rien à envoyer.
function scrAddress(m) {
  if (!m || typeof m !== 'object') return m;
  if (m.target !== undefined && m.target !== null) {
    return Array.isArray(m.target.screens) && !m.target.screens.length ? null : m;
  }
  if (SCR_GLOBAL_TYPES.includes(m.type) || _scrReg.target.k === 'all') return m;
  const ids = scrTargetIds();
  return ids.length ? Object.assign({}, m, { target: { screens: ids } }) : null;
}

// ── État attendu de chaque écran ──
const _scrClone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
// État des contrôles de l'interface (ce que montre la télécommande)
function scrSnapshotView() {
  const meta = document.getElementById('previewMeta');
  return {
    color: currentColor, colorSpec: currentColorSpec(), colorMeta: meta ? meta.textContent : null,
    effect: activeScreenEffect ? { name: activeScreenEffect, params: buildEffectParams(), tvBlocks: activeScreenEffect === 'tv' ? _scrClone(tvBlocks) : null } : null,
    strobe: strobeActive ? buildStrobePayload() : null,
    blackout: !!remoteBlackout, blackoutTouched: !!_blackoutTouched,
    brightness: screenBrightnessPct, endMode: _videoEndMode, autoAdvance: !!_autoAdvance,
    media: _activeMediaId || null,
  };
}
function scrInitAll() { if (!_scrAllState) _scrAllState = scrSnapshotView(); }
function scrAll() { scrInitAll(); return _scrAllState; }
function _scrLook(s) {
  return {
    color: s.color, colorSpec: _scrClone(s.colorSpec), colorMeta: s.colorMeta, effect: _scrClone(s.effect), strobe: _scrClone(s.strobe),
    blackout: s.blackout, blackoutTouched: s.blackoutTouched, brightness: s.brightness, endMode: s.endMode, autoAdvance: s.autoAdvance, media: s.media,
  };
}
// État d'un écran connu (créé à partir de l'état « Tous » à sa première apparition)
function scrState(id) {
  let s = _scrStates.get(id);
  if (!s) {
    s = Object.assign(_scrLook(scrAll()), {
      cached: new Set(),  // médias accusés en cache par l'écran
      sent: new Map(),    // fragments envoyés (photo, bande son, fond, sons importés) → contenu
      caps: null, rtcBroken: false, progress: null, call: null, dmxLive: false, dmxColor: null,
      reportedActive: undefined, needsConfig: false,
    });
    _scrStates.set(id, s);
  }
  return s;
}
// État montré par l'interface
function scrViewState() {
  const t = _scrReg.target;
  if (t.k === 'screen' && scrKnown(t.id)) return scrState(t.id);
  if (t.k === 'group') { const m = scrGroupMembers(t.id); if (m.length) return scrState(m[0]); }
  return scrAll();
}

// Suivi des ordres émis (appelé par sendMsg, même hors ligne)
function scrTrack(m) {
  if (_scrReplay || !m || typeof m !== 'object' || !SCR_TRACKED.has(m.type)) return;
  let states;
  if (m.target && Array.isArray(m.target.screens)) states = m.target.screens.filter((id) => scrKnown(id) || _scrStates.has(id)).map(scrState);
  else if (m.target && typeof m.target.group === 'string') states = scrGroupMembers(m.target.group).map(scrState);
  else states = [scrAll(), ..._scrStates.values()];
  if (!states.length) return;
  // Réglages lus dans l'interface quand l'ordre en vient (couleur, blocs TV)
  const x = {};
  if (m.type === 'color' && m.color === currentColor) {
    const meta = document.getElementById('previewMeta');
    x.spec = currentColorSpec(); x.meta = meta ? meta.textContent : null;
  }
  if (m.type === 'effect' && m.name === 'tv' && activeScreenEffect === 'tv') x.tvBlocks = _scrClone(tvBlocks);
  for (const s of states) _scrApply(s, m, x);
  scrChanged();
}
function _scrApply(s, m, x) {
  switch (m.type) {
    case 'color': s.color = m.color; s.colorSpec = x.spec ? _scrClone(x.spec) : null; s.colorMeta = x.meta || null; break;
    case 'effect': s.effect = m.active && m.name ? { name: m.name, params: _scrClone(m.params || {}), tvBlocks: x.tvBlocks ? _scrClone(x.tvBlocks) : null } : null; break;
    case 'strobe': { if (!m.active) { s.strobe = null; break; } const p = _scrClone(m); delete p.target; s.strobe = p; break; }
    case 'blackout': s.blackout = !!m.on; s.blackoutTouched = true; break;
    case 'screen:brightness': s.brightness = Math.round(Math.min(1, Math.max(0, Number(m.value) || 0)) * 100); break;
    case 'media:autoadvance': s.autoAdvance = !!m.on; break;
    case 'media:endmode': s.endMode = m.mode; break;
    case 'media:show': s.media = m.id; break;
    case 'media-stop': s.media = null; s.progress = null; break;
    case 'media-img-start':
      if (m.show !== false && typeof m.mediaId === 'string' && m.mediaId && !m.mediaId.startsWith('__')) s.media = m.mediaId;
      break;
    case 'media:evict':
      if (s.cached) { s.cached.delete(m.id); s.sent.delete(m.id); }
      if (s.media === m.id) s.media = null;
      break;
    case 'call:start': s.call = { kind: m.kind, name: m.name || '', state: null }; break;
    case 'call:end': s.call = null; break;
    case 'dmx:look': s.dmxLive = !!m.live; s.dmxColor = m.look && m.look.color; break;
  }
}

// « caps » d'un écran : cache exact, média affiché, noir, nom et groupes
function scrOnCaps(id, caps) {
  const e = _scrReg.screens.get(id);
  const st = scrState(id);
  st.caps = { torch: caps.torch, vibrate: caps.vibrate, videoMode: caps.videoMode || null };
  if (Array.isArray(caps.cached)) {
    // Écran récent : ce qu'il a perdu (rechargement) n'est plus considéré comme présent
    st.cached = new Set(caps.cached);
    for (const k of [...st.sent.keys()]) if (!st.cached.has(k)) st.sent.delete(k);
  }
  st.reportedActive = Object.prototype.hasOwnProperty.call(caps, 'active') ? caps.active : undefined;
  if (typeof caps.blackout === 'boolean') scrAdoptBlackout(id, caps.blackout);
  if (e) {
    e.at = Date.now();
    // Nom gardé par l'écran, jamais donné ici (autre télécommande, registre oublié) : adopté
    const cn = typeof caps.name === 'string' ? scrCleanName(caps.name) : '';
    if (e.name === null && cn) e.name = cn;
    const groups = Array.isArray(caps.groups) ? caps.groups : [];
    st.needsConfig = (e.name || '') !== cn || groups.length !== e.groups.length || e.groups.some((g) => !groups.includes(g));
    scrSave();
    kxOnCaps(id, caps); // clé par écran : établie, vérifiée ou à établir (29-revoke.js)
  }
  scrRefreshCachedView();
  scrChanged();
}
// Noir annoncé par un écran : repris tant que l'utilisateur n'y a pas touché
// (une télécommande rechargée ne rallume jamais un écran éteint)
function scrAdoptBlackout(id, on) {
  const st = id ? scrState(id) : null;
  if (st && !st.blackoutTouched) st.blackout = !!on;
  const all = scrAll();
  if (_scrReg.target.k === 'all' && !all.blackoutTouched) all.blackout = !!on;
  if (!id || scrInTarget(id)) {
    const v = scrViewState();
    if (!v.blackoutTouched && remoteBlackout !== v.blackout) { remoteBlackout = v.blackout; renderRemoteBlackout(); }
  }
}

// Médias en cache sur TOUS les écrans en ligne de la cible (accusés) :
// _screenCached (70-media-remote.js) sert aux indications « sur l'écran ✓ ».
function scrRefreshCachedView() {
  if (typeof _screenCached === 'undefined') return;
  const ids = scrTargetIds();
  if (!ids.length) return; // aucun écran connu : ensemble laissé tel quel
  const online = ids.filter(scrOnline);
  let inter = null;
  for (const id of online.length ? online : ids) {
    const c = scrState(id).cached;
    inter = inter ? new Set([...inter].filter((x) => c.has(x))) : new Set(c);
  }
  _screenCached.clear();
  for (const x of inter || []) _screenCached.add(x);
}

// ── Affichage de l'état de la cible (aucun envoi) ──
function scrLoadView() {
  if (mode !== 'remote') return;
  const st = scrViewState();
  _scrMute++;
  try {
    _scrViewColor(st);
    _scrViewEffect(st.effect);
    _scrViewStrobe(st.strobe);
    remoteBlackout = !!st.blackout; _blackoutTouched = !!st.blackoutTouched;
    renderRemoteBlackout();
    screenBrightnessPct = st.brightness;
    const bs = document.getElementById('screenBrightnessSlider'); if (bs) bs.value = st.brightness;
    const bl = document.getElementById('screenBrightnessVal'); if (bl) bl.innerHTML = st.brightness + '<span>%</span>';
    _videoEndMode = st.endMode;
    ['loop', 'pause', 'off'].forEach((k) => { const b = document.getElementById('vmode-' + k); if (b) b.classList.toggle('active', k === _videoEndMode); });
    _autoAdvance = !!st.autoAdvance;
    const aa = document.getElementById('mediaAutoAdvToggle'); if (aa) aa.checked = _autoAdvance;
    _scrViewMedia(st);
  } finally {
    _scrMute--;
    // Envois différés programmés par les contrôles rechargés : annulés
    if (autoSendTimer) { clearTimeout(autoSendTimer); autoSendTimer = null; }
    if (effectSendTimer) { clearTimeout(effectSendTimer); effectSendTimer = null; }
  }
  refreshPreviewFx(st.effect ? st.effect.params : undefined);
  if (strobeActive) runLocalStrobePreview();
  updateStatusRings();
}
function _scrViewColor(st) {
  const s = st.colorSpec;
  if (!s) { applyColor(st.color, st.colorMeta || '—'); return; }
  kelvinK = s.kelvin; colorTint = s.tint; colorDimmer = s.dimmer; colorWheelHex = s.wheelHex; colorCrossfade = s.crossfade;
  const set = (id, prop, v) => { const el = document.getElementById(id); if (el) el[prop] = v; };
  set('kelvinSlider', 'value', kelvinK); set('kelvinVal', 'innerHTML', kelvinK.toLocaleString('fr') + '<span> K</span>');
  set('tintSlider', 'value', colorTint); set('tintVal', 'innerHTML', (colorTint >= 0 ? '+' : '') + colorTint + '<span> GM</span>');
  set('dimmerSlider', 'value', colorDimmer); set('dimmerVal', 'innerHTML', colorDimmer + '<span>%</span>');
  syncCrossfadeValues(); syncHueValue(); syncRgbValues(); updateWheelMarker(); updateCrossfadeGradient();
  const h = document.getElementById('hueCrossfadeVal'); if (h) h.innerHTML = colorCrossfade + '<span>%</span>';
  const r = document.getElementById('rgbCrossfadeVal'); if (r) r.innerHTML = colorCrossfade + '<span>%</span>';
  recomputeColor(); // muet : l'envoi différé est annulé par scrLoadView
}
function _scrViewEffect(fx) {
  if (!fx || !EFFECT_CONFIG[fx.name]) { if (activeScreenEffect) stopAllEffects(); return; }
  if (fx.tvBlocks && fx.tvBlocks.length) { tvBlocks = _scrClone(fx.tvBlocks); tvSelectedBlock = 0; }
  activeScreenEffect = null;
  // acked : on MONTRE un effet qui tourne déjà sur la cible, rien n'est
  // activé (pas d'avertissement stroboscope, 46-strobe-warning.js)
  selectEffect(fx.name, true);
  loadEffectParamsToUI(fx.name, fx.params || {}, null);
  _lastEffectParams = _scrClone(fx.params || {});
}
function _scrViewStrobe(p) {
  // Comme applyStrobeState (62-memories.js), sans envoi
  strobeActive = false;
  if (p) {
    strobeFreq = p.freq; strobeFlashDur = p.dur;
    strobeFreqMax = p.freqMax != null ? p.freqMax : p.freq; strobeFlashDurMax = p.durMax != null ? p.durMax : p.dur;
    const set = (id, prop, v) => { const el = document.getElementById(id); if (el) el[prop] = v; };
    set('freqSlider', 'value', strobeFreq); set('flashDurSlider', 'value', strobeFlashDur);
    set('freqMaxSlider', 'value', strobeFreqMax); set('flashDurMaxSlider', 'value', strobeFlashDurMax);
    set('freqVal', 'innerHTML', Number(strobeFreq).toFixed(1) + '<span> Hz</span>'); set('flashDurVal', 'innerHTML', strobeFlashDur + '<span> ms</span>');
    set('freqMaxVal', 'innerHTML', Number(strobeFreqMax).toFixed(1) + '<span> Hz</span>'); set('flashDurMaxVal', 'innerHTML', strobeFlashDurMax + '<span> ms</span>');
    set('torchSyncToggle', 'checked', !!p.torch);
    setStrobeMode(p.random ? 'random' : 'regular');
  }
  strobeActive = !!p;
  const tog = document.getElementById('strobeToggle'); if (tog) tog.checked = strobeActive;
  const badge = document.getElementById('strobeActiveBadge'); if (badge) badge.style.display = strobeActive ? 'block' : 'none';
  if (!strobeActive) stopLocalStrobePreview();
}
function _scrViewMedia(st) {
  const it = st.media ? _mediaPool.find((m) => m.id === st.media) : null;
  _activeMediaId = it ? it.id : null;
  _mediaIsVideo = !!(it && it.kind === 'vid');
  const p = st.progress || {};
  _remotePlaying = _mediaIsVideo && !!p.playing; _remoteDur = p.dur || 0; _remoteCur = p.cur || 0;
  if (_seekSendTimer) { clearTimeout(_seekSendTimer); _seekSendTimer = null; }
  _mediaSeeking = false;
  renderPool();
  showMediaStop(!!it);
  showMediaPlay(_mediaIsVideo); setPlayBtn(_remotePlaying); showMediaTimeline(_mediaIsVideo);
  if (_mediaIsVideo) {
    const s = document.getElementById('mediaSeek');
    if (s) { if (_remoteDur) s.max = _remoteDur; s.value = _remoteCur; }
    const c = document.getElementById('mediaCurTime'); if (c) c.textContent = fmtTime(_remoteCur);
    const d = document.getElementById('mediaDurTime'); if (d) d.textContent = fmtTime(_remoteDur);
    paintSeek(_remoteDur ? (_remoteCur / _remoteDur) * 100 : 0);
  }
  if (it) setMediaStatus((it.kind === 'vid' ? '🎬 ' : '🖼 ') + it.name, true);
  else setMediaStatus('Aucun média diffusé');
  _vidRenderStatus();
}

// ── Rafraîchissement groupé des vues (liste des écrans, cible) ──
let _scrRenderTimer = null;
function scrChanged() {
  if (_scrRenderTimer || mode !== 'remote') return;
  _scrRenderTimer = setTimeout(() => {
    _scrRenderTimer = null;
    if (typeof renderScreensUi === 'function') renderScreensUi();
  }, 120);
}

// ── Écran de jeu : nom et groupes reçus (screen:config) ──
let _screenCfg = { name: '', groups: [] };
function screenLoadConfig(p) { _screenCfg = screenStoredConfig(p); renderScreenIdentity(); }
function screenApplyConfig(m) {
  if (typeof m.name === 'string') _screenCfg.name = scrCleanName(m.name);
  if (Array.isArray(m.groups)) _screenCfg.groups = m.groups.filter((g, i, a) => typeof g === 'string' && SRP.GROUP_ID_RE.test(g) && a.indexOf(g) === i).slice(0, SCR_GROUPS_MAX);
  if (_session) screenSaveConfig(_session, _screenCfg);
  // Le canal chiffré filtre aussi les ordres adressés à un groupe
  if (_sec && typeof _sec.setGroups === 'function') { try { _sec.setGroups(_screenCfg.groups); } catch (_) {} }
  renderScreenIdentity();
}
// Le nom n'apparaît que dans le menu de l'écran (l'écran de jeu reste vierge)
function renderScreenIdentity() {
  const el = document.getElementById('screenMenuInfo');
  if (el) el.textContent = _screenCfg.name ? '« ' + _screenCfg.name + ' » · liaison chiffrée de bout en bout' : 'Liaison chiffrée de bout en bout';
}
