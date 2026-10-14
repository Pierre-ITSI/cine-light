// ══════════════════════════ MÉMOIRES D'EFFETS ══════════════════════════
// Enregistre un effet complet (type + tous ses réglages), persisté en
// localStorage, rappelable d'un tap et modifiable.
let fxMemories = [], selectedFxMemId = null;

function loadFxMemories() {
  try {
    const raw = localStorage.getItem('setremote-fx-memories');
    fxMemories = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(fxMemories)) fxMemories = [];
  } catch (_) { fxMemories = []; }
}
function persistFxMemories() {
  try { localStorage.setItem('setremote-fx-memories', JSON.stringify(fxMemories)); } catch (_) {}
}
function saveFxMemory() {
  if (!activeScreenEffect) return;
  const cfg = EFFECT_CONFIG[activeScreenEffect] || {};
  const m = { id: 'f' + Date.now(), name: (cfg.name || activeScreenEffect) + ' ' + (fxMemories.length + 1),
              effect: activeScreenEffect, dir: fxDir, params: buildEffectParams() };
  fxMemories.push(m);
  selectedFxMemId = m.id;
  persistFxMemories();
  renderFxMemories();
}
function updateFxMemory() {
  const m = fxMemories.find(x => x.id === selectedFxMemId);
  if (!m || !activeScreenEffect) return;
  m.effect = activeScreenEffect; m.dir = fxDir; m.params = buildEffectParams();
  persistFxMemories();
  renderFxMemories();
}
function applyFxMemory(id) {
  const m = fxMemories.find(x => x.id === id);
  if (!m || !EFFECT_CONFIG[m.effect]) return;
  selectedFxMemId = id;
  if (activeScreenEffect !== m.effect) { activeScreenEffect = null; selectEffect(m.effect); }
  loadEffectParamsToUI(m.effect, m.params || {}, m.dir);
  renderFxMemories();
}
function deleteFxMemory(id) {
  fxMemories = fxMemories.filter(x => x.id !== id);
  if (selectedFxMemId === id) selectedFxMemId = null;
  persistFxMemories();
  renderFxMemories();
}
function renderFxMemories() {
  const grid = document.getElementById('fxMemGrid');
  if (!grid) return;
  const empty = document.getElementById('fxMemEmpty');
  const upBtn = document.getElementById('fxMemUpdateBtn');
  if (empty) empty.style.display = fxMemories.length ? 'none' : 'block';
  if (upBtn) upBtn.disabled = !selectedFxMemId;
  grid.innerHTML = '';
  for (const m of fxMemories) {
    const cfg = EFFECT_CONFIG[m.effect] || {};
    const d = document.createElement('div');
    d.className = 'memory-item' + (m.id === selectedFxMemId ? ' active' : '');
    d.onclick = () => applyFxMemory(m.id);
    d.innerHTML = `<span style="font-size:1rem">${cfg.icon || '✨'}</span><span class="memory-name">${escapeHtml(m.name)}</span>`;
    const del = document.createElement('button');
    del.className = 'memory-del'; del.textContent = '✕';
    del.onclick = (e) => { e.stopPropagation(); deleteFxMemory(m.id); };
    d.appendChild(del);
    grid.appendChild(d);
  }
}

// ══════════════════════════ MÉMOIRES DE COULEUR ══════════════════════════
// Enregistre l'intégralité d'un état couleur (kelvin, tint, dimmer, roue,
// crossfade) sous un nom, persisté en localStorage, rappelable et modifiable.
let colorMemories = [];
let selectedMemoryId = null;

function loadColorMemories(){
  try {
    const raw = localStorage.getItem('setremote-color-memories');
    colorMemories = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(colorMemories)) colorMemories = [];
  } catch(_) { colorMemories = []; }
}
function persistColorMemories(){
  try { localStorage.setItem('setremote-color-memories', JSON.stringify(colorMemories)); } catch(_) {}
}
function currentColorSpec(){
  return { kelvin:kelvinK, tint:colorTint, dimmer:colorDimmer, wheelHex:colorWheelHex, crossfade:colorCrossfade };
}
// État stroboscope courant, mémorisé avec la mémoire de couleur.
function currentStrobeState(){
  const ts=document.getElementById('torchSyncToggle');
  return { active:strobeActive, random:strobeMode==='random', freq:strobeFreq, dur:strobeFlashDur,
           freqMax:strobeFreqMax, durMax:strobeFlashDurMax, torch: ts?ts.checked:false };
}
// Restaure l'état stroboscope (contrôles + diffusion à l'écran).
function applyStrobeState(s){
  if(!s) return;
  // Couper d'abord pour neutraliser l'envoi interne de setStrobeMode.
  strobeActive=false;
  strobeFreq=s.freq; strobeFlashDur=s.dur; strobeFreqMax=s.freqMax; strobeFlashDurMax=s.durMax;
  let el;
  el=document.getElementById('freqSlider');       if(el) el.value=strobeFreq;
  el=document.getElementById('flashDurSlider');    if(el) el.value=strobeFlashDur;
  el=document.getElementById('freqMaxSlider');     if(el) el.value=strobeFreqMax;
  el=document.getElementById('flashDurMaxSlider'); if(el) el.value=strobeFlashDurMax;
  el=document.getElementById('freqVal');        if(el) el.innerHTML=strobeFreq.toFixed(1)+'<span> Hz</span>';
  el=document.getElementById('flashDurVal');    if(el) el.innerHTML=strobeFlashDur+'<span> ms</span>';
  el=document.getElementById('freqMaxVal');     if(el) el.innerHTML=strobeFreqMax.toFixed(1)+'<span> Hz</span>';
  el=document.getElementById('flashDurMaxVal'); if(el) el.innerHTML=strobeFlashDurMax+'<span> ms</span>';
  const ts=document.getElementById('torchSyncToggle'); if(ts) ts.checked=!!s.torch;
  setStrobeMode(s.random?'random':'regular');
  // Appliquer l'état actif/inactif réel et (re)diffuser.
  strobeActive=!!s.active;
  const tog=document.getElementById('strobeToggle');     if(tog) tog.checked=strobeActive;
  const badge=document.getElementById('strobeActiveBadge'); if(badge) badge.style.display=strobeActive?'block':'none';
  if(strobeActive){ sendMsg(buildStrobePayload()); runLocalStrobePreview(); }
  else { sendMsg({type:'strobe',active:false}); stopLocalStrobePreview(); }
}
// Couleur affichée pour une mémoire (même calcul que recomputeColor).
function memorySwatch(s){
  const white=tintWhite(kelvinToRgb(s.kelvin),s.tint);
  const col=hexToRgb(s.wheelHex);
  const mix=s.crossfade/100, f=s.dimmer/100;
  const cl=v=>Math.min(255,Math.max(0,Math.round(v)));
  return rgbToHex(cl((white.r*(1-mix)+col.r*mix)*f),cl((white.g*(1-mix)+col.g*mix)*f),cl((white.b*(1-mix)+col.b*mix)*f));
}
// Rappelle un état complet dans tous les contrôles puis le diffuse.
function applyColorState(s){
  kelvinK=s.kelvin; colorTint=s.tint; colorDimmer=s.dimmer; colorWheelHex=s.wheelHex; colorCrossfade=s.crossfade;
  let el;
  el=document.getElementById('kelvinSlider'); if(el) el.value=kelvinK;
  el=document.getElementById('kelvinVal');    if(el) el.innerHTML=kelvinK.toLocaleString('fr')+'<span> K</span>';
  const sg=colorTint>=0?'+':'';
  el=document.getElementById('tintSlider');   if(el) el.value=colorTint;
  el=document.getElementById('tintVal');      if(el) el.innerHTML=sg+colorTint+'<span> GM</span>';
  el=document.getElementById('dimmerSlider'); if(el) el.value=colorDimmer;
  el=document.getElementById('dimmerVal');    if(el) el.innerHTML=colorDimmer+'<span>%</span>';
  el=document.getElementById('crossfadeSlider'); if(el) el.value=colorCrossfade;
  el=document.getElementById('crossfadeVal');    if(el) el.innerHTML=colorCrossfade+'<span>%</span>';
  recomputeColor();
}
function saveColorMemory(){
  const m={ id: Date.now().toString(36)+Math.random().toString(36).slice(2,6),
            name: 'Mémoire '+(colorMemories.length+1),
            spec: currentColorSpec(), strobe: currentStrobeState() };
  colorMemories.push(m); selectedMemoryId=m.id;
  persistColorMemories(); renderColorMemories();
}
function updateColorMemory(){
  if(!selectedMemoryId) return;
  const m=colorMemories.find(x=>x.id===selectedMemoryId); if(!m) return;
  m.spec=currentColorSpec(); m.strobe=currentStrobeState();
  persistColorMemories(); renderColorMemories();
}
function applyColorMemory(id){
  const m=colorMemories.find(x=>x.id===id); if(!m) return;
  selectedMemoryId=id; applyColorState(m.spec); applyStrobeState(m.strobe); renderColorMemories();
}
function deleteColorMemory(id){
  colorMemories=colorMemories.filter(x=>x.id!==id);
  if(selectedMemoryId===id) selectedMemoryId=null;
  persistColorMemories(); renderColorMemories();
}
function renderColorMemories(){
  const grid=document.getElementById('memoryGrid'); if(!grid) return;
  const empty=document.getElementById('memoryEmpty');
  const hint=document.getElementById('memoryHint');
  const upBtn=document.getElementById('memoryUpdateBtn');
  grid.innerHTML='';
  const has=colorMemories.length>0;
  if(empty) empty.style.display=has?'none':'block';
  if(hint)  hint.style.display=has?'block':'none';
  if(upBtn) upBtn.disabled=!selectedMemoryId;
  colorMemories.forEach(m=>{
    const item=document.createElement('div');
    item.className='memory-item'+(m.id===selectedMemoryId?' active':'');
    item.innerHTML=`<div class="memory-swatch" style="background:${memorySwatch(m.spec)}"></div><div class="memory-name"></div><button class="memory-del" title="Supprimer">✕</button>`;
    item.querySelector('.memory-name').textContent=m.name;
    item.onclick=()=>applyColorMemory(m.id);
    item.querySelector('.memory-del').onclick=(e)=>{e.stopPropagation();deleteColorMemory(m.id);};
    // Appui long (mobile) pour supprimer.
    let lp=null;
    const clr=()=>{ if(lp){clearTimeout(lp);lp=null;} };
    item.addEventListener('touchstart',()=>{ lp=setTimeout(()=>{lp=null;deleteColorMemory(m.id);},600); },{passive:true});
    item.addEventListener('touchend',clr); item.addEventListener('touchmove',clr); item.addEventListener('touchcancel',clr);
    grid.appendChild(item);
  });
}

