// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ EFFECTS TAB — TÉLÉCOMMANDE ══════════════════════════
let activeScreenEffect = null, effectSendTimer = null;
let fxDir = 'h'; // direction du chaser

// Laboratoire d'effets : 3 familles, rendu par moteur canvas partagé
const EFFECT_FAMILIES = [
  { key: 'spatial',  grid: 'fxGridSpatial' },
  { key: 'rythm',    grid: 'fxGridRythm' },
  { key: 'ambiance', grid: 'fxGridAmbiance' },
];

const EFFECT_CONFIG = {
  // — Spatiaux —
  chaser:    { name:'Chaser', family:'spatial', speedLabel:'Vitesse', min:0.1, max:6, step:0.1, def:1, intDef:100,
               color1:'#ffffff', color2:'#05050a', c1Label:'Bande', c2Label:'Fond',
               count:{ label:'Nombre de bandes', min:1, max:12, def:1 }, dir:true, mode:true, shape:true,
               width:20, wing:1, rot:0, lead:120, fade:120, fadeLabel:'Traîne arrière', chaosDef:0 },
  noise:     { name:'Noise', family:'spatial', speedLabel:'Vitesse (img/s)', min:1, max:30, step:1, def:12, intDef:100,
               color1:'#ffffff', c1Label:'Teinte',
               count:{ label:'Taille de grain', min:2, max:32, def:8 } },
  aurora:    { name:'Aurora', family:'spatial', speedLabel:'Dérive des nappes', min:0.05, max:2, step:0.05, def:0.3, intDef:100,
               color1:'#20e0a0', color2:'#3040ff', c1Label:'Nappe 1', c2Label:'Nappe 2' },
  water:     { name:'Caustiques', family:'spatial', speedLabel:'Vitesse', min:0.1, max:3, step:0.1, def:0.8, intDef:100,
               color1:'#25c8e8', color2:'#021620', c1Label:'Eau', c2Label:'Fond' },
  // — Rythmiques —
  pulse:     { name:'Pulse BPM', family:'rythm', speedLabel:'BPM', min:20, max:240, step:1, def:60, intDef:100,
               color1:'#ffffff', color2:'#000000', c1Label:'Crête', c2Label:'Creux', tap:true },
  traffic:   { name:'Phares', family:'rythm', speedLabel:'Passages / s', min:0.05, max:2, step:0.05, def:0.3, intDef:100,
               color1:'#ffb054', color2:'#050508', c1Label:'Phares', c2Label:'Nuit' },
  weld:      { name:'Soudure', family:'rythm', speedLabel:'Cadence', min:0.2, max:6, step:0.1, def:1.5, intDef:100,
               color1:'#cfe4ff', color2:'#05060a', c1Label:'Arc', c2Label:'Fond' },
  neon:      { name:'Néon HS', family:'rythm', speedLabel:'Nervosité', min:0.2, max:6, step:0.1, def:1.5, intDef:100,
               color1:'#ff2e88', c1Label:'Néon' },
  police:    { name:'Police', family:'rythm', speedLabel:'Vitesse alternance', min:0.5, max:8, step:0.5, def:3, intDef:100,
               color1:'#ff2020', color2:'#2040ff', c1Label:'Couleur A', c2Label:'Couleur B' },
  lightning: { name:'Éclair', family:'rythm', speedLabel:'Fréquence', min:0.1, max:3, step:0.1, def:0.8, intDef:100,
               color1:'#f4f0ff', color2:'#03030a', c1Label:'Éclair', c2Label:'Ambiance' },
  paparazzi: { name:'Paparazzi', family:'rythm', speedLabel:'Rafales / s', min:0.2, max:4, step:0.1, def:1, intDef:100,
               color1:'#fffce6', color2:'#080808', c1Label:'Flash', c2Label:'Ambiance',
               count:{ label:'Flashes / rafale', min:1, max:10, def:3 } },
  // — Ambiances —
  tv:        { name:'TV', family:'ambiance', speedLabel:'Vitesse (img/s)', min:0.5, max:15, step:0.5, def:4, intDef:100, blocks:true, smooth:30 },
  candle:    { name:'Bougie', family:'ambiance', speedLabel:'Vacillement', min:0.2, max:5, step:0.1, def:1.2, intDef:100,
               color1:'#ff7814', c1Label:'Flamme' },
  fire:      { name:'Feu', family:'ambiance', speedLabel:'Intensité rapide', min:0.5, max:10, step:0.5, def:3, intDef:100,
               color1:'#ff7314', color2:'#3c0a00', c1Label:'Flamme', c2Label:'Braise' },
};

// Construit les cartes d'effets dans leurs grilles de famille
function buildEffectCards() {
  for (const fam of EFFECT_FAMILIES) {
    const grid = document.getElementById(fam.grid);
    if (!grid) continue;
    grid.innerHTML = '';
    for (const [key, cfg] of Object.entries(EFFECT_CONFIG)) {
      if (cfg.family !== fam.key) continue;
      const b = document.createElement('button');
      b.className = 'effect-card';
      b.id = 'efxcard-' + key;
      b.onclick = () => selectEffect(key);
      b.innerHTML = `<span class="effect-card-name">${cfg.name}</span>`;
      grid.appendChild(b);
    }
  }
}

function setFxDir(d, silent) {
  fxDir = d;
  ['h','v','d'].forEach(k => {
    const b = document.getElementById('fxdir-' + k);
    if (b) b.classList.toggle('active', k === d);
  });
  if (!silent) scheduleEffectSend();
}

// Forme du chaser : bande (linéaire), rond ou losange (radial, du centre
// vers les bords ou l'inverse)
let fxShape = 'band', fxRadialDir = 'out';
function setFxShape(s, silent) {
  fxShape = s;
  ['band','circle','diamond'].forEach(k => {
    const b = document.getElementById('fxshape-' + k);
    if (b) b.classList.toggle('active', k === s);
  });
  _syncChaserBlocks();
  if (!silent) scheduleEffectSend();
}
function setFxRadialDir(d, silent) {
  fxRadialDir = d;
  ['out','in'].forEach(k => {
    const b = document.getElementById('fxrdir-' + k);
    if (b) b.classList.toggle('active', k === d);
  });
  if (!silent) scheduleEffectSend();
}
// Affiche les bons blocs selon la forme (direction/wing pour la bande,
// sens radial pour rond et losange)
function _syncChaserBlocks() {
  const cfg = EFFECT_CONFIG[activeScreenEffect] || {};
  if (!cfg.shape) return;
  const radial = fxShape !== 'band';
  document.getElementById('effectDirBlock').style.display = radial ? 'none' : 'block';
  document.getElementById('effectRadialDirBlock').style.display = radial ? 'block' : 'none';
  if (cfg.wing != null) document.getElementById('effectWingBlock').style.display = radial ? 'none' : 'block';
}

// Course du chaser : loop (boucle) ou bounce (aller-retour) + inversion du sens
let fxChaserMode = 'loop', fxInvert = false;
function setFxChaserMode(m, silent) {
  fxChaserMode = m;
  ['loop','bounce'].forEach(k => {
    const b = document.getElementById('fxmode-' + k);
    if (b) b.classList.toggle('active', k === m);
  });
  if (!silent) scheduleEffectSend();
}
function setFxInvert(v, silent) {
  fxInvert = !!v;
  const b = document.getElementById('fxmode-invert');
  if (b) b.classList.toggle('active', fxInvert);
  if (!silent) scheduleEffectSend();
}

// TAP tempo → règle le BPM du pulse sur la moyenne des taps
let _tapTimes = [];
function fxTapTempo() {
  const now = performance.now();
  _tapTimes = _tapTimes.filter(x => now - x < 3000);
  _tapTimes.push(now);
  if (_tapTimes.length < 2) return;
  let sum = 0;
  for (let i = 1; i < _tapTimes.length; i++) sum += _tapTimes[i] - _tapTimes[i - 1];
  const bpm = Math.round(Math.min(240, Math.max(20, 60000 / (sum / (_tapTimes.length - 1)))));
  document.getElementById('effectSpeedSlider').value = bpm;
  document.getElementById('effectSpeedVal').textContent = bpm;
  scheduleEffectSend();
}

// 🎲 tire un réglage complet au hasard pour l'effet courant
function randomizeEffect() {
  if (!activeScreenEffect) return;
  const cfg = EFFECT_CONFIG[activeScreenEffect]; if (!cfg) return;
  const rnd = (min, max) => min + Math.random() * (max - min);
  const sl = document.getElementById('effectSpeedSlider');
  sl.value = Math.round(rnd(+cfg.min, +cfg.max) / cfg.step) * cfg.step;
  document.getElementById('effectIntensitySlider').value = Math.round(rnd(40, 100) / 5) * 5;
  document.getElementById('effectChaosSlider').value = Math.round(rnd(0, 80) / 5) * 5;
  document.getElementById('effectDriftSlider').value = Math.round(rnd(0, 60) / 5) * 5;
  if (cfg.count) {
    const bs = document.getElementById('effectBurstSlider');
    bs.value = Math.round(rnd(cfg.count.min, cfg.count.max));
    document.getElementById('effectBurstVal').textContent = bs.value;
  }
  if (cfg.dir) setFxDir(['h','v','d'][Math.floor(Math.random() * 3)], true);
  if (cfg.shape) { setFxShape(['band','circle','diamond'][Math.floor(Math.random() * 3)], true); setFxRadialDir(Math.random() < 0.5 ? 'out' : 'in', true); }
  if (cfg.mode) { setFxChaserMode(Math.random() < 0.5 ? 'loop' : 'bounce', true); setFxInvert(Math.random() < 0.5, true); }
  if (cfg.smooth != null) document.getElementById('effectSmoothSlider').value = Math.round(rnd(0, 80) / 5) * 5;
  if (cfg.width != null) document.getElementById('effectWidthSlider').value = Math.round(rnd(2, 40));
  if (cfg.wing != null) document.getElementById('effectWingSlider').value = Math.round(rnd(1, 4));
  if (cfg.rot != null) document.getElementById('effectRotSlider').value = Math.round(rnd(0, 359));
  if (cfg.lead != null) document.getElementById('effectLeadSlider').value = Math.round(rnd(0, 400) / 10) * 10;
  if (cfg.color1) {
    const c = hslToRgb(Math.random() * 360, 90, 55 + Math.random() * 15);
    document.getElementById('effectColor1').value = rgbToHex(c.r, c.g, c.b);
  }
  if (cfg.fade != null) document.getElementById('effectFadeSlider').value = Math.round(rnd(0, 600) / 10) * 10;
  onEffectParamChange();
}

// Affiche/masque + initialise un bloc optionnel de réglage d'effet
function _setupEffectOpt(blockId, show) {
  const b = document.getElementById(blockId);
  if (b) b.style.display = show ? 'block' : 'none';
  return !!show;
}

function selectEffect(name, acked) {
  if (activeScreenEffect === name) { stopAllEffects(); return; }
  // Effet à flashs rapides : avertissement photosensibilité d'abord (46-strobe-warning.js)
  if (!acked && needsFlashWarning('effect', name)) { openFlashWarning(() => selectEffect(name, true)); return; }
  activeScreenEffect = name;
  document.querySelectorAll('.effect-card').forEach(b => b.classList.remove('active'));
  const card = document.getElementById('efxcard-' + name);
  if (card) card.classList.add('active');
  const badge = document.getElementById('effectActiveBadge');
  if (badge) badge.style.display = 'flex';
  const cfg = EFFECT_CONFIG[name];
  const badgeText = document.getElementById('effectBadgeText');
  if (badgeText && cfg) badgeText.textContent = cfg.name + ' actif';
  const panel = document.getElementById('effectSettingsPanel');
  if (panel && cfg) {
    panel.style.display = 'block';
    document.getElementById('effectSettingsTitle').textContent = 'Réglages — ' + cfg.name;
    document.getElementById('effectSpeedLabel').textContent = cfg.speedLabel;
    const sl = document.getElementById('effectSpeedSlider');
    sl.min = cfg.min; sl.max = cfg.max; sl.step = cfg.step; sl.value = cfg.def;
    document.getElementById('effectSpeedVal').textContent = cfg.step >= 1 ? String(cfg.def) : (+cfg.def).toFixed(1);
    document.getElementById('effectIntensitySlider').value = cfg.intDef;
    document.getElementById('effectIntensityVal').innerHTML = cfg.intDef + '<span>%</span>';
    // Quantité (bandes / grain / flashes) : le slider s'adapte à l'effet
    const bBlock = document.getElementById('effectBurstBlock');
    if (cfg.count) {
      bBlock.style.display = 'block';
      document.getElementById('effectBurstLabel').textContent = cfg.count.label;
      const bs = document.getElementById('effectBurstSlider');
      bs.min = cfg.count.min; bs.max = cfg.count.max; bs.step = 1; bs.value = cfg.count.def;
      document.getElementById('effectBurstVal').textContent = cfg.count.def;
    } else bBlock.style.display = 'none';
    // Forme + direction + course (chaser) et TAP tempo (pulse)
    document.getElementById('effectShapeBlock').style.display = cfg.shape ? 'block' : 'none';
    document.getElementById('effectDirBlock').style.display = cfg.dir ? 'block' : 'none';
    document.getElementById('effectRadialDirBlock').style.display = 'none';
    if (cfg.dir) setFxDir(fxDir, true);
    if (cfg.shape) { setFxShape(fxShape, true); setFxRadialDir(fxRadialDir, true); }
    document.getElementById('effectChaserModeBlock').style.display = cfg.mode ? 'block' : 'none';
    if (cfg.mode) { setFxChaserMode(fxChaserMode, true); setFxInvert(fxInvert, true); }
    document.getElementById('fxTapBtn').style.display = cfg.tap ? 'inline-block' : 'none';
    // Largeur de bande + Wing (chaser)
    if (_setupEffectOpt('effectWidthBlock', cfg.width != null)) {
      document.getElementById('effectWidthSlider').value = cfg.width;
      document.getElementById('effectWidthVal').innerHTML = cfg.width + '<span>%</span>';
    }
    if (_setupEffectOpt('effectWingBlock', cfg.wing != null)) {
      document.getElementById('effectWingSlider').value = cfg.wing;
      document.getElementById('effectWingVal').textContent = cfg.wing;
    }
    if (_setupEffectOpt('effectRotBlock', cfg.rot != null)) {
      document.getElementById('effectRotSlider').value = cfg.rot;
      document.getElementById('effectRotVal').innerHTML = cfg.rot + '<span>°</span>';
    }
    if (_setupEffectOpt('effectLeadBlock', cfg.lead != null)) {
      document.getElementById('effectLeadSlider').value = cfg.lead;
      document.getElementById('effectLeadVal').innerHTML = cfg.lead + '<span> ms</span>';
    }
    // Couleurs
    if (_setupEffectOpt('effectColor1Block', cfg.color1)) {
      document.getElementById('effectColor1Label').textContent = cfg.c1Label || 'Couleur 1';
      document.getElementById('effectColor1').value = cfg.color1;
    }
    if (_setupEffectOpt('effectColor2Block', cfg.color2)) {
      document.getElementById('effectColor2Label').textContent = cfg.c2Label || 'Couleur 2';
      document.getElementById('effectColor2').value = cfg.color2;
    }
    // Chaos / dérive : valeurs par défaut (personnalisables par effet)
    const chaosDef = cfg.chaosDef != null ? cfg.chaosDef : 30;
    document.getElementById('effectChaosSlider').value = chaosDef;
    document.getElementById('effectChaosVal').innerHTML = chaosDef + '<span>%</span>';
    document.getElementById('effectDriftSlider').value = 0;
    document.getElementById('effectDriftVal').innerHTML = '0<span>%</span>';
    // Lissage (TV)
    if (_setupEffectOpt('effectSmoothBlock', cfg.smooth != null)) {
      document.getElementById('effectSmoothSlider').value = cfg.smooth;
      document.getElementById('effectSmoothVal').innerHTML = cfg.smooth + '<span>%</span>';
    }
    // Traîne / fondu
    if (_setupEffectOpt('effectFadeBlock', cfg.fade != null)) {
      document.getElementById('effectFadeLabel').textContent = cfg.fadeLabel || "Fondu d'extinction";
      document.getElementById('effectFadeSlider').value = cfg.fade;
      document.getElementById('effectFadeVal').innerHTML = cfg.fade + '<span> ms</span>';
    }
    // Blocs couleurs (TV)
    if (_setupEffectOpt('effectTvBlocksPanel', cfg.blocks)) {
      initTvWheel();
      renderTvBlocks();
      loadTvBlockEditor();
    }
  }
  updateStatusRings();
  scheduleEffectSend();
}

function onEffectParamChange() {
  const cfg = EFFECT_CONFIG[activeScreenEffect] || {};
  const speed = parseFloat(document.getElementById('effectSpeedSlider').value);
  document.getElementById('effectSpeedVal').textContent = (cfg.step >= 1) ? String(Math.round(speed)) : speed.toFixed(1);
  const intensity = parseInt(document.getElementById('effectIntensitySlider').value);
  document.getElementById('effectIntensityVal').innerHTML = intensity + '<span>%</span>';
  document.getElementById('effectChaosVal').innerHTML = document.getElementById('effectChaosSlider').value + '<span>%</span>';
  document.getElementById('effectDriftVal').innerHTML = document.getElementById('effectDriftSlider').value + '<span>%</span>';
  document.getElementById('effectWidthVal').innerHTML = document.getElementById('effectWidthSlider').value + '<span>%</span>';
  document.getElementById('effectWingVal').textContent = document.getElementById('effectWingSlider').value;
  document.getElementById('effectRotVal').innerHTML = document.getElementById('effectRotSlider').value + '<span>°</span>';
  document.getElementById('effectLeadVal').innerHTML = document.getElementById('effectLeadSlider').value + '<span> ms</span>';
  document.getElementById('effectSmoothVal').innerHTML = document.getElementById('effectSmoothSlider').value + '<span>%</span>';
  const fadeEl = document.getElementById('effectFadeSlider');
  if (fadeEl) document.getElementById('effectFadeVal').innerHTML = fadeEl.value + '<span> ms</span>';
  scheduleEffectSend();
}

// Rassemble les paramètres de l'effet courant depuis l'interface
function buildEffectParams() {
  const cfg = EFFECT_CONFIG[activeScreenEffect] || {};
  const params = {
    speed: parseFloat(document.getElementById('effectSpeedSlider').value),
    intensity: parseInt(document.getElementById('effectIntensitySlider').value),
    chaos: parseInt(document.getElementById('effectChaosSlider').value),
    drift: parseInt(document.getElementById('effectDriftSlider').value),
  };
  if (cfg.count) params.count = parseInt(document.getElementById('effectBurstSlider').value);
  if (cfg.dir) params.dir = fxDir;
  if (cfg.shape) { params.shape = fxShape; if (fxShape !== 'band') params.dir = fxRadialDir; }
  if (cfg.mode) { params.mode = fxChaserMode; params.invert = fxInvert; }
  if (cfg.width != null) params.width = parseInt(document.getElementById('effectWidthSlider').value);
  if (cfg.wing != null) params.wing = parseInt(document.getElementById('effectWingSlider').value);
  if (cfg.rot != null) params.rot = parseInt(document.getElementById('effectRotSlider').value);
  if (cfg.lead != null) params.lead = parseInt(document.getElementById('effectLeadSlider').value);
  if (cfg.smooth != null) params.smooth = parseInt(document.getElementById('effectSmoothSlider').value);
  if (cfg.color1) params.color1 = document.getElementById('effectColor1').value;
  if (cfg.color2) params.color2 = document.getElementById('effectColor2').value;
  if (cfg.fade != null) params.fade = parseInt(document.getElementById('effectFadeSlider').value);
  if (cfg.blocks) params.blocks = tvBlocks.map(resolveColorSpec);
  return params;
}

function scheduleEffectSend() {
  if (effectSendTimer) clearTimeout(effectSendTimer);
  effectSendTimer = setTimeout(() => {
    if (!activeScreenEffect) return;
    const params = buildEffectParams();
    sendMsg({ type:'effect', name:activeScreenEffect, active:true, params });
    refreshPreviewFx(params); // l'aperçu rejoue l'effet en local
  }, 80);
}

// Recharge des paramètres (mémoire d'effet) dans l'interface
function loadEffectParamsToUI(name, p, dir) {
  const cfg = EFFECT_CONFIG[name] || {};
  if (p.speed != null) document.getElementById('effectSpeedSlider').value = p.speed;
  if (p.intensity != null) document.getElementById('effectIntensitySlider').value = p.intensity;
  if (p.chaos != null) document.getElementById('effectChaosSlider').value = p.chaos;
  if (p.drift != null) document.getElementById('effectDriftSlider').value = p.drift;
  if (cfg.count && p.count != null) {
    document.getElementById('effectBurstSlider').value = p.count;
    document.getElementById('effectBurstVal').textContent = p.count;
  }
  if (cfg.shape && p.shape) {
    setFxShape(p.shape, true);
    if (p.shape !== 'band' && p.dir) setFxRadialDir(p.dir, true);
  }
  if (cfg.dir && (dir || p.dir) && (!p.shape || p.shape === 'band')) setFxDir(dir || p.dir, true);
  if (cfg.mode) { if (p.mode) setFxChaserMode(p.mode, true); setFxInvert(!!p.invert, true); }
  if (cfg.width != null && p.width != null) {
    document.getElementById('effectWidthSlider').value = p.width;
    document.getElementById('effectWidthVal').innerHTML = p.width + '<span>%</span>';
  }
  if (cfg.wing != null && p.wing != null) {
    document.getElementById('effectWingSlider').value = p.wing;
    document.getElementById('effectWingVal').textContent = p.wing;
  }
  if (cfg.rot != null && p.rot != null) {
    document.getElementById('effectRotSlider').value = p.rot;
    document.getElementById('effectRotVal').innerHTML = p.rot + '<span>°</span>';
  }
  if (cfg.lead != null && p.lead != null) {
    document.getElementById('effectLeadSlider').value = p.lead;
    document.getElementById('effectLeadVal').innerHTML = p.lead + '<span> ms</span>';
  }
  if (cfg.smooth != null && p.smooth != null) {
    document.getElementById('effectSmoothSlider').value = p.smooth;
    document.getElementById('effectSmoothVal').innerHTML = p.smooth + '<span>%</span>';
  }
  if (cfg.color1 && p.color1) document.getElementById('effectColor1').value = p.color1;
  if (cfg.color2 && p.color2) document.getElementById('effectColor2').value = p.color2;
  if (cfg.fade != null && p.fade != null) document.getElementById('effectFadeSlider').value = p.fade;
  onEffectParamChange();
}

// ── Aperçu live : le swatch de l'en-tête rejoue en local
// exactement ce que l'écran de jeu affiche (effets, strobe, média) —
// à l'exception de l'état écran ON/OFF.
function _pvApplyBg(r, g, b, transMs) {
  const css = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  for (const id of ['previewSwatch']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.transition = transMs > 0 ? `background-color ${transMs}ms ease` : 'none';
    el.style.backgroundColor = css;
  }
}
let _lastEffectParams = null;
let _pvFxMain = null; // instancié après la définition du moteur

function _pvFxStop() {
  if (_pvFxMain) _pvFxMain.stop();
}

// (Re)démarre la bonne simulation dans l'aperçu selon l'état courant.
function refreshPreviewFx(params) {
  if (params) _lastEffectParams = params;
  if (!_pvFxMain) _pvFxMain = makeFxRenderer('previewFxCanvas');
  if (strobeActive) { _pvFxStop(); return; } // le strobe pilote déjà l'aperçu
  if (activeScreenEffect && _lastEffectParams) {
    if (_pvFxMain.current() === activeScreenEffect) {
      _pvFxMain.update({ ..._lastEffectParams });
    } else {
      _pvFxMain.start(activeScreenEffect, { ..._lastEffectParams });
    }
  } else { _pvFxStop(); _pvRestoreBase(); }
}

// Remet l'aperçu sur la couleur de base (fin d'effet / de strobe)
function _pvRestoreBase() {
  for (const id of ['previewSwatch']) {
    const el = document.getElementById(id);
    if (el) { el.style.transition = ''; el.style.backgroundColor = currentColor; }
  }
}

// ── Anneaux de statut : contour pulsé sur la preview et les onglets ──
// Priorité preview : rouge (écran OFF) > orange (média) > violet (effet).
function updateStatusRings() {
  const fxOn = !!activeScreenEffect;
  const mediaOn = typeof _activeMediaId !== 'undefined' && !!_activeMediaId;
  const offOn = typeof remoteBlackout !== 'undefined' && remoteBlackout;
  const cls = offOn ? 'st-off' : (mediaOn ? 'st-media' : (fxOn ? 'st-effect' : null));
  for (const id of ['previewSwatch']) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.remove('st-off', 'st-media', 'st-effect');
    if (cls) el.classList.add(cls);
  }
  renderNavStatus(); // points sur les onglets, bandeau « Tout arrêter » (31-nav-status.js)
}

// Vignette du média en cours de diffusion, par-dessus la couleur (comme
// sur l'écran de jeu où le média recouvre le fond).
function _pvUpdateMedia() {
  const it = (typeof _mediaPool !== 'undefined' && _activeMediaId)
    ? _mediaPool.find(m => m.id === _activeMediaId) : null;
  for (const id of ['previewSwatch']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (it && it.thumb) {
      el.style.backgroundImage = `url("${it.thumb}")`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    } else {
      el.style.backgroundImage = 'none';
    }
  }
}

// ── Blocs couleurs TV (chaque bloc = mêmes paramètres que l'onglet Couleur) ──
let tvBlocks = [
  { kelvin:6500, tint:0, dimmer:100, wheelHex:'#2552ff', crossfade:70 },
  { kelvin:3200, tint:0, dimmer:100, wheelHex:'#ff3414', crossfade:60 },
];
let tvSelectedBlock = 0;
let _tvWheelInit = false;

function initTvWheel() {
  if (_tvWheelInit) return;
  _tvWheelInit = true;
  _bindColorWheel('tvWheel', onTvWheelPick);
}

// Résout un bloc en couleur finale (même formule que recomputeColor)
function resolveColorSpec(s) {
  const white = tintWhite(kelvinToRgb(s.kelvin), s.tint);
  const col = hexToRgb(s.wheelHex);
  const mix = s.crossfade / 100, f = s.dimmer / 100;
  const cl = v => Math.min(255, Math.max(0, Math.round(v)));
  return rgbToHex(
    cl((white.r * (1 - mix) + col.r * mix) * f),
    cl((white.g * (1 - mix) + col.g * mix) * f),
    cl((white.b * (1 - mix) + col.b * mix) * f)
  );
}

function renderTvBlocks() {
  const strip = document.getElementById('tvBlocksStrip');
  if (!strip) return;
  strip.innerHTML = '';
  tvBlocks.forEach((b, i) => {
    const d = document.createElement('div');
    d.className = 'tv-block-swatch' + (i === tvSelectedBlock ? ' active' : '');
    d.style.background = resolveColorSpec(b);
    d.onclick = () => { tvSelectedBlock = i; renderTvBlocks(); loadTvBlockEditor(); };
    if (tvBlocks.length > 1) {
      const rm = document.createElement('button');
      rm.className = 'rm'; rm.textContent = '×';
      rm.onclick = e => { e.stopPropagation(); tvRemoveBlock(i); };
      d.appendChild(rm);
    }
    strip.appendChild(d);
  });
  const addBtn = document.getElementById('tvAddBlockBtn');
  if (addBtn) addBtn.style.display = tvBlocks.length >= 8 ? 'none' : 'inline-block';
}

function loadTvBlockEditor() {
  const b = tvBlocks[tvSelectedBlock];
  if (!b) return;
  document.getElementById('tvDimmerSlider').value = b.dimmer;
  document.getElementById('tvDimmerVal').innerHTML = b.dimmer + '<span>%</span>';
  document.getElementById('tvCrossfadeSlider').value = b.crossfade;
  document.getElementById('tvCrossfadeVal').innerHTML = b.crossfade + '<span>%</span>';
  document.getElementById('tvKelvinSlider').value = b.kelvin;
  document.getElementById('tvKelvinVal').innerHTML = b.kelvin.toLocaleString('fr') + '<span> K</span>';
  const sign = b.tint >= 0 ? '+' : '';
  document.getElementById('tvTintSlider').value = b.tint;
  document.getElementById('tvTintVal').innerHTML = sign + b.tint + '<span> GM</span>';
}

function onTvBlockParam() {
  const b = tvBlocks[tvSelectedBlock];
  if (!b) return;
  b.dimmer = parseInt(document.getElementById('tvDimmerSlider').value);
  b.crossfade = parseInt(document.getElementById('tvCrossfadeSlider').value);
  b.kelvin = parseInt(document.getElementById('tvKelvinSlider').value);
  b.tint = parseInt(document.getElementById('tvTintSlider').value);
  loadTvBlockEditor();
  renderTvBlocks();
  scheduleEffectSend();
}

function onTvWheelPick(hex) {
  const b = tvBlocks[tvSelectedBlock];
  if (!b) return;
  b.wheelHex = hex;
  if (b.crossfade < 5) { b.crossfade = 100; } // rend la teinte choisie visible
  loadTvBlockEditor();
  renderTvBlocks();
  scheduleEffectSend();
}

function tvAddBlock() {
  if (tvBlocks.length >= 8) return;
  const src = tvBlocks[tvSelectedBlock] || { kelvin:6500, tint:0, dimmer:100, wheelHex:'#ffffff', crossfade:0 };
  tvBlocks.push({ ...src });
  tvSelectedBlock = tvBlocks.length - 1;
  renderTvBlocks(); loadTvBlockEditor(); scheduleEffectSend();
}

function tvRemoveBlock(i) {
  if (tvBlocks.length <= 1) return;
  tvBlocks.splice(i, 1);
  if (tvSelectedBlock >= tvBlocks.length) tvSelectedBlock = tvBlocks.length - 1;
  renderTvBlocks(); loadTvBlockEditor(); scheduleEffectSend();
}

function stopAllEffects() {
  activeScreenEffect = null;
  document.querySelectorAll('.effect-card').forEach(b => b.classList.remove('active'));
  const badge = document.getElementById('effectActiveBadge');
  if (badge) badge.style.display = 'none';
  const panel = document.getElementById('effectSettingsPanel');
  if (panel) panel.style.display = 'none';
  sendMsg({ type:'effect', name:null, active:false });
  refreshPreviewFx(); // aperçu : retour à la couleur de base
  updateStatusRings();
}

