// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ SPLASH — métiers qui défilent ══════════════════════════
(function () {
  const roles = ['les accessoiristes', 'les électros', 'les pupitreurs', 'la mise en scène', 'les DOP'];
  const el = document.getElementById('rotatingRole');
  if (!el) return;
  let i = 0;
  setInterval(() => {
    el.classList.add('swap');                 // fondu sortant + glissement
    setTimeout(() => {
      i = (i + 1) % roles.length;
      el.textContent = roles[i];
      el.classList.remove('swap');            // fondu entrant
    }, 420);                                  // = durée de la transition CSS
  }, 2400);
})();

