// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SÉQUENCES ENREGISTRÉES (onglet Séquence, télécommande) ══════════════════════════
// Comme les discussions enregistrées (89-discussions-saved.js) : deux
// sous-onglets, « Séquence en cours » (91-sequence.js) et « Enregistrées (n) ».
// Une séquence enregistrée garde son nom et ses étapes : des RÉFÉRENCES aux
// éléments enregistrés des autres onglets, jamais des copies (une mémoire
// modifiée est jouée telle quelle, une supprimée devient « élément
// introuvable »), avec cible, départ et réglages, et ses réglages « Téléphone
// au départ » (maquette 28b : heure, réseau, batterie ; maquette 42 : fond
// d'écran) ; pas le déroulé.
// Anciennes séquences (sans ces réglages) : valeurs par défaut (heure réelle, sans fond).
//   • « + Enregistrer la séquence en cours » : demande un nom, ajoute en fin de liste.
//   • Toucher une ligne : la charge dans « Séquence en cours » (confirmation si
//     la séquence en cours a des modifications non enregistrées) ; un déroulé
//     commencé repart de zéro (Recommencer).
//   • « ⋯ » : renommer, dupliquer, supprimer (avec confirmation).
// Stockage : localStorage (au plus SEQ_SAVED_MAX séquences, revalidées au
// chargement) ; les images d'accueil et fonds d'écran restent dans IndexedDB, partagés par
// empreinte (seqGcImages efface celles que plus rien n'utilise). Export et
// import : projets (72-project.js). Jamais déclenchées par la console DMX.
const SEQ_SAVED_KEY = 'setremote-seq-saved-v1';
const SEQ_SAVED_MAX = 100;
// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _SQSV_TXT = {
  tabCur: 'Séquence en cours',
  tab: 'Enregistrées ({n})',
  meta: '{n} · {cible}',
  steps1: '1 étape',
  stepsN: '{n} étapes',
  noTarget: 'sans étape',
  missing1: '1 élément introuvable',
  missingN: '{n} éléments introuvables',
  save: '+ Enregistrer la séquence en cours',
  full: 'Liste pleine ({max} séquences)',
  empty: 'Aucune séquence enregistrée pour l\'instant.',
  hint: 'Toucher : charger dans « Séquence en cours ». ⋯ : renommer · dupliquer · supprimer.',
  note: 'Une séquence enregistrée garde ses étapes, leurs cibles et leurs départs, et son « Téléphone au départ » (fond d\'écran compris). Les couleurs, effets, médias, appels, SMS, notifications et discussions restent ceux de leurs onglets : modifiés là-bas, ils sont joués tels quels.',
  sheetSave: 'Enregistrer la séquence en cours',
  sheetRename: 'Renommer la séquence',
  nameLabel: 'Nom de la séquence',
  nameNote: 'Vide : « {defaut} ».',
  cancel: 'Annuler',
  ok: 'Enregistrer',
  rename: 'Renommer',
  duplicate: 'Dupliquer',
  remove: 'Supprimer',
  copy: '{nom} (copie)',
  confirmLoad: 'La séquence en cours a des modifications non enregistrées. Charger « {nom} » à la place ?',
  confirmDelete: 'Supprimer la séquence « {nom} » ?',
  storeFull: 'Enregistrement impossible : la mémoire de l\'appareil est pleine.',
  untitled: 'Séquence',
  // « + Nouvelle séquence » (maquette 47)
  newBtn: '+ Nouvelle séquence',
  newAsk: 'Enregistrer « {nom} » avant ?',
  newAskText: 'La séquence en cours a des modifications non enregistrées. La nouvelle séquence part de zéro.',
  newAskTextSaved: 'La séquence en cours a des modifications non enregistrées. La nouvelle séquence part de zéro ; « {nom} » enregistrée reste telle quelle.',
  newDiscard: 'Ne pas enregistrer',
  newFull: 'Liste pleine ({max} séquences) : enregistrement impossible.',
};

let seqSaved = [];

function _sqsvSanitize(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !_SEQ_ID_RE.test(e.id)) return null;
  return { id: e.id, name: _seqLine(e.name, SEQ_NAME_MAX) || _SQSV_TXT.untitled, steps: seqSanitizeSteps(e.steps), phone: phoneBarSanitize(e.phone), wall: seqWallSanitize(e.wall) };
}
function loadSavedSeqs() {
  let o = null;
  try { o = JSON.parse(_lsGet(SEQ_SAVED_KEY)); } catch (_) { o = null; }
  const ids = new Set();
  seqSaved = (o && Array.isArray(o.list) ? o.list : []).map(_sqsvSanitize).filter((e) => e && !ids.has(e.id) && ids.add(e.id)).slice(0, SEQ_SAVED_MAX);
  if (_seq.savedId && !ids.has(_seq.savedId)) _seq.savedId = null;
}
function _sqsvPersist() {
  return _lsPut(SEQ_SAVED_KEY, JSON.stringify({ v: 1, list: seqSaved }));
}
const _sqsvNewId = () => 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const _sqsvClone = (steps) => JSON.parse(JSON.stringify(steps));
const _sqsvSig = (steps, phone, wall) => JSON.stringify([steps, phone, wall ? wall.img : null]);
// Images d'une séquence (accueil des déverrouillages, fond d'écran) : pour seqGcImages
const _sqsvImages = (steps, wall) => steps.filter((s) => s.kind === 'unlock' && s.opt.img).map((s) => s.opt.img).concat(wall ? [wall.img] : []);
// Modifications non enregistrées : différente de l'entrée d'origine ; sans entrée, toute séquence non vide
function seqHasUnsavedChanges() {
  const e = seqSaved.find((x) => x.id === _seq.savedId);
  if (e) return _sqsvSig(e.steps, e.phone, e.wall) !== _sqsvSig(_seq.steps, seqPhoneCfg(), _seq.wall);
  return _seq.steps.length > 0;
}
function _sqsvDefaultName() { return (_seq.name || _SQSV_TXT.untitled).slice(0, SEQ_NAME_MAX); }

// « + Enregistrer la séquence en cours »
function saveCurrentSeq(name) {
  if (seqSaved.length >= SEQ_SAVED_MAX) return null;
  const e = { id: _sqsvNewId(), name: _seqLine(String(name || '').trim(), SEQ_NAME_MAX) || _sqsvDefaultName(), steps: _sqsvClone(_seq.steps), phone: _sqsvClone(seqPhoneCfg()), wall: _seq.wall ? Object.assign({}, _seq.wall) : null };
  seqSaved.push(e);
  if (!_sqsvPersist()) { seqSaved.pop(); alert(_SQSV_TXT.storeFull); return null; }
  _seq.savedId = e.id;
  _seq.name = e.name;
  seqSave();
  renderSeq();
  return e.id;
}
// Toucher une ligne : charge l'entrée dans « Séquence en cours »
function loadSavedSeq(id) {
  const e = seqSaved.find((x) => x.id === id);
  if (!e) return false;
  const dirty = seqHasUnsavedChanges();
  if (e.id === _seq.savedId && !dirty) { setSeqView('cur'); return true; }
  if (dirty && !confirm(_seqTpl(_SQSV_TXT.confirmLoad, { nom: e.name }))) return false;
  if (seqPos() >= 0 || _seqRun.state !== 'idle') seqRestart();
  const dropped = _sqsvImages(_seq.steps, _seq.wall);
  _seq = { name: e.name, steps: _sqsvClone(e.steps), savedId: e.id, phone: _sqsvClone(e.phone), wall: e.wall ? Object.assign({}, e.wall) : null };
  seqSave();
  seqGcImages(dropped);
  setSeqView('cur');
  return true;
}
function renameSavedSeq(id, name) {
  const e = seqSaved.find((x) => x.id === id);
  if (!e) return;
  const prev = e.name;
  e.name = _seqLine(String(name || '').trim(), SEQ_NAME_MAX) || prev;
  if (!_sqsvPersist()) { e.name = prev; alert(_SQSV_TXT.storeFull); }
  if (_seq.savedId === id) { _seq.name = e.name; seqSave(); }
  renderSeq();
}
// Copie placée juste après l'original (images d'accueil et fond partagés par empreinte)
function duplicateSavedSeq(id) {
  const i = seqSaved.findIndex((x) => x.id === id);
  if (i < 0 || seqSaved.length >= SEQ_SAVED_MAX) return null;
  const src = seqSaved[i];
  const e = { id: _sqsvNewId(), name: _seqTpl(_SQSV_TXT.copy, { nom: src.name }).slice(0, SEQ_NAME_MAX), steps: _sqsvClone(src.steps), phone: _sqsvClone(src.phone), wall: src.wall ? Object.assign({}, src.wall) : null };
  seqSaved.splice(i + 1, 0, e);
  if (!_sqsvPersist()) { seqSaved.splice(i + 1, 1); alert(_SQSV_TXT.storeFull); return null; }
  renderSeq();
  return e.id;
}
function deleteSavedSeq(id) {
  const i = seqSaved.findIndex((x) => x.id === id);
  if (i < 0) return false;
  if (!confirm(_seqTpl(_SQSV_TXT.confirmDelete, { nom: seqSaved[i].name }))) return false;
  const [e] = seqSaved.splice(i, 1);
  _sqsvPersist();
  if (_seq.savedId === id) { _seq.savedId = null; seqSave(); }
  seqGcImages(_sqsvImages(e.steps, e.wall));
  renderSeq();
  return true;
}

// ── Rendu ──
function _sqsvMeta(e) {
  const n = e.steps.length;
  const s = e.steps.find((x) => SEQ_PHONE_KINDS.has(x.kind)) || e.steps[0];
  const miss = e.steps.filter((x) => !seqRefItem(x)).length;
  let t = _seqTpl(_SQSV_TXT.meta, { n: n === 1 ? _SQSV_TXT.steps1 : _seqTpl(_SQSV_TXT.stepsN, { n }), cible: s ? seqTargetName(s.target) : _SQSV_TXT.noTarget });
  if (miss) t += ' · ' + (miss === 1 ? _SQSV_TXT.missing1 : _seqTpl(_SQSV_TXT.missingN, { n: miss }));
  return t;
}
function renderSavedSeqs() {
  _seqSet('seqTab-cur', _SQSV_TXT.tabCur);
  _seqSet('seqTab-saved', _seqTpl(_SQSV_TXT.tab, { n: seqSaved.length }));
  _seqSet('seqNewBtn', _SQSV_TXT.newBtn);
  const rows = document.getElementById('seqSavedRows');
  if (!rows) return;
  rows.textContent = '';
  for (const e of seqSaved) {
    const row = document.createElement('div');
    row.className = 'dc-saved-row' + (e.id === _seq.savedId ? ' selected' : '');
    row.dataset.id = e.id;
    row.onclick = () => loadSavedSeq(e.id);
    const main = document.createElement('span'); main.className = 'dc-saved-main';
    const nm = document.createElement('span'); nm.className = 'dc-saved-name'; nm.textContent = e.name;
    const meta = document.createElement('span'); meta.className = 'dc-saved-meta'; meta.textContent = _sqsvMeta(e);
    main.append(nm, meta);
    const more = document.createElement('button'); more.type = 'button'; more.className = 'dc-saved-more'; more.textContent = '⋯';
    more.setAttribute('aria-label', _SQSV_TXT.rename + ', ' + _SQSV_TXT.duplicate.toLowerCase() + ', ' + _SQSV_TXT.remove.toLowerCase());
    more.onclick = (ev) => { ev.stopPropagation(); openSavedSeqMenu(e.id); };
    row.append(main, more);
    rows.appendChild(row);
  }
  _seqSet('seqSavedEmpty', _SQSV_TXT.empty);
  _seqSet('seqSavedHint', _SQSV_TXT.hint);
  _seqSet('seqSavedNote', _SQSV_TXT.note);
  const empty = document.getElementById('seqSavedEmpty');
  if (empty) empty.style.display = seqSaved.length ? 'none' : '';
  const hint = document.getElementById('seqSavedHint');
  if (hint) hint.style.display = seqSaved.length ? '' : 'none';
  const btn = document.getElementById('seqSaveBtn');
  if (btn) {
    const full = seqSaved.length >= SEQ_SAVED_MAX;
    btn.disabled = full;
    btn.textContent = full ? _seqTpl(_SQSV_TXT.full, { max: SEQ_SAVED_MAX }) : _SQSV_TXT.save;
  }
}

// ── Feuilles (39-screens-ui.js : _sheet, renderSheet, closeSheet) ──
function openSaveSeqSheet() {
  if (licLocked('seq')) return; // aperçu sans licence (77-licence-ui.js)
  if (seqSaved.length >= SEQ_SAVED_MAX) return;
  _sheet = { kind: 'seqName', id: null }; renderSheet(true);
}
function openSavedSeqMenu(id) {
  if (!seqSaved.some((x) => x.id === id)) return;
  _sheet = { kind: 'seqMenu', id }; renderSheet();
}
function openRenameSavedSeq(id) {
  if (!seqSaved.some((x) => x.id === id)) return;
  _sheet = { kind: 'seqName', id }; renderSheet(true);
}
// Contenu d'une feuille de séquence : { title, html, form } ; null : entrée disparue
function seqSheetContent(s) {
  if (s.kind === 'seqNew') {
    const saved = seqSaved.find((x) => x.id === _seq.savedId);
    return {
      title: _seqTpl(_SQSV_TXT.newAsk, { nom: s.name }), form: false,
      html: '<p class="sr-sheet-note prj-sheet-text">' + escapeHtml(saved ? _seqTpl(_SQSV_TXT.newAskTextSaved, { nom: saved.name }) : _SQSV_TXT.newAskText) + '</p>'
        + (s.msg ? '<p class="sr-sheet-note prj-sheet-err" role="alert">' + escapeHtml(s.msg) + '</p>' : '')
        + '<button type="button" class="dc-menu-btn danger" id="seqNewDiscard" onclick="seqNewAnswer(\'discard\')">' + escapeHtml(_SQSV_TXT.newDiscard) + '</button>'
        + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_SQSV_TXT.cancel) + '</button>'
        + '<button type="button" class="sr-ok" id="seqNewSave" onclick="seqNewAnswer(\'save\')">' + escapeHtml(_SQSV_TXT.ok) + '</button></div>',
    };
  }
  const e = s.id ? seqSaved.find((x) => x.id === s.id) : null;
  if (s.id && !e) return null;
  if (s.kind === 'seqMenu') {
    const b = (cls, fn, label) => '<button type="button" class="dc-menu-btn' + cls + '" onclick="' + fn + '(\'' + e.id + '\')">' + escapeHtml(label) + '</button>';
    return {
      title: e.name, form: false,
      html: b('', 'seqMenuRename', _SQSV_TXT.rename) + (seqSaved.length < SEQ_SAVED_MAX ? b('', 'seqMenuDuplicate', _SQSV_TXT.duplicate) : '')
        + b(' danger', 'seqMenuDelete', _SQSV_TXT.remove)
        + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_SQSV_TXT.cancel) + '</button></div>',
    };
  }
  const def = _sqsvDefaultName();
  return {
    title: e ? _SQSV_TXT.sheetRename : _SQSV_TXT.sheetSave, form: true,
    html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
      + '<label class="sr-sublabel" for="srName">' + escapeHtml(_SQSV_TXT.nameLabel) + '</label>'
      + '<input type="text" id="srName" class="text-input sr-input" maxlength="' + SEQ_NAME_MAX + '" autocomplete="off" placeholder="' + escapeHtml(e ? e.name : def) + '" value="' + escapeHtml(e ? e.name : '') + '">'
      + (e ? '' : '<p class="sr-sheet-note">' + escapeHtml(_seqTpl(_SQSV_TXT.nameNote, { defaut: def })) + '</p>')
      + '<div class="sr-actions"><button type="button" class="sr-cancel" onclick="closeSheet()">' + escapeHtml(_SQSV_TXT.cancel) + '</button>'
      + '<button type="submit" class="sr-ok">' + escapeHtml(_SQSV_TXT.ok) + '</button></div></form>',
  };
}
function seqSheetSave(s, value) {
  closeSheet();
  if (s.id) renameSavedSeq(s.id, value);
  else saveCurrentSeq(value);
}
function seqMenuRename(id) { openRenameSavedSeq(id); }
function seqMenuDuplicate(id) { closeSheet(); duplicateSavedSeq(id); }
function seqMenuDelete(id) { closeSheet(); deleteSavedSeq(id); }

// ── Nouvelle séquence (maquette 47) : bouton « + NOUVELLE SÉQUENCE » sous les sous-onglets ──
// Sans modification en cours : aussitôt. Sinon feuille « Enregistrer « … » avant ? » :
// Enregistrer (nouvelle entrée, nom actuel) / Ne pas enregistrer / Annuler.
function seqNewAsk() {
  if (licLocked('seq')) return; // aperçu sans licence (77-licence-ui.js)
  const r = seqNew();
  if (!r.ok && r.code === 'dirty') { _sheet = { kind: 'seqNew', name: r.name }; renderSheet(); }
}
function seqNewAnswer(choice) {
  const s = _sheet;
  if (!s || s.kind !== 'seqNew') return;
  const r = seqNew(choice === 'save' ? { save: '' } : { discard: true });
  if (r.ok) { closeSheet(); return; }
  s.msg = r.code === 'full' ? _seqTpl(_SQSV_TXT.newFull, { max: SEQ_SAVED_MAX }) : _SQSV_TXT.storeFull;
  renderSheet();
}
// Moteur :
// Repart d'une séquence vide sans toucher aux enregistrées. La séquence en cours
// a des modifications non enregistrées (seqHasUnsavedChanges) : refus
// { ok: false, code: 'dirty', name } tant que l'appelant n'a pas choisi :
//   opts.save (nom, '' = nom par défaut) : enregistrée d'abord comme NOUVELLE entrée ;
//   opts.discard : modifications abandonnées.
// La nouvelle séquence n'est liée à aucune entrée (savedId null) : l'enregistrer
// crée une nouvelle entrée, l'entrée chargée auparavant reste telle quelle.
// Un déroulé commencé repart de zéro (Recommencer). Aperçu sans licence : 'locked'.
function seqNew(opts = {}) {
  if (licLocked('seq')) return { ok: false, code: 'locked' };
  if (seqHasUnsavedChanges()) {
    if (typeof opts.save === 'string') {
      if (seqSaved.length >= SEQ_SAVED_MAX) return { ok: false, code: 'full' };
      if (!saveCurrentSeq(opts.save)) return { ok: false, code: 'storage-full' };
    } else if (opts.discard !== true) return { ok: false, code: 'dirty', name: _sqsvDefaultName() };
  }
  if (_seqEdit) closeSeqStep();
  if (seqPos() >= 0 || _seqRun.state !== 'idle') seqRestart();
  const dropped = _sqsvImages(_seq.steps, _seq.wall);
  _seq = _seqEmpty();
  seqSave();
  seqGcImages(dropped);
  setSeqView('cur');
  return { ok: true };
}
