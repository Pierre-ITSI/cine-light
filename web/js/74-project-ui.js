// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ PROJETS : INTERFACE (télécommande) ══════════════════════════
// Maquettes validées 45 à 46c. Moteur : 72-project.js ; contrat : docs/PROJECTS.md.
//   45   Réglages › carte « Projet » : projet ouvert (nom, compteurs) → « Projets › »,
//        « Exporter le projet… », « Importer un projet… », dernier export.
//   45b  Vue « Exporter le projet » : nom, sections cochées avec compteurs, médias
//        en option (taille), taille estimée, EXPORTER (web : téléchargement
//        « Nom.rem » ; app : feuille de partage). Séquences cochées mais appels,
//        discussions, appelants, sonneries ou mémoires décochés (non vides) :
//        avertissement « introuvables ».
//   45c  Vue « Importer un projet » : fichier (nom, taille, date d'export,
//        version), sections du fichier à cocher, mode (Ajouter / Remplacer /
//        Ouvrir comme nouveau projet), avertissement de ce que « Remplacer »
//        supprime (sonneries importées comprises : un appel dont le son
//        disparaît reprend « Classique »).
//   45d  Compte rendu (« Projet importé ») ; 45e erreurs (rien n'a été modifié).
//   46   Vue « Projets » : projet ouvert en orange, « ⋯ » (Ouvrir, Renommer,
//        Dupliquer, Exporter…, Supprimer), « + NOUVEAU PROJET », « IMPORTER UN PROJET… ».
//   46b  Feuille « Nouveau projet » (Vide / À partir du projet actuel) : créé puis ouvert.
//   46c  Feuille « Ouvrir « … » ? » ; refus pendant le jeu (séquence lancée,
//        discussion ouverte, appel en cours sur un écran).
// Une seule vue plein écran (#project-view, gabarit des Réglages : st-head,
// st-card) dont le contenu change ; les feuilles sont celles de 39-screens-ui.js
// (_sheet, renderSheet). Aperçu sans licence : tout reste disponible ici (les
// données importées vont dans le stockage réel, 72-project.js).
// Nouvelle séquence / nouvelle discussion (maquettes 47, 47b) : 96-sequences-saved.js,
// 89-discussions-saved.js.

// Textes affichés, regroupés pour la traduction ({…} : valeurs)
const _PJU_TXT = {
  title: { list: 'Projets', export: 'Exporter le projet', import: 'Importer un projet', report: 'Projet importé', error: 'Importer un projet' },
  sec: { seq: 'Séquences', chat: 'Discussions', calls: 'Appels et SMS', callers: 'Appelants', rings: 'Sonneries', memories: 'Mémoires', media: 'Médias' },
  expSub: {
    seq: 'Téléphone au départ et fonds d\'écran compris', chat: 'Timings et photos des contacts', callers: 'Avec leurs photos',
    rings: 'Sons importés et choix par type', media: 'Images et vidéos du pool : lourd, facultatif', calls: 'Photos et bandes son comprises',
  },
  open: 'Projet ouvert', projects: 'Projets ›',
  lastExport: 'Dernier export : {quand} · « {fichier} »',
  n: {
    seq: ['{n} séquence', '{n} séquences'], chat: ['{n} discussion', '{n} discussions'], calls: ['{n} appel ou SMS', '{n} appels et SMS'],
    callers: ['{n} appelant', '{n} appelants'], rings: ['{n} sonnerie importée', '{n} sonneries importées'], memories: ['{n} mémoire', '{n} mémoires'],
    media: ['{n} média', '{n} médias'], call: ['{n} appel', '{n} appels'], sms: ['{n} SMS', '{n} SMS'], notif: ['{n} notification', '{n} notifications'],
    color: ['{n} couleur', '{n} couleurs'], fx: ['{n} effet', '{n} effets'],
  },
  short: '{seq} séq. · {chat} disc. · {calls} appels et SMS · {taille}',
  modified: 'Modifié {quand}', imported: 'Importé {quand}', tagOpen: 'ouvert',
  today: 'aujourd\'hui, {h}', yesterday: 'hier, {h}', day: 'le {j} {m}', dayYear: 'le {j} {m} {a}', dayTime: '{jour}, {h}',
  months: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  // 45b
  nameLabel: 'Nom du projet', fileLine: 'Fichier : « {fichier} »', content: 'Contenu',
  always: 'Toujours compris : la séquence en cours et le fil de discussion en cours. Jamais : appairage, écrans, licence.',
  missing: 'Certaines étapes des séquences utiliseront des éléments non exportés ({sections}) : elles arriveront « introuvables ».',
  size: 'Taille estimée', sizeVal: '≈ {taille}', exportBtn: 'Exporter', exporting: 'Export…',
  exportWeb: 'Téléchargement de « {fichier} »', exportApp: 'Partager, enregistrer dans Fichiers…',
  exported: '« {fichier} » exporté.',
  // 45c
  toImport: 'À importer', howTo: 'Comment l\'importer', notIn: 'Non inclus dans ce fichier', exportedOn: 'Exporté {quand}',
  modes: {
    merge: ['Ajouter à mes données', 'À la suite de « {projet} » ; doublons : « (2) ».', 'Importer'],
    replace: ['Remplacer', 'Sections cochées vidées, puis remplies.', 'Remplacer et importer'],
    new: ['Ouvrir comme nouveau projet', '« {projet} » reste tel quel.', 'Ouvrir le projet'],
  },
  newAll: 'Le projet est rangé en entier ; les médias cochés rejoignent le pool, commun à tous les projets.',
  replaceWarn: '⚠ {liste} de « {projet} » seront supprimés. Exportez-le d\'abord pour les garder.',
  replaceRings: 'Les sonneries importées sont remplacées aussi : un appel dont le son disparaît reprend « Classique ».',
  and: ' et ', importing: 'Import…',
  // 45d
  okMerge: '« {nom} » ajouté à « {projet} »', okReplace: '« {projet} » : sections remplacées par « {nom} »', okNew: '« {nom} » ouvert comme nouveau projet',
  okNewStored: '« {nom} » rangé dans vos projets',
  ignored: ['{n} ignoré', '{n} ignorés'], same: '{n} déjà là', full: 'Liste pleine', notImported: ['non importés', 'non importées'], notIncluded: 'non inclus',
  removed: ['{n} supprimé', '{n} supprimés', '{n} supprimée', '{n} supprimées'],
  renamed: ['{n} renommé : {noms}', '{n} renommés : {noms}', '{n} renommée : {noms}', '{n} renommées : {noms}'],
  warn: {
    callers: 'Photo illisible : appelant « {nom} », importé sans photo.', calls: 'Photo ou son illisible : « {nom} », importé sans.',
    chat: 'Photo illisible : discussion « {nom} », importée sans photo.', rings: 'Son illisible : « {nom} », non importé.', media: 'Média illisible : « {nom} », non importé.',
  },
  warnMore: 'Et {n} autres.',
  preview: 'Aperçu sans licence : les données importées sont gardées ; elles apparaîtront avec la licence.',
  seqNote: 'Les étapes des séquences importées pointent vers les appels, discussions et mémoires importés avec elles.',
  notOpened: 'Le projet n\'a pas été ouvert : {raison}',
  seeSeqs: 'Voir les séquences', close: 'Fermer',
  // 45e
  errTitle: {
    'not-zip': 'Fichier non reconnu', 'not-project': 'Fichier non reconnu', 'too-large': 'Fichier trop volumineux', version: 'Version plus récente',
    corrupt: 'Fichier abîmé', invalid: 'Contenu invalide', empty: 'Rien à importer', 'too-many': 'Projet trop gros', 'storage-full': 'Mémoire pleine', other: 'Import impossible',
  },
  errNotProject: '« {fichier} » n\'est pas un projet SetRemote (.rem).',
  errTooLarge: '« {fichier} » dépasse {max} Mo. Exportez-le sans les médias.',
  nothing: 'Rien n\'a été modifié.', partial: 'Les sections déjà écrites le restent.',
  pickOther: 'Choisir un autre fichier',
  // 46
  newProject: '+ Nouveau projet', importProject: 'Importer un projet…',
  listNote: 'Toucher un projet : l\'ouvrir. Écrans appairés, licence et réglages sont communs à tous les projets ; le pool média aussi.',
  more: 'Ouvrir, renommer, dupliquer, exporter, supprimer',
  menu: { open: 'Ouvrir', rename: 'Renommer', duplicate: 'Dupliquer', export: 'Exporter…', remove: 'Supprimer' },
  cancel: 'Annuler', create: 'Créer', save: 'Enregistrer', ok: 'OK', openBtn: 'Ouvrir', opening: 'Ouverture…',
  renameTitle: 'Renommer le projet',
  confirmDelete: 'Supprimer le projet « {nom} » ? Son contenu est effacé de cet appareil.',
  // 46b
  newTitle: 'Nouveau projet',
  newEmpty: ['Vide', 'Aucune séquence, discussion, appel ni mémoire.'],
  newCopy: ['À partir du projet actuel', 'Copie de « {projet} » (sans les médias).'],
  newNote: 'Le nouveau projet s\'ouvre ; « {projet} » est rangé tel quel.',
  // 46c
  openTitle: 'Ouvrir « {nom} » ?',
  openText: '« {projet} » est rangé tel quel : séquences, discussions, appels, sonneries, mémoires, séquence et fil en cours. Les écrans restent appairés.',
  busyTitle: 'Impossible pour l\'instant',
  busy: {
    seq: 'Une séquence est lancée sur les écrans. Arrêtez-la (↺ Recommencer) avant d\'ouvrir un autre projet.',
    chat: 'Une discussion est ouverte sur les écrans. Fermez-la avant d\'ouvrir un autre projet.',
    call: 'Un appel est en cours sur un écran. Raccrochez avant d\'ouvrir un autre projet.',
  },
  errTitleGeneric: 'Opération impossible',
};
const _pjuTpl = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => (v[k] !== undefined ? String(v[k]) : ''));
const _pjuN = (k, n) => _pjuTpl(_PJU_TXT.n[k][n === 1 ? 0 : 1], { n }); // 0 : pluriel (« 0 appels et SMS »)
const _pjuEsc = (s) => escapeHtml(String(s == null ? '' : s));
const _PJU_SECS = ['seq', 'chat', 'calls', 'callers', 'rings', 'memories'];
const _PJU_FEM = { seq: true, chat: true, rings: true, memories: true };
// Sections dont les séquences dépendent (étapes « introuvables » si absentes)
const _PJU_SEQ_DEPS = ['chat', 'calls', 'callers', 'rings', 'memories'];

// ── État ──
// view : 'list' | 'export' | 'import' | 'report' | 'error' ; from : vue d'où l'on vient ('list' ou null = Réglages)
let _pju = { view: null, from: null, list: null, exp: null, imp: null, rep: null, err: null };
// Rendus asynchrones en cours (projectUiIdle : captures et tests)
const _pjuPending = new Set();
function _pjuTrack(p) {
  _pjuPending.add(p);
  const done = () => _pjuPending.delete(p);
  p.then(done, done);
  return p;
}
// Opérations du moteur une à une (il refuse les appels simultanés : 'pending')
let _pjuQ = Promise.resolve();
const _pjuSerial = (fn) => (...a) => { const p = _pjuQ.then(() => fn(...a)); _pjuQ = p.catch(() => null); return p; };
async function projectUiIdle() { while (_pjuPending.size) await Promise.all([..._pjuPending].map((p) => p.catch(() => null))); }

// ── Formats ──
function _pjuSize(b) {
  b = Math.max(0, b || 0);
  if (!b) return '0 Ko';
  if (b < 100 * 1024) return Math.max(1, Math.round(b / 1024)) + ' Ko';
  const mo = b / (1024 * 1024);
  return (mo < 10 ? String(Math.round(mo * 10) / 10).replace('.', ',') : String(Math.round(mo))) + ' Mo';
}
const _pjuHm = (d) => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
function _pjuDay(d, withYear) {
  return _pjuTpl(withYear ? _PJU_TXT.dayYear : _PJU_TXT.day, { j: d.getDate(), m: _PJU_TXT.months[d.getMonth()], a: d.getFullYear() });
}
// « aujourd'hui, 14:02 » · « hier, 23:12 » · « le 12 oct. » (time : « le 12 oct., 23:12 »)
function _pjuWhen(ts, time) {
  const d = new Date(ts), now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= start) return _pjuTpl(_PJU_TXT.today, { h: _pjuHm(d) });
  if (ts >= start - 86400000) return _pjuTpl(_PJU_TXT.yesterday, { h: _pjuHm(d) });
  const day = _pjuDay(d, d.getFullYear() !== now.getFullYear());
  return time ? _pjuTpl(_PJU_TXT.dayTime, { jour: day, h: _pjuHm(d) }) : day;
}
function _pjuList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + _PJU_TXT.and + items[items.length - 1];
}
const _pjuCountsLong = (c) => ['seq', 'chat', 'calls'].map((k) => _pjuN(k, (c && c[k]) || 0)).join(' · ');
const _pjuCountsShort = (c, size) => _pjuTpl(_PJU_TXT.short, { seq: (c && c.seq) || 0, chat: (c && c.chat) || 0, calls: (c && c.calls) || 0, taille: _pjuSize(size) });
function _pjuCallsSub(k) { return k ? ['call', 'sms', 'notif'].map((x) => _pjuN(x, k[x] || 0)).join(' · ') : ''; }
function _pjuMemSub(m) { return m ? _pjuN('color', m.color) + ' · ' + _pjuN('fx', m.fx) : ''; }
// Ce qui se joue sur les écrans (refus d'ouvrir un autre projet) : 'seq' | 'chat' | 'call' | null
function _pjuBusyWhat() {
  try {
    if (typeof _seqRun !== 'undefined' && (_seqRun.state === 'running' || _seqRun.state === 'stopped')) return 'seq';
    if (typeof _chat !== 'undefined' && _chat.open) return 'chat';
    if (scrList().some((id) => scrKnown(id) && scrState(id).call)) return 'call';
  } catch (_) {}
  return projectLiveBusy() ? 'seq' : null;
}
function _pjuActive() { return _pju.list && _pju.list.list.find((m) => m.active) || null; }
const _pjuActiveName = () => { const a = _pjuActive(); return a ? a.name : _PRJ_TXT.firstName; };

// ══════════ 45 · Réglages : carte « Projet » ══════════
function renderSettingsProject() {
  return _pjuTrack(_pjuLoadList().then(() => {
    const a = _pjuActive();
    if (!a) return;
    const set = (id, t) => { setIconText(document.getElementById(id), t); };
    set('stPrjName', a.name);
    set('stPrjSub', _PJU_TXT.open + ' · ' + _pjuCountsLong(a.counts));
    const last = document.getElementById('stPrjLast');
    if (last) {
      const le = a.lastExport;
      last.style.display = le && le.file ? '' : 'none';
      last.textContent = le && le.file ? _pjuTpl(_PJU_TXT.lastExport, { quand: _pjuWhen(le.at, true), fichier: le.file }) : '';
    }
  }));
}
async function _pjuLoadList() {
  const r = await _pjuSerial(projectsList)();
  // Projet ouvert en tête, puis du plus récemment modifié au plus ancien
  if (r.ok) r.list.sort((a, b) => (b.active - a.active) || (b.updated - a.updated) || (b.created - a.created) || a.name.localeCompare(b.name, 'fr'));
  if (r.ok) _pju.list = r;
  return r;
}

// ══════════ Vue plein écran ══════════
function _pjuShow(view, from) {
  if (from !== undefined) _pju.from = from;
  _pju.view = view;
  const v = document.getElementById('project-view');
  document.getElementById('pjTitle').textContent = _PJU_TXT.title[view];
  v.style.display = 'flex';
  _pjuRender();
  v.scrollTop = 0;
}
function closeProjectView() {
  _pju.view = null;
  const v = document.getElementById('project-view');
  if (v) v.style.display = 'none';
  if (document.getElementById('settings-view').style.display !== 'none') renderSettingsProject();
}
// « ← Retour » : vers la liste si l'on en vient, sinon vers les Réglages
function projectViewBack() {
  if (_pju.view !== 'list' && _pju.from === 'list') { openProjectsView(); return; }
  closeProjectView();
}
function _pjuRender() {
  const body = document.getElementById('pjBody');
  if (!body) return;
  const fn = { list: _pjuListHtml, export: _pjuExportHtml, import: _pjuImportHtml, report: _pjuReportHtml, error: _pjuErrorHtml }[_pju.view];
  body.innerHTML = fn ? fn() : '';
}

// ══════════ 46 · Projets ══════════
function openProjectsView() {
  _pjuShow('list', null);
  return _pjuTrack(_pjuLoadList().then(() => { if (_pju.view === 'list') _pjuRender(); }));
}
function _pjuListHtml() {
  const L = _pju.list ? _pju.list.list : [];
  const rows = L.map((m) => {
    const when = m.imported && m.updated === m.created ? _pjuTpl(_PJU_TXT.imported, { quand: _pjuWhen(m.created) }) : _pjuTpl(_PJU_TXT.modified, { quand: _pjuWhen(m.updated) });
    return '<div class="prj-proj' + (m.active ? ' act' : '') + '" data-id="' + m.id + '" onclick="projectRowTap(\'' + m.id + '\')">'
      + '<span class="st-row-main"><span class="prj-pn">' + _pjuEsc(m.name) + (m.active ? '<span class="prj-tag">' + _PJU_TXT.tagOpen + '</span>' : '') + '</span>'
      + '<span class="prj-pm">' + _pjuEsc(when) + '<br>' + _pjuEsc(_pjuCountsShort(m.counts, m.size)) + '</span></span>'
      + '<button type="button" class="prj-more" aria-label="' + _pjuEsc(_PJU_TXT.more) + '" onclick="event.stopPropagation();openProjectMenu(\'' + m.id + '\')">' + icon('ellipsis', 'ic-lg') + '</button></div>';
  }).join('');
  return '<div class="st-card st-rows prj-projs">' + rows + '</div>'
    + '<button type="button" class="prj-sec prj-dash" id="pjNewBtn" onclick="openNewProjectSheet()">' + iconizeText(_PJU_TXT.newProject) + '</button>'
    + '<button type="button" class="prj-sec" onclick="projectImportPick(\'list\')">' + _PJU_TXT.importProject + '</button>'
    + '<p class="st-note">' + _pjuEsc(_PJU_TXT.listNote) + '</p>';
}
const _pjuMeta = (id) => (_pju.list ? _pju.list.list.find((m) => m.id === id) : null);
function projectRowTap(id) {
  const m = _pjuMeta(id);
  if (!m) return;
  if (m.active) openProjectMenu(id); else askOpenProject(id);
}
function openProjectMenu(id) {
  if (!_pjuMeta(id)) return;
  _sheet = { kind: 'prjMenu', id }; renderSheet();
}
// 46c : confirmation, ou refus pendant le jeu
function askOpenProject(id) {
  const busy = _pjuBusyWhat();
  if (busy) { _sheet = { kind: 'prjBusy', what: busy }; renderSheet(); return; }
  _sheet = { kind: 'prjOpen', id }; renderSheet();
}
function openNewProjectSheet() {
  _sheet = { kind: 'prjNew', from: 'empty', name: '' }; renderSheet(true);
}
// Feuilles (39-screens-ui.js, renderSheet) : { title, html, form } ; null : projet disparu
function projectSheetContent(s) {
  const b = (cls, fn, label) => '<button type="button" class="dc-menu-btn' + cls + '" onclick="' + fn + '">' + _pjuEsc(label) + '</button>';
  const cancel = '<button type="button" class="sr-cancel" onclick="closeSheet()">' + _PJU_TXT.cancel + '</button>';
  const note = (t) => '<p class="sr-sheet-note prj-sheet-text">' + _pjuEsc(t) + '</p>';
  const m = s.id ? _pjuMeta(s.id) : null;
  if (s.id && !m) return null;
  const M = _PJU_TXT.menu;
  switch (s.kind) {
    case 'prjMenu':
      return {
        title: '« ' + m.name + ' »', form: false,
        html: (m.active ? '' : b('', 'askOpenProject(\'' + m.id + '\')', M.open)) + b('', 'openRenameProject(\'' + m.id + '\')', M.rename)
          + b('', 'projectMenuDuplicate(\'' + m.id + '\')', M.duplicate) + b('', 'projectMenuExport(\'' + m.id + '\')', M.export)
          + (m.active ? '' : b(' danger', 'projectMenuDelete(\'' + m.id + '\')', M.remove))
          + (s.msg ? '<p class="sr-sheet-note prj-sheet-err" role="alert">' + _pjuEsc(s.msg) + '</p>' : '')
          + '<div class="sr-actions">' + cancel + '</div>',
      };
    case 'prjName':
      return {
        title: _PJU_TXT.renameTitle, form: true,
        html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
          + '<label class="sr-sublabel" for="srName">' + _PJU_TXT.nameLabel + '</label>'
          + '<input type="text" id="srName" class="text-input sr-input" maxlength="60" autocomplete="off" placeholder="' + _pjuEsc(m.name) + '" value="' + _pjuEsc(m.name) + '">'
          + '<div class="sr-actions">' + cancel + '<button type="submit" class="sr-ok">' + _PJU_TXT.save + '</button></div></form>',
      };
    case 'prjNew': {
      const cur = _pjuActiveName();
      const opt = (k, t, sub) => '<button type="button" class="prj-opt' + (s.from === k ? ' on' : '') + '" role="radio" aria-checked="' + (s.from === k) + '" onclick="projectNewFrom(\'' + k + '\')">'
        + '<span class="prj-radio"></span><span><span class="prj-opt-t">' + _pjuEsc(t) + '</span><span class="prj-opt-s">' + _pjuEsc(sub) + '</span></span></button>';
      return {
        title: _PJU_TXT.newTitle, form: true,
        html: '<form class="sr-form" onsubmit="event.preventDefault();sheetSave()">'
          + '<label class="sr-sublabel" for="srName">' + _PJU_TXT.nameLabel + '</label>'
          + '<input type="text" id="srName" class="text-input sr-input" maxlength="60" autocomplete="off" placeholder="' + _pjuEsc(_PRJ_TXT.defaultName) + '" value="' + _pjuEsc(s.name) + '" oninput="_sheet&&(_sheet.name=this.value)">'
          + '<div class="prj-mode prj-mode-sheet" role="radiogroup">' + opt('empty', _PJU_TXT.newEmpty[0], _PJU_TXT.newEmpty[1])
          + opt('current', _PJU_TXT.newCopy[0], _pjuTpl(_PJU_TXT.newCopy[1], { projet: cur })) + '</div>'
          + '<p class="sr-sheet-note">' + _pjuEsc(_pjuTpl(_PJU_TXT.newNote, { projet: cur })) + '</p>'
          + (s.msg ? '<p class="sr-sheet-note prj-sheet-err" role="alert">' + _pjuEsc(s.msg) + '</p>' : '')
          + '<div class="sr-actions">' + cancel + '<button type="submit" class="sr-ok"' + (s.busy ? ' disabled' : '') + '>' + _PJU_TXT.create + '</button></div></form>',
      };
    }
    case 'prjOpen':
      return {
        title: _pjuTpl(_PJU_TXT.openTitle, { nom: m.name }), form: false,
        html: note(_pjuTpl(_PJU_TXT.openText, { projet: _pjuActiveName() }))
          + (s.msg ? '<p class="sr-sheet-note prj-sheet-err" role="alert">' + _pjuEsc(s.msg) + '</p>' : '')
          + '<div class="sr-actions">' + cancel + '<button type="button" class="sr-ok" id="pjOpenOk"' + (s.busy ? ' disabled' : '') + ' onclick="projectOpenConfirm(\'' + m.id + '\')">'
          + (s.busy ? _PJU_TXT.opening : _PJU_TXT.openBtn) + '</button></div>',
      };
    case 'prjBusy':
      return {
        title: _PJU_TXT.busyTitle, form: false,
        html: note(_PJU_TXT.busy[s.what] || _PJU_TXT.busy.seq) + '<div class="sr-actions"><button type="button" class="sr-ok" onclick="closeSheet()">' + _PJU_TXT.ok + '</button></div>',
      };
    case 'prjMsg':
      return {
        title: s.title || _PJU_TXT.errTitleGeneric, form: false,
        html: note(s.text) + '<div class="sr-actions"><button type="button" class="sr-ok" onclick="closeSheet()">' + _PJU_TXT.ok + '</button></div>',
      };
  }
  return null;
}
function _pjuSheetMsg(title, text) { _sheet = { kind: 'prjMsg', title, text }; renderSheet(); }
function projectNewFrom(k) {
  if (!_sheet || _sheet.kind !== 'prjNew') return;
  const inp = document.getElementById('srName');
  if (inp) _sheet.name = inp.value;
  _sheet.from = k === 'current' ? 'current' : 'empty';
  renderSheet();
}
// Formulaires de feuille (sheetSave, 39-screens-ui.js)
function projectSheetSave(s, value) {
  if (s.kind === 'prjName') {
    closeSheet();
    return _pjuTrack(_pjuSerial(projectRename)(s.id, value).then(async (r) => {
      if (!r.ok) { _pjuSheetMsg(null, r.message); return; }
      await _pjuLoadList(); _pjuRefresh();
    }));
  }
  if (s.kind === 'prjNew') return _pjuTrack(_pjuCreate(s, value));
  return null;
}
// 46b : créé puis ouvert (refus pendant le jeu : rien n'est créé)
async function _pjuCreate(s, value) {
  const busy = _pjuBusyWhat();
  if (busy) { _sheet = { kind: 'prjBusy', what: busy }; renderSheet(); return; }
  s.name = value; s.busy = true; s.msg = '';
  renderSheet();
  const c = await _pjuSerial(projectCreate)({ name: value, from: s.from });
  let r = c;
  if (c.ok) r = await _pjuSerial(projectSwitch)(c.id);
  if (_sheet === s) { s.busy = false; if (!r.ok) { s.msg = r.message; renderSheet(); } else closeSheet(); }
  await _pjuLoadList();
  _pjuRefresh();
}
async function projectOpenConfirm(id) {
  const s = _sheet;
  if (!s || s.kind !== 'prjOpen' || s.busy) return;
  const busy = _pjuBusyWhat();
  if (busy) { _sheet = { kind: 'prjBusy', what: busy }; renderSheet(); return; }
  s.busy = true; s.msg = ''; renderSheet();
  await _pjuTrack((async () => {
    const r = await _pjuSerial(projectSwitch)(id);
    if (_sheet === s) {
      s.busy = false;
      if (r.ok) closeSheet();
      else if (r.code === 'busy') { _sheet = { kind: 'prjBusy', what: _pjuBusyWhat() || 'seq' }; renderSheet(); } else { s.msg = r.message; renderSheet(); }
    }
    await _pjuLoadList();
    _pjuRefresh();
  })());
}
function openRenameProject(id) { if (_pjuMeta(id)) { _sheet = { kind: 'prjName', id }; renderSheet(true); } }
function projectMenuDuplicate(id) {
  closeSheet();
  return _pjuTrack(_pjuSerial(projectDuplicate)(id).then(async (r) => {
    if (!r.ok) { _pjuSheetMsg(null, r.message); return; }
    await _pjuLoadList(); _pjuRefresh();
  }));
}
function projectMenuDelete(id) {
  const m = _pjuMeta(id);
  if (!m) return null;
  closeSheet();
  if (!confirm(_pjuTpl(_PJU_TXT.confirmDelete, { nom: m.name }))) return null;
  return _pjuTrack(_pjuSerial(projectDelete)(id).then(async (r) => {
    if (!r.ok) { _pjuSheetMsg(null, r.message); return; }
    await _pjuLoadList(); _pjuRefresh();
  }));
}
// « Exporter… » : projet ouvert → vue d'export ; projet rangé → fichier tel quel
function projectMenuExport(id) {
  const m = _pjuMeta(id);
  if (!m) return null;
  closeSheet();
  if (m.active) return openProjectExport('list');
  return _pjuTrack((async () => {
    const r = await _pjuSerial(projectExportStored)(id);
    if (!r.ok) { _pjuSheetMsg(null, r.message); return; }
    const sv = await projectSave(r.blob, r.name);
    if (!sv.ok) { if (sv.code !== 'cancelled') _pjuSheetMsg(null, sv.message); return; }
    await _pjuSerial(projectNoteExport)(id, projectFileName(r.name));
    await _pjuLoadList(); _pjuRefresh();
  })());
}
// Redessine ce qui est affiché (vue, carte des Réglages)
function _pjuRefresh() {
  if (_pju.view === 'list') _pjuRender();
  if (document.getElementById('settings-view').style.display !== 'none') renderSettingsProject();
}

// ══════════ 45b · Exporter le projet ══════════
function openProjectExport(from) {
  _pju.exp = { name: _pjuActiveName(), sel: { seq: true, chat: true, calls: true, callers: true, rings: true, memories: true }, media: false, sum: null, busy: false, msg: '', ok: '' };
  _pjuShow('export', from === 'list' ? 'list' : null);
  return _pjuTrack((async () => {
    if (!_pju.list) await _pjuLoadList();
    const e = _pju.exp;
    e.name = _pjuActiveName();
    e.sum = await projectSummary();
    if (_pju.view === 'export' && _pju.exp === e) _pjuRender();
  })());
}
// Sections non exportées dont dépendent les séquences (non vides)
function _pjuMissingDeps(sel, counts) {
  if (!sel.seq || !counts || !counts.seq) return [];
  return _PJU_SEQ_DEPS.filter((k) => !sel[k] && counts[k] > 0);
}
function _pjuExportHtml() {
  const e = _pju.exp, S = e.sum, c = S ? S.counts : null;
  const sub = (k) => (k === 'calls' ? (S && c.calls ? _pjuCallsSub(S.calls) : _PJU_TXT.expSub.calls) : k === 'memories' ? (S ? _pjuMemSub(S.memories) : '') : _PJU_TXT.expSub[k]);
  const rows = _PJU_SECS.map((k) => '<button type="button" class="st-row prj-srow" role="checkbox" aria-checked="' + e.sel[k] + '" id="pjExp-' + k + '" onclick="projectExportToggle(\'' + k + '\')">'
    + '<span class="prj-chk' + (e.sel[k] ? ' on' : '') + '"></span><span class="st-row-main"><span class="st-row-label">' + _PJU_TXT.sec[k] + '</span>'
    + (sub(k) ? '<span class="st-row-sub">' + _pjuEsc(sub(k)) + '</span>' : '') + '</span><span class="prj-cnt">' + (c ? c[k] : '·') + '</span></button>').join('');
  const media = '<button type="button" class="st-row prj-srow prj-last" role="switch" aria-checked="' + e.media + '" id="pjExp-media" onclick="projectExportToggle(\'media\')">'
    + '<span class="prj-tog' + (e.media ? ' on' : '') + '"></span><span class="st-row-main"><span class="st-row-label">' + _PJU_TXT.sec.media + '</span><span class="st-row-sub">' + _PJU_TXT.expSub.media + '</span></span>'
    + '<span class="prj-cnt">' + (S ? S.media.count + ' <small>· ' + _pjuSize(S.media.bytes) + '</small>' : '·') + '</span></button>';
  const miss = _pjuMissingDeps(e.sel, c);
  let size = 0;
  if (S) { for (const k of _PJU_SECS) if (e.sel[k]) size += S.bytesBy[k] || 0; if (e.media) size += S.media.bytes; }
  const file = projectFileName(e.name || _pjuActiveName());
  return '<div class="st-card"><label class="st-label" for="pjExpName">' + _PJU_TXT.nameLabel + '</label>'
    + '<input type="text" class="prj-input" id="pjExpName" maxlength="60" autocomplete="off" value="' + _pjuEsc(e.name) + '" oninput="projectExportName(this.value)">'
    + '<p class="prj-sub" id="pjExpFile">' + _pjuEsc(_pjuTpl(_PJU_TXT.fileLine, { fichier: file })) + '</p></div>'
    + '<div class="st-card st-rows"><span class="st-label prj-label">' + _PJU_TXT.content + '</span>' + rows + media + '</div>'
    + (miss.length ? '<div class="prj-warn" id="pjExpWarn" role="alert">' + _pjuEsc(_pjuTpl(_PJU_TXT.missing, { sections: _pjuList(miss.map((k) => '« ' + _PJU_TXT.sec[k] + ' »')) })) + '</div>' : '')
    + '<p class="st-note">' + _pjuEsc(_PJU_TXT.always) + '</p>'
    + '<div class="prj-size"><span>' + _PJU_TXT.size + '</span><b id="pjExpSize">' + (S ? _pjuTpl(_PJU_TXT.sizeVal, { taille: _pjuSize(size) }) : '…') + '</b></div>'
    + (e.msg ? '<div class="prj-warn" role="alert">' + _pjuEsc(e.msg) + '</div>' : '')
    + (e.ok ? '<div class="prj-done" role="status">' + _pjuEsc(e.ok) + '</div>' : '')
    + '<button type="button" class="prj-primary" id="pjExpGo"' + (e.busy || !S ? ' disabled' : '') + ' onclick="projectExportGo()">' + (e.busy ? _PJU_TXT.exporting : _PJU_TXT.exportBtn)
    + '<small id="pjExpHint">' + _pjuEsc(IN_NATIVE_APP ? _PJU_TXT.exportApp : _pjuTpl(_PJU_TXT.exportWeb, { fichier: file })) + '</small></button>';
}
function projectExportToggle(k) {
  const e = _pju.exp;
  if (!e || e.busy) return;
  if (k === 'media') e.media = !e.media; else if (k in e.sel) e.sel[k] = !e.sel[k];
  e.ok = ''; e.msg = '';
  const top = document.getElementById('project-view').scrollTop;
  _pjuRender();
  document.getElementById('project-view').scrollTop = top;
}
function projectExportName(v) {
  const e = _pju.exp;
  if (!e) return;
  e.name = v;
  const file = projectFileName(v.trim() || _pjuActiveName());
  const f = document.getElementById('pjExpFile');
  if (f) f.textContent = _pjuTpl(_PJU_TXT.fileLine, { fichier: file });
  const h = document.getElementById('pjExpHint');
  if (h && !IN_NATIVE_APP) h.textContent = _pjuTpl(_PJU_TXT.exportWeb, { fichier: file });
}
// EXPORTER : nom changé → projet ouvert renommé ; fichier écrit puis téléchargé / partagé
function projectExportGo() {
  const e = _pju.exp;
  if (!e || e.busy || !e.sum) return null;
  e.busy = true; e.msg = ''; e.ok = '';
  _pjuRender();
  return _pjuTrack((async () => {
    const a = _pjuActive();
    let name = _prjName(e.name) || (a ? a.name : _PRJ_TXT.defaultName);
    if (a && name !== a.name) {
      const r = await _pjuSerial(projectRename)(a.id, name);
      if (r.ok) name = r.name;
    }
    const sections = _PJU_SECS.filter((k) => e.sel[k]).concat(e.media ? ['media'] : []);
    let blob = null;
    try { blob = await projectExport({ name, sections, includeMedia: e.media }); } catch (x) { e.msg = _prjFail(x).message; }
    if (blob) {
      const sv = await projectSave(blob, name);
      if (sv.ok) {
        const file = projectFileName(name);
        await _pjuSerial(projectNoteExport)(a ? a.id : null, file);
        e.ok = _pjuTpl(_PJU_TXT.exported, { fichier: file });
      } else if (sv.code !== 'cancelled') e.msg = sv.message;
    }
    e.busy = false; e.name = name;
    await _pjuLoadList();
    if (_pju.exp === e && _pju.view === 'export') _pjuRender();
  })());
}

// ══════════ 45c · Importer : choisir, aperçu ══════════
// Choisir un fichier (web : <input type=file> ; app : sélecteur natif), puis aperçu ou erreur
function projectImportPick(from) {
  const src = from === 'list' ? 'list' : null;
  return _pjuTrack((async () => {
    let f = null;
    try { f = await projectPick(); } catch (x) { _pjuError(null, _prjFail(x), src); return; }
    if (f) await projectImportFile(f, src);
  })());
}
async function projectImportFile(file, from) {
  const info = await projectInspect(file);
  if (!info.ok) { _pjuError(file, info, from); return; }
  if (!_pju.list) await _pjuLoadList();
  const cur = await projectSummary();
  const sel = {};
  for (const k of _PJU_SECS.concat(['media'])) sel[k] = info.sections.includes(k);
  _pju.imp = { file, info, sel, mode: 'merge', cur, busy: false };
  _pjuShow('import', from === 'list' ? 'list' : null);
}
function _pjuImportHtml() {
  const I = _pju.imp, info = I.info, mode = I.mode;
  const T = _PJU_TXT, cur = _pjuActiveName();
  const meta = _pjuEsc(I.file.name || '') + ' · ' + _pjuSize(info.size)
    + (info.created ? '<br>' + _pjuEsc(_pjuTpl(T.exportedOn, { quand: _pjuDay(new Date(info.created), true) + ', ' + _pjuHm(new Date(info.created)) })) + (info.app ? ' · SetRemote ' + _pjuEsc(info.app) : '') : '');
  const row = (k, last) => {
    const has = info.sections.includes(k);
    const lock = !has || (mode === 'new' && k !== 'media');
    const on = has && (mode === 'new' ? true : I.sel[k]);
    const sub = !has ? T.notIn : k === 'calls' ? _pjuCallsSub(info.calls) : k === 'memories' ? _pjuMemSub(info.memories) : k === 'media' ? _pjuSize(info.mediaBytes) : '';
    const n = !has ? '—' : (info.counts[k] || 0);
    return '<button type="button" class="st-row prj-srow' + (last ? ' prj-last' : '') + (has ? '' : ' prj-absent') + '" role="checkbox" aria-checked="' + on + '" id="pjImp-' + k + '"'
      + (lock ? ' aria-disabled="true"' : '') + ' onclick="projectImportToggle(\'' + k + '\')">'
      + '<span class="prj-chk' + (on ? ' on' : '') + (lock ? ' lock' : '') + '"></span><span class="st-row-main"><span class="st-row-label">' + T.sec[k] + '</span>'
      + (sub ? '<span class="st-row-sub">' + _pjuEsc(sub) + '</span>' : '') + '</span><span class="prj-cnt">' + n + '</span></button>';
  };
  const opt = (k) => '<button type="button" class="prj-opt' + (mode === k ? ' on' : '') + '" role="radio" aria-checked="' + (mode === k) + '" id="pjMode-' + k + '" onclick="projectImportMode(\'' + k + '\')">'
    + '<span class="prj-radio"></span><span><span class="prj-opt-t">' + T.modes[k][0] + '</span><span class="prj-opt-s">' + _pjuEsc(_pjuTpl(T.modes[k][1], { projet: cur })) + '</span></span></button>';
  const want = _pjuImpWant();
  let warn = '';
  if (mode === 'replace') {
    const lost = want.filter((k) => I.cur.counts[k] > 0).map((k) => _pjuN(k, I.cur.counts[k]));
    const parts = [];
    if (lost.length) parts.push(iconizeText(_pjuTpl(T.replaceWarn, { liste: _pjuList(lost), projet: cur })));
    if (want.includes('rings') && (I.cur.counts.rings > 0 || info.counts.rings > 0)) parts.push(_pjuEsc(T.replaceRings));
    if (parts.length) warn = '<div class="prj-warn" id="pjImpWarn" role="alert">' + parts.join('<br>') + '</div>';
  }
  return '<div class="st-card"><div class="prj-file"><span class="prj-ico">.REM</span><div><div class="prj-name">' + _pjuEsc(info.name) + '</div><p class="prj-sub">' + meta + '</p></div></div></div>'
    + '<div class="st-card st-rows prj-compact' + (mode === 'new' ? ' pj-whole' : '') + '"><span class="st-label prj-label">' + T.toImport + '</span>'
    + _PJU_SECS.map((k) => row(k, false)).join('') + row('media', true) + '</div>'
    + '<div class="st-card"><span class="st-label">' + T.howTo + '</span><div class="prj-mode" role="radiogroup">' + opt('merge') + opt('replace') + opt('new') + '</div>'
    + (mode === 'new' ? '<p class="prj-sub">' + _pjuEsc(T.newAll) + '</p>' : '') + '</div>'
    + warn
    + '<button type="button" class="prj-primary" id="pjImpGo"' + (I.busy || (mode !== 'new' && !want.length) ? ' disabled' : '') + ' onclick="projectImportGo()">' + (I.busy ? T.importing : T.modes[mode][2]) + '</button>';
}
// Sections cochées présentes dans le fichier (mode « new » : médias seulement comptent)
function _pjuImpWant() {
  const I = _pju.imp;
  return _PJU_SECS.concat(['media']).filter((k) => I.info.sections.includes(k) && I.sel[k]);
}
function projectImportToggle(k) {
  const I = _pju.imp;
  if (!I || I.busy || !I.info.sections.includes(k) || (I.mode === 'new' && k !== 'media')) return;
  I.sel[k] = !I.sel[k];
  const top = document.getElementById('project-view').scrollTop;
  _pjuRender();
  document.getElementById('project-view').scrollTop = top;
}
function projectImportMode(m) {
  const I = _pju.imp;
  if (!I || I.busy || !_PJU_TXT.modes[m]) return;
  I.mode = m;
  const top = document.getElementById('project-view').scrollTop;
  _pjuRender();
  document.getElementById('project-view').scrollTop = top;
}
function projectImportGo() {
  const I = _pju.imp;
  if (!I || I.busy) return null;
  const want = _pjuImpWant();
  if (I.mode !== 'new' && !want.length) return null;
  if (I.mode === 'new') {
    const busy = _pjuBusyWhat();
    if (busy) { _sheet = { kind: 'prjBusy', what: busy }; renderSheet(); return null; }
  }
  I.busy = true;
  _pjuRender();
  return _pjuTrack((async () => {
    const cur = _pjuActiveName();
    let r;
    if (I.mode === 'new') {
      r = await _pjuSerial(projectImportAsNew)(I.file);
      if (r.ok) {
        const sw = await _pjuSerial(projectSwitch)(r.id);
        r.opened = sw.ok;
        if (!sw.ok) r.why = sw.message;
        else if (want.includes('media')) { const m = await _pjuSerial(projectImport)(I.file, { mode: 'merge', sections: ['media'] }); if (m.ok) r.media = m.sections.media; }
      }
    } else r = await _pjuSerial(projectImport)(I.file, { mode: I.mode, sections: want });
    I.busy = false;
    await _pjuLoadList();
    if (!r.ok) { _pjuError(I.file, r, _pju.from); return; }
    _pju.rep = { r, mode: I.mode, info: I.info, want, cur };
    _pjuShow('report');
  })());
}

// ══════════ 45d · Compte rendu ══════════
function _pjuReportHtml() {
  const { r, mode, info, want, cur } = _pju.rep, T = _PJU_TXT;
  const head = mode === 'new' ? (r.opened ? T.okNew : T.okNewStored) : mode === 'replace' ? T.okReplace : T.okMerge;
  const line = (k, val, sub, last) => '<div class="st-row' + (last ? ' prj-last' : '') + '" id="pjRep-' + k + '"><span class="st-row-main"><span class="st-row-label">' + T.sec[k] + '</span>'
    + (sub ? '<span class="st-row-sub">' + _pjuEsc(sub) + '</span>' : '') + '</span><span class="prj-cnt">' + val + '</span></div>';
  const fem = (k) => !!_PJU_FEM[k];
  const rows = _PJU_SECS.concat(['media']).map((k, i, a) => {
    const last = i === a.length - 1;
    if (!info.sections.includes(k)) return line(k, '<span class="prj-dim">' + T.notIncluded + '</span>', '', last);
    let x = null;
    if (mode === 'new') x = k === 'media' ? r.media || null : { added: (r.counts && r.counts[k]) || 0, removed: 0, skipped: 0, renamed: 0, same: 0, names: [] };
    else x = r.sections[k] || null;
    if (!x || (mode !== 'new' && !want.includes(k))) return line(k, '<span class="prj-dim">' + T.notImported[fem(k) ? 1 : 0] + '</span>', '', last);
    let val = '<span class="prj-plus">+' + x.added + '</span>';
    if (x.skipped) val += ' · <span class="prj-skip">' + _pjuTpl(T.ignored[x.skipped > 1 ? 1 : 0], { n: x.skipped }) + '</span>';
    if (x.same) val += ' · <span class="prj-dim">' + _pjuTpl(T.same, { n: x.same }) + '</span>';
    const subs = [];
    if (x.removed) subs.push(_pjuTpl(T.removed[(fem(k) ? 2 : 0) + (x.removed > 1 ? 1 : 0)], { n: x.removed }));
    if (x.renamed) subs.push(_pjuTpl(T.renamed[(fem(k) ? 2 : 0) + (x.renamed > 1 ? 1 : 0)], { n: x.renamed, noms: (x.names || []).map((n) => '« ' + n + ' »').join(', ') }));
    if (x.skipped && !(r.warnings || []).some((w) => w.section === k)) subs.push(T.full);
    return line(k, val, subs.join(' · '), last);
  }).join('');
  const W = (r.warnings || []).filter((w) => T.warn[w.section]);
  const warns = W.slice(0, 3).map((w) => _pjuEsc(_pjuTpl(T.warn[w.section], { nom: w.name }))).concat(W.length > 3 ? [_pjuEsc(_pjuTpl(T.warnMore, { n: W.length - 3 }))] : []);
  const seqIn = mode === 'new' ? (r.counts && r.counts.seq) : (r.sections && r.sections.seq && r.sections.seq.added);
  return '<div class="st-card"><div class="prj-ok"><i>' + icon('check', 'ic-sm') + '</i><span id="pjRepHead">' + _pjuEsc(_pjuTpl(head, { nom: info.name, projet: cur })) + '</span></div></div>'
    + '<div class="st-card st-rows">' + rows + '</div>'
    + (mode === 'new' && !r.opened && r.why ? '<div class="prj-warn" role="alert">' + _pjuEsc(_pjuTpl(T.notOpened, { raison: r.why })) + '</div>' : '')
    + (warns.length ? '<div class="prj-warn prj-warn-soft" role="status">' + warns.join('<br>') + '</div>' : '')
    + (r.preview && r.preview.length ? '<p class="st-note">' + _pjuEsc(T.preview) + '</p>' : '')
    + (seqIn ? '<p class="st-note">' + _pjuEsc(T.seqNote) + '</p>' : '')
    + (seqIn ? '<button type="button" class="prj-primary" onclick="projectSeeSequences()">' + T.seeSeqs + '</button>' : '')
    + '<button type="button" class="st-btn" onclick="projectViewBack()">' + T.close + '</button>';
}
function projectSeeSequences() {
  closeProjectView();
  closeSettings();
  switchTab('seq');
  setSeqView('saved');
  const rm = document.getElementById('remote-mode'), el = document.getElementById('seqTab-cur');
  if (rm && el) rm.scrollTop += el.getBoundingClientRect().top - 120;
}

// ══════════ 45e · Erreurs ══════════
function _pjuError(file, r, from) {
  _pju.err = { name: file && file.name ? String(file.name) : '', code: r.code, message: r.message };
  _pjuShow('error', from === 'list' ? 'list' : null);
}
function _pjuErrorHtml() {
  const E = _pju.err, T = _PJU_TXT;
  const title = T.errTitle[E.code] || T.errTitle.other;
  let text = E.message;
  if ((E.code === 'not-zip' || E.code === 'not-project') && E.name) text = _pjuTpl(T.errNotProject, { fichier: E.name });
  else if (E.code === 'too-large' && E.name) text = _pjuTpl(T.errTooLarge, { fichier: E.name, max: Math.round((IN_NATIVE_APP ? PRJ_LIMITS.native : PRJ_LIMITS.file) / (1024 * 1024)) });
  return '<div class="st-card"><div class="prj-ok prj-err"><i>!</i><span id="pjErrTitle">' + _pjuEsc(title) + '</span></div>'
    + '<p class="prj-sub prj-err-text" id="pjErrText">' + _pjuEsc(text) + '</p></div>'
    + '<p class="st-note">' + _pjuEsc(E.code === 'storage-full' ? T.partial : T.nothing) + '</p>'
    + '<button type="button" class="prj-primary" onclick="projectImportPick(_pju.from)">' + T.pickOther + '</button>'
    + '<button type="button" class="st-btn" onclick="projectViewBack()">' + T.close + '</button>';
}
