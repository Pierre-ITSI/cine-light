// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ ÉCRANS CONNECTÉS & CIBLE — INTERFACE ══════════════════════════
// Maquette 5 « Écrans connectés » : pour chaque écran son nom, ce qu'il
// montre, sa liaison, ses groupes, « Identifier » et « Renommer » ; groupes
// (« Salon · 2 ») et « + Nouveau groupe » ; « + Appairer » mène à l'onglet QR.
// Accès : « Gérer » du panneau « Écrans appairés » (maquette 1).
// Maquette 6 « Envoyer les commandes à… » : Tous / un groupe / un écran,
// ouvert par le bouton « Cible : … » placé sous l'aperçu de la télécommande.
// Feuilles (même présentation que la maquette 6) pour renommer un écran,
// choisir ses groupes, créer / modifier / supprimer un groupe.
// Maquette 5b : « Retirer l'écran » (bouton rouge à côté de Renommer) et sa
// confirmation ; le retrait lui-même : 29-revoke.js.
// Modèle (registre, cible, état de chaque écran) : 28-screens.js.
let _svOpen = false;
let _sheet = null;           // feuille ouverte : { kind: 'target' | 'rename' | 'screenGroups' | 'group' | 'chatName' | 'chatMenu' | 'seqName' | 'seqMenu' | 'install' | 'callers' | 'callerMenu' | 'callerName' | 'callName' | 'callMenu', … }
const _uiHtml = new Map();   // dernier HTML posé par conteneur (pas de re-rendu inutile pendant un geste)

function _setHtml(el, html) {
  if (!el || _uiHtml.get(el) === html) return;
  _uiHtml.set(el, html);
  el.innerHTML = html;
}
const _HEX_RE = /^#[0-9a-fA-F]{6}$/;
const _plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);

// Rafraîchit tout ce qui montre les écrans (appelé par scrChanged, renderLinkStatus)
function renderScreensUi() {
  if (mode !== 'remote') return;
  renderTargetBtn();
  renderScreensView();
  if (_sheet && (_sheet.kind === 'target' || _sheet.kind === 'screenGroups')) renderSheet();
  if (typeof renderOfflineView === 'function') renderOfflineView(); // préparation de chaque écran (maquette 10)
}
function closeScreensUi() { closeRevokeDialog(); closeSheet(); closeScreensView(); }

// ── Bouton « Cible : … » (maquette 6) ──
// Affiché dès deux écrans (ou une cible autre que « Tous »)
function scrTargetText() {
  const t = scrTarget();
  if (t.k === 'group') { const g = scrGroup(t.id); return { name: g ? g.name : 'Groupe', count: ' (' + _plural(scrGroupMembers(t.id).length, 'écran', 'écrans') + ')' }; }
  if (t.k === 'screen') return { name: scrName(t.id), count: '' };
  return { name: 'Tous les écrans', count: ' (' + scrList().length + ')' };
}
function renderTargetBtn() {
  const btn = document.getElementById('targetBtn');
  if (!btn) return;
  const t = scrTarget();
  const show = scrList().length >= 2 || t.k !== 'all';
  btn.style.display = show ? 'flex' : 'none';
  if (!show) return;
  btn.classList.toggle('subset', t.k !== 'all');
  const x = scrTargetText();
  _setHtml(document.getElementById('targetBtnLabel'), 'Cible : <b>' + escapeHtml(x.name) + '</b>' + x.count);
}

// ── Feuilles ──
function openTargetSheet() { _sheet = { kind: 'target' }; renderSheet(); }
function openRenameScreen(id) { if (scrKnown(id)) { _sheet = { kind: 'rename', id }; renderSheet(true); } }
function openScreenGroups(id) { if (scrKnown(id)) { _sheet = { kind: 'screenGroups', id }; renderSheet(); } }
function openGroupEditor(gid, preset) {
  const g = gid ? scrGroup(gid) : null;
  if (gid && !g) return;
  if (!g && _scrReg.groups.length >= SCR_GROUPS_MAX) return;
  _sheet = { kind: 'group', id: g ? g.id : null, members: new Set(g ? scrGroupMembers(g.id) : (preset || [])) };
  renderSheet(true);
}
function closeSheet() {
  _sheet = null;
  const w = document.getElementById('sr-sheet');
  if (w) w.classList.remove('open');
}

function _sheetRow(i, type, name, on, label, meta, extra) {
  return '<label class="sr-row' + (on ? ' on' : '') + (extra && extra.disabled ? ' disabled' : '') + '">'
    + '<input type="' + type + '" name="' + name + '"' + (on ? ' checked' : '') + (extra && extra.disabled ? ' disabled' : '')
    + ' onchange="sheetPick(' + i + ',this.checked)">'
    + '<span class="sr-row-label">' + escapeHtml(label) + '</span><span class="sr-row-meta">' + escapeHtml(meta) + '</span></label>';
}

function renderSheet(focus) {
  const wrap = document.getElementById('sr-sheet');
  if (!wrap) return;
  if (!_sheet) { wrap.classList.remove('open'); return; }
  const title = document.getElementById('srSheetTitle'), body = document.getElementById('srSheetBody');
  const s = _sheet;
  let t = '', h = '', form = s.kind === 'rename' || s.kind === 'group';
  if (s.kind === 'chatName' || s.kind === 'chatMenu' || s.kind === 'chatNew' || s.kind === 'seqName' || s.kind === 'seqMenu' || s.kind === 'seqNew') {
    // Discussions enregistrées (89-discussions-saved.js), séquences enregistrées (96-sequences-saved.js) : nom, menu « ⋯ »,
    // « Enregistrer avant ? » de « + Nouvelle séquence / discussion » (maquettes 47, 47b)
    const c = s.kind.startsWith('seq') ? seqSheetContent(s) : chatSheetContent(s);
    if (!c) { closeSheet(); return; }
    t = c.title; h = c.html; form = c.form;
  } else if (s.kind === 'callName' || s.kind === 'callMenu') {
    // Appels, SMS et notifications enregistrés (maquettes 43b, 43c, 82-call-list.js) : nom, menu « ⋯ »
    const c = callListSheetContent(s);
    if (!c) { closeSheet(); return; }
    t = c.title; h = c.html; form = c.form;
  } else if (s.kind === 'callers' || s.kind === 'callerMenu' || s.kind === 'callerName') {
    // Appelants enregistrés (maquette 36e, 79-callers.js) : liste, menu « ⋯ », renommer
    const c = callersSheetContent(s);
    if (!c) { closeSheet(); return; }
    t = c.title; h = c.html; form = c.form;
  } else if (s.kind.startsWith('prj')) {
    // Projets (maquettes 46 à 46c, 74-project-ui.js) : menu « ⋯ », renommer, nouveau projet, ouvrir, refus pendant le jeu
    const c = projectSheetContent(s);
    if (!c) { closeSheet(); return; }
    t = c.title; h = c.html; form = c.form;
  } else if (s.kind === 'install') {
    // Installer l'application (maquettes 35, 90-pwa.js)
    const c = pwaSheetContent();
    t = c.title; h = c.html;
  } else if (s.kind === 'target') {
    // Maquette 6 : Tous, chaque groupe (vide : non sélectionnable), chaque écran
    t = 'Envoyer les commandes à…';
    const cur = scrTarget(), list = scrList();
    s.rows = [{ t: { k: 'all' }, label: 'Tous les écrans', meta: String(list.length) }];
    for (const g of _scrReg.groups) {
      const n = scrGroupMembers(g.id).length;
      s.rows.push({ t: { k: 'group', id: g.id }, label: 'Groupe ' + g.name, meta: String(n), disabled: !n });
    }
    for (const id of list) s.rows.push({ t: { k: 'screen', id }, label: scrName(id), meta: scrOnline(id) ? 'écran' : 'hors ligne' });
    h = s.rows.map((r, i) => _sheetRow(i, 'radio', 'srTarget', r.t.k === cur.k && r.t.id === cur.id, r.label, r.meta, r)).join('');
  } else if (s.kind === 'rename') {
    const e = _scrReg.screens.get(s.id);
    if (!e) { closeSheet(); return; }
    t = 'Renommer l\'écran';
    h = '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">Nom affiché</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + SCR_NAME_MAX + '" autocomplete="off" placeholder="Écran ' + e.n + '" value="' + escapeHtml(e.name || '') + '">'
      + '<p class="sr-sheet-note">Le nom s\'affiche dans la liste des écrans, la cible et la passerelle DMX. Vide : « Écran ' + e.n + ' ».</p>'
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">Annuler</button><button type="submit" class="sr-ok">Enregistrer</button></div></form>';
  } else if (s.kind === 'screenGroups') {
    const e = _scrReg.screens.get(s.id);
    if (!e) { closeSheet(); return; }
    t = 'Groupes de « ' + scrName(s.id) + ' »';
    s.rows = _scrReg.groups.map((g) => ({ gid: g.id, label: g.name, meta: String(scrGroupMembers(g.id).length) }));
    h = s.rows.map((r, i) => _sheetRow(i, 'checkbox', 'srGroups', e.groups.includes(r.gid), r.label, r.meta)).join('')
      || '<p class="sr-sheet-note">Aucun groupe pour l\'instant.</p>';
    if (_scrReg.groups.length < SCR_GROUPS_MAX) h += '<button type="button" class="sr-add" onclick="openGroupEditor(null,[\'' + s.id + '\'])">+ Nouveau groupe</button>';
    h += '<div class="sr-actions"><button type="button" class="sr-ok" onclick="closeSheet()">OK</button></div>';
  } else if (s.kind === 'group') {
    const g = s.id ? scrGroup(s.id) : null;
    if (s.id && !g) { closeSheet(); return; }
    t = g ? 'Groupe « ' + g.name + ' »' : 'Nouveau groupe';
    s.rows = scrList().map((id) => ({ id, label: scrName(id), meta: scrOnline(id) ? 'écran' : 'hors ligne' }));
    h = '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">Nom du groupe</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + SCR_NAME_MAX + '" autocomplete="off" placeholder="Salon" value="' + escapeHtml(g ? g.name : '') + '">'
      + '<div class="sr-sublabel">Écrans</div>'
      + (s.rows.map((r, i) => _sheetRow(i, 'checkbox', 'srMembers', s.members.has(r.id), r.label, r.meta)).join('')
        || '<p class="sr-sheet-note">Aucun écran appairé.</p>')
      + '<div class="sr-actions">' + (g ? '<button type="button" class="sr-del" onclick="sheetDeleteGroup()">Supprimer</button>' : '')
      + '<button type="button" class="sr-cancel" onclick="closeSheet()">Annuler</button>'
      + '<button type="submit" class="sr-ok">' + (g ? 'Enregistrer' : 'Créer') + '</button></div></form>';
  }
  title.textContent = t;
  // Formulaires : posés une fois (saisie en cours préservée) ; listes : mises à jour
  if (form) { _uiHtml.delete(body); body.innerHTML = h; }
  else _setHtml(body, h);
  wrap.classList.add('open');
  if (focus) { const inp = document.getElementById('srName'); if (inp) { try { inp.focus({ preventScroll: true }); } catch (_) {} } }
}

// Ligne touchée dans la feuille ouverte
function sheetPick(i, checked) {
  const s = _sheet;
  if (!s || !s.rows || !s.rows[i]) return;
  const r = s.rows[i];
  if (s.kind === 'target') {
    if (r.disabled) return;
    scrSetTarget(r.t);
    closeSheet();
  } else if (s.kind === 'screenGroups') {
    const e = _scrReg.screens.get(s.id);
    if (!e) return;
    scrSetScreenGroups(s.id, checked ? [...e.groups, r.gid] : e.groups.filter((g) => g !== r.gid));
    renderSheet();
  } else if (s.kind === 'group') {
    if (checked) s.members.add(r.id); else s.members.delete(r.id);
  }
}
function sheetSave() {
  const s = _sheet;
  const inp = document.getElementById('srName');
  if (!s || !inp) return;
  if (s.kind === 'chatName') { chatSheetSave(s, inp.value); return; } // 89-discussions-saved.js
  if (s.kind === 'seqName') { seqSheetSave(s, inp.value); return; }   // 96-sequences-saved.js
  if (s.kind === 'callerName') { callerSheetSave(s, inp.value); return; } // 79-callers.js
  if (s.kind === 'callName') { callListSheetSave(s, inp.value); return; } // 82-call-list.js
  if (s.kind === 'prjName' || s.kind === 'prjNew') { projectSheetSave(s, inp.value); return; } // 74-project-ui.js
  if (s.kind === 'rename') scrRenameScreen(s.id, inp.value);
  else if (s.kind === 'group') {
    const members = [...s.members].filter(scrKnown);
    if (s.id) { scrRenameGroup(s.id, inp.value); scrSetGroupMembers(s.id, members); }
    else scrCreateGroup(inp.value, members);
  }
  closeSheet();
  renderScreensUi();
}
function sheetDeleteGroup() {
  const s = _sheet, g = s && s.id ? scrGroup(s.id) : null;
  if (!g) return;
  if (!confirm('Supprimer le groupe « ' + g.name + ' » ? Ses écrans restent appairés.')) return;
  scrDeleteGroup(g.id);
  closeSheet();
  renderScreensUi();
}

// ── Vue « Écrans connectés » (maquette 5) ──
function openScreensView() {
  const v = document.getElementById('screens-view');
  if (!v) return;
  _svOpen = true;
  v.classList.add('open');
  v.scrollTop = 0;
  renderScreensView();
}
function closeScreensView() {
  _svOpen = false;
  const v = document.getElementById('screens-view');
  if (v) v.classList.remove('open');
}
// « + Appairer » : l'appairage reste celui de l'onglet QR
function screensViewPair() {
  closeSheet();
  closeScreensView();
  switchTab('qr');
  const rm = document.getElementById('remote-mode'), qr = document.getElementById('content-qr');
  if (rm && qr) rm.scrollTop += qr.getBoundingClientRect().top - 80;
}

// Ce que montre un écran, d'après son état attendu et ses retours
function scrNowText(id) {
  const st = scrState(id);
  if (st.call) {
    const who = st.call.name || 'Inconnu';
    if (st.call.kind === 'sms' || st.call.kind === 'chat' || st.call.kind === 'whatsapp') return 'SMS · ' + who;
    if (st.call.kind === 'notif') return 'Notification · ' + who;
    return (st.call.state === 'incall' ? 'En ligne · ' : 'Appel entrant · ') + who;
  }
  if (chatIsOpenOn(id)) return 'Discussion · ' + chatContactName();
  if (st.dmxLive) return 'Console DMX';
  if (st.blackout) return 'Écran noir';
  const it = st.media ? _mediaPool.find((m) => m.id === st.media) : null;
  if (it) return (it.kind === 'vid' ? 'Vidéo · ' : 'Image · ') + it.name;
  if (st.strobe) return 'Stroboscope · ' + String(Math.round(st.strobe.freq * 10) / 10).replace('.', ',') + ' Hz';
  if (st.effect && EFFECT_CONFIG[st.effect.name]) {
    const p = st.effect.params || {};
    return 'Effet ' + EFFECT_CONFIG[st.effect.name].name + ' · '
      + (st.effect.name === 'tv' && p.smooth != null ? 'lissage ' + p.smooth + ' %' : 'intensité ' + (p.intensity != null ? p.intensity : 100) + ' %');
  }
  const s = st.colorSpec;
  if (!s) return String(st.color).toUpperCase();
  if (s.crossfade < 5) return s.kelvin + ' K · ' + s.dimmer + ' %';
  if (s.crossfade > 95) return String(st.color).toUpperCase() + ' · ' + s.dimmer + ' %';
  return 'Mix ' + s.crossfade + ' % · ' + s.dimmer + ' %';
}
// Pastille : couleur, dégradé de l'effet, vignette du média
function scrSwatchCss(id) {
  const st = scrState(id);
  if (st.call) return 'background:#20262f';
  if (st.dmxLive) return 'background:' + (_HEX_RE.test(st.dmxColor) ? st.dmxColor : '#000');
  if (st.blackout) return 'background:#000';
  const it = st.media ? _mediaPool.find((m) => m.id === st.media) : null;
  if (it && it.thumb) return 'background:#000 url(&quot;' + it.thumb + '&quot;) center/cover no-repeat';
  if (st.effect) {
    const p = st.effect.params || {};
    const cs = (Array.isArray(p.blocks) && p.blocks.length ? p.blocks : [p.color1, p.color2]).filter((c) => _HEX_RE.test(c));
    if (cs.length >= 2) return 'background:linear-gradient(135deg,' + cs[0] + ',' + cs[1] + ')';
    if (cs.length) return 'background:' + cs[0];
  }
  return 'background:' + (_HEX_RE.test(st.color) ? st.color : '#000');
}

function renderScreensView() {
  if (!_svOpen) return;
  const list = scrList(), t = scrTarget();
  _setHtml(document.getElementById('svList'), list.length ? list.map((id) => {
    const e = _scrReg.screens.get(id);
    // Liaison de l'écran (maquette 5) : Internet, Wi-Fi local, Bluetooth ou Hors ligne (21-links.js)
    const link = scrOnline(id) ? scrLinkOf(id) : 'off';
    const groups = e.groups.map((g) => (scrGroup(g) || {}).name).filter(Boolean);
    return '<div class="sv-card" data-id="' + id + '">'
      + '<div class="sv-row"><span class="sv-swatch" style="' + scrSwatchCss(id) + '"></span>'
      + '<div class="sv-main"><div class="sv-name">' + escapeHtml(scrName(id)) + '</div><div class="sv-now">' + escapeHtml(scrNowText(id)) + '</div></div>'
      + '<span class="sv-link' + (link === 'internet' ? '' : ' ' + link) + '">' + LINK_LABELS[link] + '</span></div>'
      + '<div class="sv-row"><button type="button" class="sv-group' + (groups.length ? '' : ' none') + '" onclick="openScreenGroups(\'' + id + '\')">'
      + escapeHtml(groups.length ? groups.join(' · ') : 'Sans groupe') + '</button><span class="sv-flex"></span>'
      + '<button type="button" class="sv-btn" onclick="scrIdentify(\'' + id + '\')">Identifier</button>'
      + '<button type="button" class="sv-icon" aria-label="Renommer" onclick="openRenameScreen(\'' + id + '\')">'
      + '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg></button>'
      + '<button type="button" class="sv-icon sv-revoke" aria-label="Retirer l\'écran" onclick="openRevokeDialog(\'' + id + '\')">' + _UNLINK_SVG(16, 2) + '</button></div></div>';
  }).join('') : '<div class="sv-empty">Aucun écran appairé : touchez « + Appairer » puis scannez le QR sur chaque écran de jeu.</div>');
  _setHtml(document.getElementById('svGroups'), _scrReg.groups.map((g) => '<button type="button" class="sv-chip' + (t.k === 'group' && t.id === g.id ? ' on' : '')
    + '" onclick="openGroupEditor(\'' + g.id + '\')">' + escapeHtml(g.name) + ' · ' + scrGroupMembers(g.id).length + '</button>').join('')
    + (_scrReg.groups.length < SCR_GROUPS_MAX ? '<button type="button" class="sv-chip add" onclick="openGroupEditor(null)">+ Nouveau groupe</button>' : ''));
}

// ── Retirer un écran (maquette 5b) ──
const _UNLINK_SVG = (size, sw) => '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + sw
  + '" aria-hidden="true"><path d="M15 7l2-2a3.5 3.5 0 015 5l-2 2M9 17l-2 2a3.5 3.5 0 01-5-5l2-2M8 8l8 8"/></svg>';
let _revokeId = null;
function openRevokeDialog(id) {
  if (!scrKnown(id)) return;
  _revokeId = id;
  document.getElementById('rvTitle').textContent = 'Retirer « ' + scrName(id) + ' » ?';
  // Écrans qui ne pourront pas suivre (pas de clé par écran) : dit avant de confirmer
  const lost = scrRevokeFollowers(id).lost;
  const w = document.getElementById('rvLost');
  w.textContent = lost.length ? (lost.length > 1 ? 'Ne pourront pas suivre et devront être appairés à nouveau : ' : 'Ne pourra pas suivre et devra être appairé à nouveau : ')
    + lost.map((s) => '« ' + scrName(s) + ' »').join(', ') + '.' : '';
  w.style.display = lost.length ? 'block' : 'none';
  document.getElementById('sr-revoke').classList.add('open');
}
function closeRevokeDialog() {
  _revokeId = null;
  const d = document.getElementById('sr-revoke');
  if (d) d.classList.remove('open');
}
function confirmRevoke() {
  const id = _revokeId;
  closeRevokeDialog();
  if (id) scrRevoke(id).then(() => renderScreensUi());
}

// Échap : ferme la feuille, puis la vue
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (_revokeId) closeRevokeDialog();
  else if (_sheet) closeSheet();
  else if (_svOpen) closeScreensView();
});
