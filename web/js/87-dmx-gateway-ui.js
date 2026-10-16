// ══════════════════════════ PASSERELLE DMX — INTERFACE (maquettes 14 à 17) ══════════════════════════
//   14 · Passerelle : protocole, IP / masque / interface (lecture seule) et
//        voyant de réception, conseils réseau, univers reçus
//   15 · Patch : univers, adresse et mode de chaque écran, chevauchements,
//        auto-adressage, modes disponibles
//   16 · Écran patché : TOUS les canaux de son empreinte, valeur et sens
//        décodé, badge « Console » tant que la console a la priorité,
//        Identifier / Dépatcher
//   17 · Table des canaux d'un mode, pour le pupitreur
// Accès : onglet QR de la télécommande, dans l'app native seulement (à valider :
// aucune maquette ne montre l'accès). Dans un navigateur, la vue explique
// qu'il faut l'app (même principe que l'onglet Flash sur iPhone).
let _gwView = null, _gwMonitorId = null, _gwMonitorPct = false, _gwChannelsMode = DMX_DEFAULT_PERSONALITY;
let _gwRenderTimer = null;

const _GW_MODE_DESC = { simple3: 'R · G · B', color5: 'Dimmer · RGB · Strobo', standard8: '+ CCT · Tint · Mix', extended16: '+ Effet · Média · Appel · SMS' };
const _GW_SHORT_LABEL = { mix: 'Mix', strobe: 'Strobo' };
// Valeurs DMX résumées pour le pupitreur (table 17)
const _GW_CH_VALUES = {
  dimmer: '0–255 · 0–100 %',
  dimmerFine: '16 bits avec le canal 1',
  red: '0–255', green: '0–255', blue: '0–255',
  cct: '0 = 1 700 K → 255 = 20 000 K',
  tint: '0 magenta · 128 neutre · 255 vert',
  mix: '0 couleur RGB → 255 blanc CCT',
  strobe: '0 arrêt · 1–255 = 0,5 → 30 Hz',
  effect: '0 aucun · 10 Chaser · 20 Noise … 140 Feu',
  effectSpeed: '0–255 · plage de l’effet',
  media: '0 masqué · 10 = n°1 … 250 = n°25',
  playback: '0 lecture · 64 pause · 128 boucle · 192 début',
  call: '0 raccrocher · 10 = n°1 … 200 = n°20',
  sms: '0 effacer · 10 = n°1 … 200 = n°20',
  screen: '0–127 allumé · 128–255 noir',
};

function openDmxGateway() {
  gwLoadSettings();
  if (!gwState.patchSession || (_session && gwState.patchSession !== _session.channelId)) gwLoadPatch();
  document.getElementById('dmx-gateway').style.display = 'block';
  if (IN_NATIVE_APP) {
    gwStart();
    // La coque n'annonce pas les interfaces d'elle-même : on les demande à chaque ouverture
    nativePost({ type: 'net:info' });
  }
  gwShowView('gateway');
}
// Retour à la télécommande : la passerelle continue de tourner
function closeDmxGateway() {
  document.getElementById('dmx-gateway').style.display = 'none';
  _gwView = null;
  renderGwEntry();
}
function gwShowView(v) {
  _gwView = v;
  for (const [k, id] of [['gateway', 'gwViewGateway'], ['patch', 'gwViewPatch'], ['monitor', 'gwViewMonitor'], ['channels', 'gwViewChannels']]) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('active', k === v);
  }
  const box = document.getElementById('dmx-gateway');
  if (box) box.scrollTop = 0;
  gwRender();
}
function gwOpenMonitor(id) { _gwMonitorId = id; gwShowView('monitor'); }
function gwOpenChannels(mode) {
  if (!mode) {
    // Mode le plus utilisé du patch, sinon Étendu 16
    const n = {};
    for (const [, e] of gwState.patch.entries()) n[e.personality] = (n[e.personality] || 0) + 1;
    mode = Object.keys(n).sort((a, b) => n[b] - n[a])[0] || DMX_DEFAULT_PERSONALITY;
  }
  _gwChannelsMode = SRDMX.getPersonality(mode) ? mode : DMX_DEFAULT_PERSONALITY;
  gwShowView('channels');
}
function gwSetMonitorUnit(pct) { _gwMonitorPct = !!pct; gwRender(); }

// Rendu groupé (les paquets arrivent par lots toutes les ~20 ms)
function gwScheduleRender() {
  if (_gwRenderTimer || !_gwView) return;
  _gwRenderTimer = setTimeout(() => { _gwRenderTimer = null; gwRender(); }, 200);
}
function gwRender() {
  renderGwEntry();
  if (_gwView === 'gateway') renderGwGateway();
  else if (_gwView === 'patch') renderGwPatch();
  else if (_gwView === 'monitor') renderGwMonitor();
  else if (_gwView === 'channels') renderGwChannels();
}

// Accès depuis l'onglet QR : « active » tant que la passerelle tourne
function renderGwEntry() {
  const st = document.getElementById('gwEntryState');
  if (st) st.textContent = _gw ? '· active' : '';
}

const _gwSetText = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
const _gwFmt = (x, d) => String(Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).replace('.', ',');
const _gwThousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const _GW_KIND = { ethernet: 'Ethernet', wifi: 'Wi-Fi', other: 'Autre réseau' };

// ── 14 · Passerelle ──
function renderGwGateway() {
  const view = document.getElementById('gwViewGateway');
  view.classList.toggle('gw-unavailable', !IN_NATIVE_APP);
  document.getElementById('gwNeedsApp').style.display = IN_NATIVE_APP ? 'none' : 'block';
  for (const p of ['sacn', 'artnet']) document.getElementById('gwProto-' + p).classList.toggle('active', gwState.protocol === p);
  // Adresse de l'appareil : lecture seule (réglée dans les réglages du système)
  const it = gwState.iface;
  _gwSetText('gwIp', it ? it.ip : '—');
  _gwSetText('gwIpSub', it
    ? (it.mask ? 'Masque ' + it.mask + ' · ' : '') + _GW_KIND[it.kind] + (it.name ? ' (' + it.name + ')' : '')
    : (IN_NATIVE_APP ? 'Recherche de l\'interface réseau…' : 'Réseau inaccessible depuis un navigateur'));
  _gwSetText('gwIpTip', it ? it.ip : 'cette adresse');
  const warn = document.getElementById('gwNetWarn');
  if (it) {
    warn.innerHTML = 'L\'appareil est en <b>' + escapeHtml(it.ip) + '</b>' + (it.mask ? ', masque <b>' + escapeHtml(it.mask) + '</b>' : '')
      + '. Saisissez bien cette IP et ce masque de sous-réseau dans votre console.';
    warn.style.display = 'block';
  } else warn.style.display = 'none';
  const err = document.getElementById('gwError');
  err.textContent = gwState.error ? gwErrorText(gwState.error) : '';
  err.style.display = gwState.error ? 'block' : 'none';
  const adv = document.getElementById('gwUnicastAdvice');
  adv.innerHTML = gwState.multicastRefused ? gwUnicastAdvice(gwState.multicastRefused, it) : '';
  adv.style.display = gwState.multicastRefused ? 'block' : 'none';
  // Voyant et état du signal
  const sig = _gw && Date.now() - gwState.lastPacketAt < DMX_SIGNAL_MS;
  const led = document.getElementById('gwLed');
  if (led) { led.classList.toggle('rx', !!sig); if (!sig) led.classList.remove('blink'); }
  const sg = document.getElementById('gwSig');
  sg.textContent = sig ? 'Signal reçu' : (_gw ? 'Aucun signal' : 'Arrêtée');
  sg.classList.toggle('on', !!sig);
  renderGwUniverses();
  _gwSetText('gwPatchBtn', 'Patcher les écrans (' + gwKnownScreens().length + ')');
  const run = document.getElementById('gwRunBtn');
  run.textContent = _gw ? 'Arrêter la passerelle' : 'Démarrer la passerelle';
  run.classList.toggle('start', !_gw);
}

function renderGwUniverses() {
  const box = document.getElementById('gwUniverses');
  if (!box) return;
  const snap = gwSnapshot();
  const now = Date.now();
  const rows = [];
  const seen = new Set();
  for (const u of snap.universes.filter((x) => x.protocol === gwState.protocol).sort((a, b) => a.universe - b.universe)) {
    const k = u.protocol + ':' + u.universe;
    seen.add(k);
    const s = gwState.rx.get(k);
    const lost = u.lost || !u.hasData;
    let meta;
    if (lost) {
      const ago = s && s.lastAt ? Math.max(1, Math.round((now - s.lastAt) / 1000)) : null;
      meta = ago ? 'aucun paquet depuis ' + ago + ' s' : 'aucun paquet';
    } else {
      const src = u.sources && u.sources[0];
      const parts = [];
      if (src && src.sourceName) parts.push(src.sourceName);
      const ip = (s && s.ip) || (src && src.ip) || '';
      if (ip) parts.push(ip);
      if (s && s.hz) parts.push(s.hz + ' Hz');
      if (u.sources && u.sources.length > 1) parts.push(u.sources.length + ' sources');
      meta = parts.join(' · ') || 'signal reçu';
    }
    rows.push({ universe: u.universe, lost, meta });
  }
  // Univers patchés dont rien n'est encore arrivé
  for (const universe of gwState.patch.universes(gwState.protocol)) {
    if (!seen.has(gwState.protocol + ':' + universe)) rows.push({ universe, lost: true, meta: 'aucun paquet reçu' });
  }
  rows.sort((a, b) => a.universe - b.universe);
  box.innerHTML = rows.length
    ? rows.map((r) => '<div class="gw-uni' + (r.lost ? ' lost' : '') + '"><span class="gw-uni-dot"></span>'
      + '<span class="gw-uni-name">Univers ' + r.universe + '</span><span class="gw-uni-meta">' + escapeHtml(r.meta) + '</span></div>').join('')
    : '<div class="gw-uni-empty">Aucun univers reçu pour l\'instant.</div>';
}

// Messages des erreurs de la coque (raisons : docs/DMX-NATIVE.md § 9.2)
function gwErrorText(r) {
  const port = gwState.protocol === 'sacn' ? 5568 : 6454;
  switch (r) {
    case 'bind-failed': return 'Port ' + port + ' déjà utilisé par une autre app : réception arrêtée. Fermez cette app, puis touchez « Démarrer la passerelle ».';
    case 'socket-failed': return 'Réception interrompue par le système : touchez « Démarrer la passerelle ».';
    case 'listen-failed': return 'La réception n\'a pas pu démarrer : touchez « Démarrer la passerelle ».';
    case 'native-unavailable': return 'Cette version de l\'app ne sait pas encore recevoir le DMX : mettez SetRemote à jour.';
    case 'not-listening': return 'Réponse à la console (ArtPollReply) non envoyée : la réception n\'est pas active.';
    case 'send-failed': return 'Réponse à la console (ArtPollReply) non envoyée. Sur iPhone et iPad, autorisez SetRemote dans Réglages › Confidentialité › Réseau local.';
  }
  if (/^invalid-/.test(r)) return 'Commande refusée par l\'app (' + r + ') : la réception continue comme avant.';
  return 'Erreur de réception (' + r + ').';
}
// Multicast / broadcast refusé : l'unicast continue, il faut le régler sur la console
function gwUnicastAdvice(r, it) {
  const ip = it ? '<b>' + escapeHtml(it.ip) + '</b>' : 'l\'IP de cet appareil';
  const why = r === 'multicast-not-permitted' ? 'non autorisé sur cet appareil' : 'refusé par le réseau';
  return gwState.protocol === 'sacn'
    ? '<b>Multicast ' + why + '</b> : la réception continue en unicast. Sur la console, envoyez les univers en unicast vers ' + ip + ' (le multicast 239.255.x.y n\'arrivera pas).'
    : '<b>Broadcast ' + why + '</b> : la réception continue en unicast, mais la console ne verra pas la passerelle (ArtPoll). Saisissez ' + ip + ' comme destination unicast.';
}

// ── 15 · Patch ──
// Problème affiché sur une ligne : comme la maquette 15, seul l'écran qui
// recouvre (adresse la plus haute de la paire) est marqué « chevauchement » ;
// celui qu'il recouvre reste « OK ».
function _gwIssuesByScreen() {
  const res = gwState.patch.check();
  const by = new Map();
  const order = gwPatchOrder();
  for (const is of [...res.errors, ...res.warnings, ...res.infos]) {
    const ids = is.screens.slice().sort((a, b) => gwState.patch.get(a).address - gwState.patch.get(b).address || order.indexOf(a) - order.indexOf(b));
    const id = ids[ids.length - 1];
    if (!by.has(id)) by.set(id, is);
  }
  return { res, by };
}
function renderGwPatch() {
  const rows = document.getElementById('gwPatchRows');
  if (!rows) return;
  const ids = gwPatchOrder();
  const { res, by } = _gwIssuesByScreen();
  rows.innerHTML = ids.length ? ids.map((id) => {
    const e = gwState.patch.get(id);
    const name = escapeHtml(gwScreenName(id));
    if (!e) {
      return '<button type="button" class="gw-prow off" onclick="gwOpenMonitor(\'' + id + '\')"><span class="gw-pmain"><span class="gw-pname">' + name
        + '</span><span class="gw-pnote">non patché</span></span><span class="gw-pu">—</span><span class="gw-pa">—</span><span class="gw-pm">—</span></button>';
    }
    const last = SRDMX.lastChannel(e);
    const is = by.get(id);
    const label = !is ? 'OK' : is.code === 'out-of-range' ? 'hors univers' : is.code === 'mirror' ? 'miroir' : 'chevauchement';
    const warn = is && is.code !== 'mirror';
    return '<button type="button" class="gw-prow' + (warn ? ' warn' : '') + '" onclick="gwOpenMonitor(\'' + id + '\')">'
      + '<span class="gw-pmain"><span class="gw-pname">' + name + '</span><span class="gw-pnote">' + e.address + '–' + last + ' · ' + label + '</span></span>'
      + '<span class="gw-pu">' + e.universe + '</span><span class="gw-pa">' + e.address + '</span>'
      + '<span class="gw-pm">' + escapeHtml(SRDMX.getPersonality(e.personality).name) + '</span></button>';
  }).join('') : '<div class="gw-pempty">Aucun écran appairé : appairez les écrans de jeu depuis l\'onglet QR de la télécommande.</div>';
  // Avertissement : premier chevauchement (ou adresse hors univers)
  const warnEl = document.getElementById('gwPatchWarn');
  const first = res.errors[0] || res.warnings[0];
  if (first) {
    const range = (id) => { const e = gwState.patch.get(id); return e.address + '–' + SRDMX.lastChannel(e); };
    const q = (id) => '« ' + escapeHtml(gwScreenName(id)) + ' »';
    let html;
    if (first.code === 'out-of-range') {
      const id = first.screens[0];
      html = 'Hors univers : ' + q(id) + ' (' + range(id) + ') dépasse le canal 512. Utilisez l\'auto-adressage ou changez l\'adresse.';
    } else {
      const [a, b] = first.screens.slice().sort((x, y) => gwState.patch.get(x).address - gwState.patch.get(y).address);
      html = 'Chevauchement : ' + q(b) + ' (' + range(b) + ') recouvre ' + q(a) + ' (' + range(a) + '). Utilisez l\'auto-adressage ou changez l\'adresse.';
    }
    warnEl.innerHTML = html;
    warnEl.style.display = 'block';
  } else warnEl.style.display = 'none';
  const modes = document.getElementById('gwModes');
  modes.innerHTML = ['simple3', 'color5', 'standard8', 'extended16'].map((m) => '<button type="button" class="gw-mode" onclick="gwOpenChannels(\'' + m + '\')"><span>'
    + SRDMX.PERSONALITIES[m].name + '</span><span>' + _GW_MODE_DESC[m] + '</span></button>').join('');
}

// ── 16 · Écran patché : tous les canaux ──
function _gwMeaning(key, v, ctx) {
  switch (key) {
    case 'dimmer': return Math.round((ctx.e.personality === 'extended16' ? ((v << 8) | (ctx.slice[1] || 0)) / 65535 : v / 255) * 100) + ' %';
    case 'dimmerFine': return '—';
    case 'red': case 'green': case 'blue': return Math.round(v / 255 * 100) + ' %';
    case 'cct': return _gwThousands(Math.round(SRDMX.dmxToKelvin(v) / 100) * 100) + ' K';
    case 'tint': { if (v === 128) return 'neutre'; const t = Math.round(Math.abs(SRDMX.dmxToTint(v))); return (v < 128 ? 'magenta −' : 'vert +') + t; }
    case 'mix': return v === 0 ? 'couleur' : v === 255 ? 'blanc' : Math.round(v / 255 * 100) + ' % blanc';
    case 'strobe': return v ? _gwFmt(SRDMX.decodeStrobe(v).freq, 1) + ' Hz' : 'arrêt';
    case 'effect': { const s = SRDMX.slotOf(v, SRDMX.EFFECTS.length); return s === 0 ? 'aucun' : s ? SRDMX.EFFECTS[s - 1].label : 'inchangé'; }
    case 'effectSpeed': {
      const fx = ctx.look && ctx.look.effect && SRDMX.EFFECTS.find((x) => x.name === ctx.look.effect.name);
      return fx ? _gwFmt(SRDMX.effectSpeed(fx, v), 2) + ' ' + fx.unit : '—';
    }
    case 'media': { const s = SRDMX.slotOf(v, SRDMX.MEDIA_ITEMS); return s === 0 ? 'masqué' : s ? 'n°' + s : 'inchangé'; }
    case 'playback': return { play: 'lecture', pause: 'pause', loop: 'boucle', rewind: 'début' }[SRDMX.playbackOf(v)];
    case 'call': { const s = SRDMX.slotOf(v, SRDMX.CALL_ITEMS); return s === 0 ? 'raccroché' : s ? 'n°' + s : 'inchangé'; }
    case 'sms': { const s = SRDMX.slotOf(v, SRDMX.SMS_ITEMS); return s === 0 ? 'aucun' : s ? 'n°' + s : 'inchangé'; }
    case 'screen': return v >= 128 ? 'noir' : 'allumé';
  }
  return '';
}

function renderGwMonitor() {
  const id = _gwMonitorId;
  if (!id) return;
  const patched = gwState.patch.get(id);
  const e = gwProposedEntry(id);
  _gwSetText('gwMonName', gwScreenName(id));
  const snapScreen = gwSnapshot().screens.find((s) => s.id === id);
  document.getElementById('gwMonConsole').hidden = !(patched && snapScreen && snapScreen.live);
  // Champs : pas de réécriture pendant la saisie
  const fields = [['gwMonUniverse', String(e.universe)], ['gwMonAddress', String(e.address)], ['gwMonMode', e.personality]];
  for (const [fid, v] of fields) {
    const el = document.getElementById(fid);
    if (el && document.activeElement !== el && !el.classList.contains('bad')) el.value = v;
  }
  const pers = SRDMX.getPersonality(e.personality);
  const last = e.address + pers.footprint - 1;
  _gwSetText('gwMonRange', 'Canaux ' + e.address + '–' + Math.min(512, last));
  document.getElementById('gwUnit-raw').classList.toggle('active', !_gwMonitorPct);
  document.getElementById('gwUnit-pct').classList.toggle('active', _gwMonitorPct);
  const look = patched && snapScreen ? snapScreen.look : null;
  const slice = gwScreenSlice(e);
  document.getElementById('gwMonSwatch').style.background = look ? look.color : '#000';
  const ctx = { e, look, slice };
  document.getElementById('gwMonRows').innerHTML = pers.channels.map((c, i) => {
    const v = slice[i] || 0;
    const pct = Math.round(v / 255 * 100);
    return '<div class="gw-ch"><span class="gw-ch-n">' + (e.address + i) + '</span>'
      + '<span class="gw-ch-label">' + escapeHtml(_GW_SHORT_LABEL[c.key] || c.label) + '</span>'
      + '<span class="gw-ch-bar"><span style="width:' + pct + '%"></span></span>'
      + '<span class="gw-ch-v">' + (_gwMonitorPct ? pct : v) + '</span>'
      + '<span class="gw-ch-m">' + escapeHtml(_gwMeaning(c.key, v, ctx)) + '</span></div>';
  }).join('');
  document.getElementById('gwUnpatchBtn').disabled = !patched;
}

// Saisie univers / adresse / mode : appliquée si valide (sinon champ en rouge)
function gwMonitorEdit() {
  const id = _gwMonitorId;
  if (!id) return;
  const uEl = document.getElementById('gwMonUniverse'), aEl = document.getElementById('gwMonAddress'), mEl = document.getElementById('gwMonMode');
  const num = (el) => (/^\s*\d{1,5}\s*$/.test(el.value) ? parseInt(el.value, 10) : NaN);
  const [uMin, uMax] = SRDMX.UNIVERSE_RANGE[gwState.protocol];
  const universe = num(uEl), address = num(aEl);
  const uOk = Number.isInteger(universe) && universe >= uMin && universe <= uMax;
  const aOk = Number.isInteger(address) && address >= 1 && address <= 512;
  uEl.classList.toggle('bad', !uOk);
  aEl.classList.toggle('bad', !aOk);
  if (!uOk || !aOk) return;
  gwPatchSet(id, { universe, address, personality: mEl.value });
}

function gwUnpatch() {
  if (!_gwMonitorId || !gwPatchDelete(_gwMonitorId)) return;
  gwShowView('patch');
}

// ── 17 · Table des canaux ──
function renderGwChannels() {
  const pers = SRDMX.getPersonality(_gwChannelsMode);
  _gwSetText('gwChTitle', pers.name);
  document.getElementById('gwChRows').innerHTML = pers.channels.map((c) => '<div class="gw-crow"><span>' + c.n + '</span><span>'
    + escapeHtml(_GW_SHORT_LABEL[c.key] || c.label) + '</span><span>' + escapeHtml(_GW_CH_VALUES[c.key] || '') + '</span></div>').join('');
  // Rappel des « emplacements » : seulement pour le mode qui en a (Étendu 16)
  document.getElementById('gwChNote').style.display = pers.id === 'extended16' ? 'block' : 'none';
}
