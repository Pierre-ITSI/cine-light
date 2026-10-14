// ══════════════════════════ COLOR WHEEL ══════════════════════════
function initWheel() { _bindColorWheel('colorWheel', onWheelPick); }
function _bindColorWheel(canvasId, onPick) {
  const canvas=document.getElementById(canvasId); if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width, R=W/2, cx=R, cy=R;
  const isMain=canvasId==='colorWheel'; // seule la roue principale a marqueur + loupe
  for (let a=0;a<360;a++) {
    const rad=(a-90)*Math.PI/180;
    const grad=ctx.createLinearGradient(cx,cy,cx+Math.cos(rad)*R,cy+Math.sin(rad)*R);
    grad.addColorStop(0,`hsl(${a},0%,100%)`); grad.addColorStop(1,`hsl(${a},100%,50%)`);
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,R,(a-91)*Math.PI/180,(a-89)*Math.PI/180);
    ctx.fillStyle=grad; ctx.fill();
  }
  let drag=false;
  function updateMarker(x,y,hex) {
    if(!isMain) return;
    const g=document.getElementById('colorWheelMarker');
    if(g) g.setAttribute('transform',`translate(${x},${y})`);
    const f=document.getElementById('colorWheelMarkerFill');
    if(f&&hex) f.setAttribute('fill',hex);
  }
  function showLoupe(x,y,hex) {
    if(!isMain) return;
    const g=document.getElementById('colorWheelLoupe'); if(!g) return;
    const LR=40; // rayon du fond de loupe
    // Pas de clamping : la loupe sort librement du cadre de la roue
    // (SVG en overflow:visible) pour ne jamais masquer la zone visée.
    g.setAttribute('transform',`translate(${x},${y-LR-22})`);
    const f=document.getElementById('colorWheelLoupeFill');
    if(f) f.setAttribute('fill',hex);
    g.style.display='block';
  }
  function hideLoupe() {
    if(!isMain) return;
    const g=document.getElementById('colorWheelLoupe');
    if(g) g.style.display='none';
  }
  function pick(ex,ey) {
    const rect=canvas.getBoundingClientRect();
    const x=(ex-rect.left)*(W/rect.width), y=(ey-rect.top)*(W/rect.height);
    if (Math.sqrt((x-cx)**2+(y-cy)**2)>R) return;
    const d=ctx.getImageData(Math.round(Math.min(Math.max(x,0),W-1)),Math.round(Math.min(Math.max(y,0),W-1)),1,1).data;
    const hex=rgbToHex(d[0],d[1],d[2]);
    updateMarker(x,y,hex);
    showLoupe(x,y,hex);
    onPick(hex);
  }
  canvas.addEventListener('mousedown',e=>{drag=true;pick(e.clientX,e.clientY)});
  canvas.addEventListener('mousemove',e=>{if(drag)pick(e.clientX,e.clientY)});
  canvas.addEventListener('mouseup',()=>{drag=false;hideLoupe()});
  canvas.addEventListener('mouseleave',()=>{if(drag){drag=false;hideLoupe()}});
  canvas.addEventListener('touchstart',e=>{e.preventDefault();pick(e.touches[0].clientX,e.touches[0].clientY)},{passive:false});
  canvas.addEventListener('touchmove',e=>{e.preventDefault();pick(e.touches[0].clientX,e.touches[0].clientY)},{passive:false});
  canvas.addEventListener('touchend',hideLoupe);
  canvas.addEventListener('touchcancel',hideLoupe);
}
// ══════════════════════════ KELVIN ══════════════════════════
function kelvinToRgb(K) {
  const t=K/100; let r,g,b;
  r=t<=66?255:Math.min(255,Math.max(0,329.698727446*Math.pow(t-60,-0.1332047592)));
  g=t<=66?Math.min(255,Math.max(0,99.4708025861*Math.log(t)-161.1195681661)):Math.min(255,Math.max(0,288.1221695283*Math.pow(t-60,-0.0755148492)));
  b=t>=66?255:(t<=19?0:Math.min(255,Math.max(0,138.5177312231*Math.log(t-10)-305.0447927307)));
  return{r:Math.round(r),g:Math.round(g),b:Math.round(b)};
}

// ══════════════════════════ COULEUR UNIFIÉE ══════════════════════════
function tintWhite(rgb, gm) {
  let r=rgb.r,g=rgb.g,b=rgb.b;
  if(gm>0){r*=(1-gm/100*0.45);b*=(1-gm/100*0.45);}
  else if(gm<0){const t=Math.abs(gm)/100;g*=(1-t*0.65);}
  return {r,g,b};
}
function recomputeColor() {
  const white=tintWhite(kelvinToRgb(kelvinK),colorTint);
  const col=hexToRgb(colorWheelHex);
  const mix=colorCrossfade/100, f=colorDimmer/100;
  const cl=v=>Math.min(255,Math.max(0,Math.round(v)));
  const r=cl((white.r*(1-mix)+col.r*mix)*f);
  const g=cl((white.g*(1-mix)+col.g*mix)*f);
  const b=cl((white.b*(1-mix)+col.b*mix)*f);
  const sign=colorTint>=0?'+':'';
  let meta;
  if(colorCrossfade<5)       meta=kelvinK+'K · '+sign+colorTint+'GM · '+colorDimmer+'%';
  else if(colorCrossfade>95) meta='Roue · '+colorDimmer+'%';
  else                       meta='Mix '+colorCrossfade+'% · '+colorDimmer+'%';
  applyColor(rgbToHex(r,g,b),meta);
  scheduleAutoSend();
}
function onDimmerChange() {
  colorDimmer=parseInt(document.getElementById('dimmerSlider').value);
  document.getElementById('dimmerVal').innerHTML=colorDimmer+'<span>%</span>';
  recomputeColor();
}
function onCrossfadeChange() {
  colorCrossfade=parseInt(document.getElementById('crossfadeSlider').value);
  document.getElementById('crossfadeVal').innerHTML=colorCrossfade+'<span>%</span>';
  updateCrossfadeGradient();
  recomputeColor();
}
function updateCrossfadeGradient() {
  const cctRgb=tintWhite(kelvinToRgb(kelvinK),colorTint);
  const cctHex='#'+[cctRgb.r,cctRgb.g,cctRgb.b].map(x=>x.toString(16).padStart(2,'0')).join('');
  const wheelHex=colorWheelHex;
  const gradient=`linear-gradient(to right,${cctHex},${wheelHex})`;
  const slider=document.getElementById('crossfadeSlider');
  const hueSlider=document.getElementById('hueCrossfadeSlider');
  const rgbSlider=document.getElementById('rgbCrossfadeSlider');
  if(slider) slider.style.background=gradient;
  if(hueSlider) hueSlider.style.background=gradient;
  if(rgbSlider) rgbSlider.style.background=gradient;
}
function setCrossfade(v) {
  colorCrossfade=v;
  const s=document.getElementById('crossfadeSlider'); if(s) s.value=v;
  const l=document.getElementById('crossfadeVal'); if(l) l.innerHTML=v+'<span>%</span>';
}
function onWheelPick(hex) {
  colorWheelHex=hex;
  syncHueValue();   // garde le mode HUE aligné sur la roue
  syncRgbValues();  // garde le mode RGB aligné sur la roue
  updateCrossfadeGradient();
  recomputeColor();
}
function onKelvinChange() {
  kelvinK=parseInt(document.getElementById('kelvinSlider').value);
  document.getElementById('kelvinVal').innerHTML=kelvinK.toLocaleString('fr')+'<span> K</span>';
  updateCrossfadeGradient();
  recomputeColor();
}
function setKelvin(k){document.getElementById('kelvinSlider').value=k;onKelvinChange();}
function onTintChange() {
  colorTint=parseInt(document.getElementById('tintSlider').value);
  const sign=colorTint>=0?'+':'';
  document.getElementById('tintVal').innerHTML=sign+colorTint+'<span> GM</span>';
  updateCrossfadeGradient();
  recomputeColor();
}
function setTint(v){document.getElementById('tintSlider').value=v;onTintChange();}

function updateWheelMarker() {
  const c=hexToRgb(colorWheelHex);
  const max=Math.max(c.r,c.g,c.b), min=Math.min(c.r,c.g,c.b);
  const sat=max>0?(max-min)/max:0; // saturation HSV = distance au centre de la roue
  const h=rgbToHsl(c.r,c.g,c.b).h*Math.PI/180;
  const R=120, cx=120, cy=120;
  const x=cx+sat*R*Math.cos(h-Math.PI/2);
  const y=cy+sat*R*Math.sin(h-Math.PI/2);
  const g=document.getElementById('colorWheelMarker');
  if(g) g.setAttribute('transform',`translate(${x},${y})`);
  const f=document.getElementById('colorWheelMarkerFill');
  if(f) f.setAttribute('fill',colorWheelHex);
}

function setColorPickMode(mode) {
  document.getElementById('chip-wheel').classList.toggle('active',mode==='wheel');
  document.getElementById('chip-hue').classList.toggle('active',mode==='hue');
  document.getElementById('chip-rgb').classList.toggle('active',mode==='rgb');
  document.getElementById('colorPickWheel').style.display=mode==='wheel'?'block':'none';
  document.getElementById('colorPickHue').style.display=mode==='hue'?'block':'none';
  document.getElementById('colorPickRgb').style.display=mode==='rgb'?'block':'none';
  if(mode==='hue') { updateHueGradient(); updateCrossfadeGradient(); }
  if(mode==='rgb') { updateRgbGradients(); updateCrossfadeGradient(); }
  if(mode==='wheel') updateCrossfadeGradient();
}

function onHueChange() {
  const h=parseInt(document.getElementById('hueSlider').value);
  document.getElementById('hueVal').innerHTML=h+'<span>°</span>';
  const rgb=hslToRgb(h, 100, 50);
  colorWheelHex='#'+[rgb.r,rgb.g,rgb.b].map(x=>x.toString(16).padStart(2,'0')).join('');
  syncRgbValues();
  updateWheelMarker();
  updateHueGradient();
  updateCrossfadeGradient();
  recomputeColor();
}

function updateHueGradient() {
  const hueSlider=document.getElementById('hueSlider');
  if(!hueSlider) return;
  const stops=[
    'hsl(0,100%,50%)',
    'hsl(60,100%,50%)',
    'hsl(120,100%,50%)',
    'hsl(180,100%,50%)',
    'hsl(240,100%,50%)',
    'hsl(300,100%,50%)',
    'hsl(0,100%,50%)'
  ];
  hueSlider.style.background=`linear-gradient(to right,${stops.join(',')})`;
}

function onRgbChange() {
  const r=parseInt(document.getElementById('rgbRedSlider').value);
  const g=parseInt(document.getElementById('rgbGreenSlider').value);
  const b=parseInt(document.getElementById('rgbBlueSlider').value);
  document.getElementById('rgbRedVal').textContent=r;
  document.getElementById('rgbGreenVal').textContent=g;
  document.getElementById('rgbBlueVal').textContent=b;
  colorWheelHex='#'+[r,g,b].map(x=>x.toString(16).padStart(2,'0')).join('');
  syncHueValue();
  updateWheelMarker();
  updateRgbGradients();
  updateCrossfadeGradient();
  recomputeColor();
}

function updateRgbGradients() {
  const redSlider=document.getElementById('rgbRedSlider');
  const greenSlider=document.getElementById('rgbGreenSlider');
  const blueSlider=document.getElementById('rgbBlueSlider');
  if(redSlider) redSlider.style.background=`linear-gradient(to right,#000,rgb(255,0,0))`;
  if(greenSlider) greenSlider.style.background=`linear-gradient(to right,#000,rgb(0,255,0))`;
  if(blueSlider) blueSlider.style.background=`linear-gradient(to right,#000,rgb(0,0,255))`;
}

function onHueCrossfadeChange() {
  colorCrossfade=parseInt(document.getElementById('hueCrossfadeSlider').value);
  document.getElementById('hueCrossfadeVal').innerHTML=colorCrossfade+'<span>%</span>';
  syncCrossfadeValues();
  updateCrossfadeGradient();
  recomputeColor();
}

function onRgbCrossfadeChange() {
  colorCrossfade=parseInt(document.getElementById('rgbCrossfadeSlider').value);
  document.getElementById('rgbCrossfadeVal').innerHTML=colorCrossfade+'<span>%</span>';
  syncCrossfadeValues();
  updateCrossfadeGradient();
  recomputeColor();
}

function syncRgbValues() {
  const r=parseInt(colorWheelHex.substr(1,2),16);
  const g=parseInt(colorWheelHex.substr(3,2),16);
  const b=parseInt(colorWheelHex.substr(5,2),16);
  document.getElementById('rgbRedSlider').value=r;
  document.getElementById('rgbGreenSlider').value=g;
  document.getElementById('rgbBlueSlider').value=b;
  document.getElementById('rgbRedVal').textContent=r;
  document.getElementById('rgbGreenVal').textContent=g;
  document.getElementById('rgbBlueVal').textContent=b;
}

function syncHueValue() {
  const r=parseInt(colorWheelHex.substr(1,2),16);
  const g=parseInt(colorWheelHex.substr(3,2),16);
  const b=parseInt(colorWheelHex.substr(5,2),16);
  const hsl=rgbToHsl(r,g,b);
  document.getElementById('hueSlider').value=hsl.h;
  document.getElementById('hueVal').innerHTML=hsl.h+'<span>°</span>';
}

function syncCrossfadeValues() {
  const cs=document.getElementById('crossfadeSlider');
  const hcs=document.getElementById('hueCrossfadeSlider');
  const rcs=document.getElementById('rgbCrossfadeSlider');
  if(cs) cs.value=colorCrossfade;
  if(hcs) hcs.value=colorCrossfade;
  if(rcs) rcs.value=colorCrossfade;
  if(cs) document.getElementById('crossfadeVal').innerHTML=colorCrossfade+'<span>%</span>';
}

function rgbToHsl(r, g, b) {
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  let h=0, l=(max+min)/2;
  if(max!==min) {
    const d=max-min;
    const s=l>0.5?d/(2-max-min):d/(max+min);
    switch(max) {
      case r: h=((g-b)/d+(g<b?6:0))/6; break;
      case g: h=((b-r)/d+2)/6; break;
      case b: h=((r-g)/d+4)/6; break;
    }
  }
  return {h:Math.round(h*360), l:Math.round(l*100)};
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return {
    r: Math.round(255 * f(0)),
    g: Math.round(255 * f(8)),
    b: Math.round(255 * f(4))
  };
}

