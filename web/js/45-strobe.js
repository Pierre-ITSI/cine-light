// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ STROBE ══════════════════════════
function setStrobeMode(m) {
  strobeMode=m;
  document.getElementById('chip-regular').classList.toggle('active',m==='regular');
  document.getElementById('chip-random').classList.toggle('active',m==='random');
  document.getElementById('randomOptions').style.display=m==='random'?'block':'none';
  document.getElementById('freqLabel').textContent=m==='random'?'Fréquence min':'Fréquence';
  document.getElementById('durLabel').textContent=m==='random'?'Durée flash min':'Durée du flash';
  if(strobeActive){sendMsg(buildStrobePayload());runLocalStrobePreview();}
}
function onStrobeToggle(acked) {
  const tog=document.getElementById('strobeToggle');
  // Activation : avertissement photosensibilité d'abord (46-strobe-warning.js),
  // l'interrupteur reste ouvert derrière la boîte (maquette 11)
  if(tog.checked&&!strobeActive&&!acked&&needsFlashWarning('strobe')){
    openFlashWarning(()=>{tog.checked=true;onStrobeToggle(true);},()=>{tog.checked=false;});
    return;
  }
  strobeActive=tog.checked;
  document.getElementById('strobeActiveBadge').style.display=strobeActive?'block':'none';
  if(strobeActive){sendMsg(buildStrobePayload());runLocalStrobePreview();}else stopStrobe();
  renderNavStatus();
}
function onStrobeParamChange() {
  strobeFreq=parseFloat(document.getElementById('freqSlider').value);
  strobeFlashDur=parseInt(document.getElementById('flashDurSlider').value);
  strobeFreqMax=parseFloat(document.getElementById('freqMaxSlider').value);
  strobeFlashDurMax=parseInt(document.getElementById('flashDurMaxSlider').value);
  document.getElementById('freqVal').innerHTML=strobeFreq.toFixed(1)+'<span> Hz</span>';
  document.getElementById('flashDurVal').innerHTML=strobeFlashDur+'<span> ms</span>';
  document.getElementById('freqMaxVal').innerHTML=strobeFreqMax.toFixed(1)+'<span> Hz</span>';
  document.getElementById('flashDurMaxVal').innerHTML=strobeFlashDurMax+'<span> ms</span>';
  if(strobeActive){sendMsg(buildStrobePayload());runLocalStrobePreview();}
  renderNavStatus(); // la fréquence apparaît dans la barre « en cours »
}
function buildStrobePayload(){const ts=document.getElementById('torchSyncToggle');return{type:'strobe',active:strobeActive,torch:ts?ts.checked:false,random:strobeMode==='random',freq:strobeFreq,dur:strobeFlashDur,freqMin:strobeFreq,freqMax:strobeFreqMax,durMin:strobeFlashDur,durMax:strobeFlashDurMax};}
function stopStrobe() {
  strobeActive=false;
  if(document.getElementById('strobeToggle'))document.getElementById('strobeToggle').checked=false;
  if(document.getElementById('strobeActiveBadge'))document.getElementById('strobeActiveBadge').style.display='none';
  sendMsg({type:'strobe',active:false}); stopLocalStrobePreview();
  renderNavStatus();
}
function runLocalStrobePreview() {
  stopLocalStrobePreview();
  _pvFxStop(); // le strobe prime sur l'effet dans l'aperçu
  const flashEl=document.getElementById('strobeFlashPreview');
  if(!flashEl||!strobeActive)return;
  function cycle(){
    let freq=strobeFreq,dur=strobeFlashDur;
    if(strobeMode==='random'){freq=strobeFreq+Math.random()*(strobeFreqMax-strobeFreq);dur=strobeFlashDur+Math.random()*(strobeFlashDurMax-strobeFlashDur);}
    const interval=Math.max(dur+5,1000/freq);
    flashEl.style.opacity='0.9';
    // Les swatches rejouent le strobe : couleur pendant le flash, noir entre
    const c=hexToRgb(currentColor);
    _pvApplyBg(c.r,c.g,c.b,0);
    strobePreviewTimer=setTimeout(()=>{
      flashEl.style.opacity='0';
      _pvApplyBg(0,0,0,0);
      if(strobeActive)strobePreviewTimer=setTimeout(cycle,interval-dur);
    },dur);
  }
  cycle();
}
function stopLocalStrobePreview(){
  if(strobePreviewTimer)clearTimeout(strobePreviewTimer);
  strobePreviewTimer=null;
  const f=document.getElementById('strobeFlashPreview');
  if(f)f.style.opacity='0';
  refreshPreviewFx(); // aperçu : reprend l'effet en cours ou la couleur de base
}

