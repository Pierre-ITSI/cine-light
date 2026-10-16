// ── Initialisation du laboratoire d'effets ──
buildEffectCards();
loadFxMemories();
renderFxMemories();

// ── Onglet Appel : état initial des options, appels et SMS enregistrés ──
_syncCallPhotoRow();
loadCallList();
renderCallList();

// ── Mini-carte sticky : apparaît dès que la preview commence à être masquée ──
(function initStickyPreview() {
  const row = document.getElementById('previewRow');
  const bar = document.getElementById('stickyPreview');
  const scroller = document.getElementById('remote-mode');
  if (!row || !bar || !scroller) return;
  function update() {
    // Dès que le haut de la preview passe sous le bord supérieur de l'écran
    // (début de coupure), la carte s'affiche.
    bar.classList.toggle('visible', row.getBoundingClientRect().top < 8);
  }
  scroller.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// Initialiser tous les sliders avec boutons +/- et valeurs cliquables
document.querySelectorAll('input[type="range"]').forEach(slider => {
  if (slider.parentElement.classList.contains('slider-row')) return; // déjà transformé
  const parent = slider.parentElement;
  // Bornes lues à chaque usage : certains sliders changent de plage en cours
  // de route (ex. vitesse d'effet : 0,2–10 puis 20–240 BPM pour Pulse).
  const rng = () => ({
    step: parseFloat(slider.step) || 1,
    min: isNaN(parseFloat(slider.min)) ? 0 : parseFloat(slider.min),
    max: isNaN(parseFloat(slider.max)) ? 100 : parseFloat(slider.max),
  });
  // input + change : comme un vrai geste (la timeline vidéo écoute « change »)
  const nudge = (dir) => {
    const r = rng();
    const v = parseFloat(slider.value) + dir * r.step;
    slider.value = Math.min(r.max, Math.max(r.min, v));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // Wrapper avec boutons +/-
  const wrapper = document.createElement('div');
  wrapper.className = 'slider-row';

  // Bouton -
  const btnMinus = document.createElement('button');
  btnMinus.className = 'slider-btn';
  btnMinus.textContent = '−';
  btnMinus.type = 'button';
  btnMinus.onclick = (e) => { e.preventDefault(); nudge(-1); };

  // Slider
  slider.classList.add('slider-input');

  // Bouton +
  const btnPlus = document.createElement('button');
  btnPlus.className = 'slider-btn';
  btnPlus.textContent = '+';
  btnPlus.type = 'button';
  btnPlus.onclick = (e) => { e.preventDefault(); nudge(1); };

  // Insérer le wrapper à la place du slider AVANT d'y déplacer le slider
  // (sinon insertBefore échoue : le slider n'est plus un enfant du parent)
  parent.insertBefore(wrapper, slider);
  wrapper.appendChild(btnMinus);
  wrapper.appendChild(slider);
  wrapper.appendChild(btnPlus);

  // Rendre la valeur cliquable pour entrée numérique
  const valLabel = parent.querySelector('[id*="Val"]');
  if (valLabel && !valLabel.classList.contains('slider-val-click')) {
    valLabel.classList.add('slider-val-click');
    valLabel.onclick = (e) => {
      e.stopPropagation();
      if (valLabel._editing) return; // un seul champ de saisie à la fois
      valLabel._editing = true;
      const { min, max, step } = rng();
      const input = document.createElement('input');
      input.type = 'number';
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = slider.value;
      input.style = 'width:80px;padding:4px;background:var(--mid);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:inherit';
      let done = false;
      const commit = () => {
        if (done) return; // évite le double appel Enter + blur
        done = true;
        const v = parseFloat(input.value);
        if (!isNaN(v)) {
          slider.value = Math.min(max, Math.max(min, v));
          slider.dispatchEvent(new Event('input', { bubbles: true }));
          slider.dispatchEvent(new Event('change', { bubbles: true }));
        }
        input.remove();              // supprime le champ du DOM
        valLabel.style.display = '';
        valLabel._editing = false;
      };
      input.onblur = commit;
      input.onkeydown = (ev) => {
        if (ev.key === 'Enter') input.blur();
      };
      valLabel.style.display = 'none';
      valLabel.parentElement.insertBefore(input, valLabel);
      input.focus();
      input.select();
    };
  }
});
