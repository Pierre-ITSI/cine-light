// ══════════════════════════ QR D'APPAIRAGE ══════════════════════════
// QR généré localement (vendor/qrcode-generator, MIT) : le lien d'appairage
// contient le secret de session dans son fragment, il ne quitte jamais
// l'appareil (plus aucun service de QR en ligne).
let _pairQrFor = null; // lien actuellement dessiné (en mémoire seulement)

// Onglet d'appairage : QR de la session + code de rendez-vous actif
function renderPairPanel() {
  if (mode !== 'remote' || !_session) return;
  const link = pairingLink(_session);
  const box = document.getElementById('pairQr');
  if (box && link !== _pairQrFor) { box.innerHTML = qrSvg(link); _pairQrFor = link; }
  if (!_rdv || _rdv.role !== 'remote') remoteNewPairCode();
  renderLinkStatus();
}

// SVG d'un QR (correction M, une marge d'un module ; la carte claire
// autour complète la zone de silence)
function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), q = 1, size = n + 2 * q;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n;) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let e = c + 1;
      while (e < n && qr.isDark(r, e)) e++;
      d += 'M' + (c + q) + ' ' + (r + q) + 'h' + (e - c) + 'v1h-' + (e - c) + 'z';
      c = e;
    }
  }
  return '<svg viewBox="0 0 ' + size + ' ' + size + '" width="172" height="172" shape-rendering="crispEdges" aria-hidden="true">'
    + '<path fill="#111" d="' + d + '"/></svg>';
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



