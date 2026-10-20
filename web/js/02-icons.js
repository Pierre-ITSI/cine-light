// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ════════════════════════════════════════════════════════════════════════════
// Icônes de l'interface (télécommande et écrans de mise en service)
//
// Sprite Lucide (ISC) inséré en ligne dans index.html par web/build.mjs
// (vendor/icons/lucide-sprite.svg, un <symbol id="i-nom"> par icône). Trait de
// 2 px, couleur du texte (currentColor), tailles 16 / 20 / 24 (02-base.css).
// Le contenu des scènes (faux téléphone de l'écran de jeu) garde ses emoji :
// ce fichier ne sert qu'à l'interface de pilotage.
// ════════════════════════════════════════════════════════════════════════════

// <svg> d'une icône du sprite (décoratif : le nom accessible vient du texte voisin)
function icon(name, cls) {
  return '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
}
// Icône + libellé (le libellé est échappé) : <span class="ic-wrap">…</span>
function iconLabel(name, text) {
  return '<span class="ic-wrap">' + icon(name) + (text ? '<span class="ic-txt">' + escapeHtml(text) + '</span>' : '') + '</span>';
}
// Remplace le contenu d'un bouton par icône + libellé (état dynamique : « Torche ON »…)
function setIconLabel(el, name, text) {
  if (el) el.innerHTML = iconLabel(name, text);
}

// Icônes citées par un nom passé en paramètre (boutons ↑ ↓, menus ⋯ des listes et de l'éditeur, barre Tel) :
// listées ici pour que le sprite les embarque (scripts/build-icons.mjs lit cette table)
const _ICON_MORE = { up: 'arrow-up', down: 'arrow-down', del: 'trash-2', dup: 'copy', save: 'bookmark', edit: 'pencil', hang: 'phone-off', order: 'list-ordered', load: 'download', quit: 'power', again: 'rotate-ccw', ok: 'check' };

// Glyphe ou emoji en tête d'un message → icône. Les textes de statut gardent
// leur glyphe d'origine dans le code (⚠ ⏳ 🎬…) : il est converti à l'affichage.
const _ICON_LEAD = {
  '⚠': 'triangle-alert', '⏳': 'hourglass', '🎬': 'video', '🖼': 'image', '📤': 'send', '📥': 'download',
  '🌐': 'globe', '✓': 'check', '✅': 'circle-check', '📞': 'phone', '🔔': 'bell', '💬': 'message-circle',
  '⏹': 'square', '▶': 'play', '⏸': 'pause', '🔦': 'flashlight', '💡': 'lightbulb', '📳': 'vibrate', '♪': 'music',
  '🔁': 'repeat', '⏯': 'step-forward', '↻': 'refresh-cw', '⟳': 'refresh-cw', '↺': 'rotate-ccw', '↶': 'undo-2',
  '☆': 'star', '🎲': 'dice-5', '⚡': 'zap', '✨': 'sparkles', '＋': 'plus', '+': 'plus', '←': 'chevron-left',
  '↗': 'arrow-up-right',
};
// Pastilles d'état (🟢 en ligne, 🔴 refusé) : disque coloré, pas d'emoji
const _DOT_LEAD = { '🟢': 'ok', '🔴': 'ko' };
const _ICON_LEAD_RE = new RegExp('^\\s*(' + Object.keys(_ICON_LEAD).concat(Object.keys(_DOT_LEAD))
  .map((k) => k.replace(/[+]/g, '\\$&')).join('|') + ')\\uFE0F?\\s+');
// Texte → HTML : glyphe de tête → icône, « › » final → chevron (le reste est échappé)
function iconizeText(text) {
  let t = String(text == null ? '' : text), lead = '', trail = '';
  const m = _ICON_LEAD_RE.exec(t);
  if (m) {
    lead = _DOT_LEAD[m[1]] ? '<span class="st-dot ' + _DOT_LEAD[m[1]] + '" aria-hidden="true"></span>' : icon(_ICON_LEAD[m[1]]);
    t = t.slice(m[0].length);
  }
  if (/\s*›\s*$/.test(t)) { trail = icon('chevron-right', 'ic-trail'); t = t.replace(/\s*›\s*$/, ''); }
  if (!lead && !trail) return escapeHtml(t);
  return '<span class="ic-wrap">' + lead + (t ? '<span class="ic-txt">' + escapeHtml(t) + '</span>' : '') + trail + '</span>';
}
// Affiche un message d'état (textContent proscrit : le glyphe devient une icône)
function setIconText(el, text) {
  if (el) el.innerHTML = iconizeText(text);
}
