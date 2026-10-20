// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ BANDEAU « ANNULER » (télécommande) ══════════════════════════
// Remplace les confirm() du navigateur pour les suppressions (appel, SMS ou
// notification enregistré, discussion ou séquence enregistrée, étape) : l'élément
// disparaît aussitôt et un bandeau « supprimé · Annuler » reste 6 s au-dessus de la
// barre d'action (#undo-snack, rôle status). « Annuler » remet l'élément à son rang
// exact (donc, pour un appel ou un SMS, à sa plage DMX) ; passé le délai, ou à la
// prochaine suppression, la suppression devient définitive (commit : effacement des
// photos et bandes son rangées à part). Un seul bandeau à la fois.
//   undoSnack({ text, sub, undo, commit })
const UNDO_SNACK_MS = 6000;
let _us = null; // { undo, commit, timer }
function undoSnack(o) {
  _usFlush(); // la suppression précédente devient définitive
  const box = document.getElementById('undo-snack');
  _us = { undo: o.undo, commit: o.commit, timer: setTimeout(_usFlush, UNDO_SNACK_MS) };
  if (!box) return;
  document.getElementById('usText').textContent = o.text || '';
  const sub = document.getElementById('usSub');
  sub.textContent = o.sub || '';
  sub.style.display = o.sub ? '' : 'none';
  box.style.display = '';
  const bar = document.getElementById('usBar');
  bar.classList.remove('run');
  void bar.offsetWidth; // relance l'animation de la barre de temps
  bar.classList.add('run');
}
function _usHide() { const box = document.getElementById('undo-snack'); if (box) box.style.display = 'none'; }
// Annuler : l'élément revient (la suppression n'est jamais devenue définitive)
function undoSnackUndo() {
  const u = _us;
  if (!u) return;
  clearTimeout(u.timer);
  _us = null;
  _usHide();
  if (u.undo) u.undo();
}
// Délai écoulé ou nouvelle suppression : définitive
function _usFlush() {
  const u = _us;
  if (!u) return;
  clearTimeout(u.timer);
  _us = null;
  _usHide();
  if (u.commit) { try { u.commit(); } catch (_) {} }
}
function undoSnackActive() { return !!_us; }
