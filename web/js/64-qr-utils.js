// ══════════════════════════ QR ══════════════════════════
function renderQR(){
  const urlEl=document.getElementById('qrUrl'),canvas=document.getElementById('qrCanvas');
  if(!channel){urlEl.textContent='Connectez-vous d\'abord à un canal';return;}
  const url=location.origin+location.pathname+'#'+channel;
  urlEl.textContent=url;
  const img=new Image();img.crossOrigin='anonymous';
  img.onload=()=>{const ctx=canvas.getContext('2d');ctx.clearRect(0,0,200,200);ctx.drawImage(img,0,0,200,200);};
  img.src='https://api.qrserver.com/v1/create-qr-code/?size=200x200&data='+encodeURIComponent(url);
}

// ══════════════════════════ UTILS ══════════════════════════
function applyColor(hex,meta){
  currentColor=hex;
  document.getElementById('previewHex').textContent=hex.toUpperCase();
  if(meta)document.getElementById('previewMeta').textContent=meta;
  // Ne pas écraser l'animation de l'aperçu quand un effet/strobe est simulé
  if(!strobeActive && !activeScreenEffect){
    document.getElementById('previewSwatch').style.backgroundColor=hex;
    const ss=document.getElementById('stickySwatch'); if(ss) ss.style.backgroundColor=hex;
  }
}
function rgbToHex(r,g,b){return'#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');}
function hexToRgb(hex){return{r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)};}



