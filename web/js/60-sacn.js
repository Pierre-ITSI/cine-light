// ══════════════════════════ SCREEN sACN MODE ══════════════════════════
let _screenSacnWs = null, _screenSacnMode = '3ch';

function selectScreenSacnMode(mode) {
  _screenSacnMode = mode;
  ['3ch','9ch'].forEach(m => {
    const b = document.getElementById('screenSacnMode-' + m);
    if (b) b.classList.toggle('active', m === mode);
  });
}

function enterScreenSACN() {
  const universe = parseInt(document.getElementById('screenSacnUniverse').value) || 1;
  const baseAddr = parseInt(document.getElementById('screenSacnBaseAddr').value) || 1;
  sacnUniverse  = universe;
  sacnStartAddr = baseAddr;
  sacnMode      = _screenSacnMode;

  document.getElementById('screen-sacn-config').style.display = 'none';
  mode = 'screen-sacn';
  const el = document.getElementById('screen-mode');
  el.style.display   = 'flex';
  el.style.backgroundColor = '#000000';
  setScreenStatus('sACN · Connexion…');
  requestFS();
  setupScreenAutohide();

  const CapSACN = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE)
                  ? (window.Capacitor?.Plugins?.SACN || null) : null;

  if (CapSACN) {
    CapSACN.start({ universe, baseAddr })
      .then(() => {
        setScreenStatus('sACN ✓ U' + universe + ' · @' + baseAddr);
        CapSACN.addListener('dmxUpdate', (f) => screenApplyNativeFixture(f));
      })
      .catch(() => setScreenStatus('⚠ sACN erreur'));
  } else {
    const ip   = (document.getElementById('screenSacnBridgeIP')?.value  || '').trim();
    const port = (document.getElementById('screenSacnBridgePort')?.value || '3001').trim();
    if (!ip) { setScreenStatus('⚠ Bridge IP manquant'); return; }
    try {
      _screenSacnWs = new WebSocket(`ws://${ip}:${port}`);
    } catch(e) { setScreenStatus('⚠ Bridge erreur'); return; }
    _screenSacnWs.onopen = () => {
      setScreenStatus('sACN ✓ U' + universe + ' · @' + baseAddr);
      _screenSacnWs.send(JSON.stringify({ type: 'setUniverse', universe }));
    };
    _screenSacnWs.onmessage = (e) => {
      try { const m = JSON.parse(e.data); if (m.type === 'dmx') screenApplyDmx(m.dmx); } catch(_){}
    };
    _screenSacnWs.onerror  = () => setScreenStatus('⚠ Bridge déconnecté');
    _screenSacnWs.onclose  = () => setScreenStatus('⚠ Bridge fermé');
  }
}

function stopScreenSACN() {
  if (_screenSacnWs) { _screenSacnWs.close(); _screenSacnWs = null; }
  const CapSACN = (typeof IS_NATIVE !== 'undefined' && IS_NATIVE)
                  ? (window.Capacitor?.Plugins?.SACN || null) : null;
  if (CapSACN) CapSACN.stop().catch(() => {});
}

function screenApplyNativeFixture(f) {
  const el = document.getElementById('screen-mode');
  if (!el) return;
  if (f.isStrobe) {
    receiveStrobe({ active:true, torch:false, random:false,
      freq:f.strobeHz||1, dur:f.strobeMs||50,
      freqMin:f.strobeHz||1, freqMax:f.strobeHz||1,
      durMin:f.strobeMs||50, durMax:f.strobeMs||50 });
  } else {
    receiveStrobe({ active:false });
    el.style.transition = 'background-color .05s';
    el.style.backgroundColor = rgbToHex(
      Math.min(255, Math.round(f.finalR * 255)),
      Math.min(255, Math.round(f.finalG * 255)),
      Math.min(255, Math.round(f.finalB * 255))
    );
  }
}

function screenApplyDmx(dmx) {
  const el = document.getElementById('screen-mode');
  if (!el) return;
  const addr = sacnStartAddr - 1;
  const ch   = (n) => Math.max(0, Math.min(255, dmx[addr + n] || 0));
  const dimmer = ch(0) / 255;

  if (sacnMode === '3ch') {
    const kelvin = Math.round(1700 + (ch(1) / 255) * 18300);
    const gm = ch(2) <= 127 ? ((ch(2)/127)-1)*100 : ((ch(2)-128)/127)*100;
    receiveStrobe({ active:false });
    el.style.transition = 'background-color .05s';
    el.style.backgroundColor = dmxKelvinGM(kelvin, gm, dimmer);
  } else if (sacnMode === '9ch') {
    const r = ch(0), g = ch(1), b = ch(2);
    const dimmer = ch(3) / 255;
    const gmRaw  = ch(6);
    const gm     = gmRaw <= 127 ? ((gmRaw/127)-1)*100 : ((gmRaw-128)/127)*100;
    const strobeHz = ch(7);
    const strobeMs = Math.round(5 + (ch(8)/255)*495);
    if (strobeHz > 0) {
      const freq = 0.5 + (strobeHz/255)*24.5;
      receiveStrobe({ active:true, torch:false, random:false,
        freq, dur:strobeMs, freqMin:freq, freqMax:freq, durMin:strobeMs, durMax:strobeMs });
      return;
    }
    receiveStrobe({ active:false });
    let fr = r/255, fg = g/255, fb = b/255;
    if (gm > 0)      { fr *= (1-gm/100*0.45); fb *= (1-gm/100*0.45); }
    else if (gm < 0) { const t=Math.abs(gm)/100; fg *= (1-t*0.65); }
    el.style.transition = 'background-color .05s';
    el.style.backgroundColor = rgbToHex(
      Math.round(fr*dimmer*255), Math.round(fg*dimmer*255), Math.round(fb*dimmer*255));
  }
}

// ══════════════════════════ sACN / DMX ══════════════════════════
let sacnWs = null, sacnConnected = false;
let sacnUniverse = 1, sacnStartAddr = 1, sacnMode = '3ch';
let sacnDmxValues = new Array(512).fill(0);
let _sacnLastSend = 0, _sacnStrobeActive = false;

const SACN_MODES = {
  '3ch': [
    { label:'Dimmer',    short:'DIM' },
    { label:'CCT',       short:'CCT' },
    { label:'+/− GM',    short:'+/−' },
  ],
  '9ch': [
    { label:'Red',       short:'R'   },
    { label:'Green',     short:'G'   },
    { label:'Blue',      short:'B'   },
    { label:'Dimmer',    short:'DIM' },
    { label:'Kelvin L',  short:'K-L' },
    { label:'Kelvin H',  short:'K-H' },
    { label:'GM Shift',  short:'+/−' },
    { label:'Strobe Hz', short:'S-F' },
    { label:'Strobe ms', short:'S-D' },
  ],
};

function sacnConnect() {
  const ip   = document.getElementById('sacnBridgeIP').value.trim();
  const port = document.getElementById('sacnBridgePort').value.trim() || '3001';
  if (!ip) return;
  sacnUniverse  = parseInt(document.getElementById('sacnUniverse').value)  || 1;
  sacnStartAddr = parseInt(document.getElementById('sacnStartAddr').value) || 1;
  sacnMode = sacnMode || '3ch';
  if (sacnWs) { sacnWs.close(); sacnWs = null; }
  setSacnStatus('connecting');
  try {
    sacnWs = new WebSocket(`ws://${ip}:${port}`);
  } catch(e) { setSacnStatus('error'); return; }
  sacnWs.onopen  = () => {
    sacnConnected = true;
    setSacnStatus('connected');
    sacnWs.send(JSON.stringify({ type:'setUniverse', universe: sacnUniverse }));
    updateDmxGrid();
  };
  sacnWs.onmessage = (e) => {
    try { const m = JSON.parse(e.data); if (m.type === 'dmx') receiveDmx(m.dmx); } catch(_){}
  };
  sacnWs.onerror  = () => setSacnStatus('error');
  sacnWs.onclose  = () => { sacnConnected = false; setSacnStatus('disconnected'); };
}

function sacnDisconnect() {
  if (sacnWs) { sacnWs.close(); sacnWs = null; }
  setSacnStatus('disconnected');
}

function setSacnStatus(s) {
  const dot = document.getElementById('sacnDot');
  const lbl = document.getElementById('sacnLabel');
  const btn = document.getElementById('sacnConnectBtn');
  if (!dot) return;
  dot.className = 'dot';
  if (s === 'connected')   { dot.classList.add('connected');  lbl.textContent = '✓ Connecté — univers ' + sacnUniverse; btn.textContent = 'Déconnecter'; btn.onclick = sacnDisconnect; }
  else if (s === 'connecting') { dot.classList.add('connecting'); lbl.textContent = 'Connexion…'; btn.textContent = 'Annuler'; btn.onclick = sacnDisconnect; }
  else if (s === 'error')  { dot.classList.add('error');      lbl.textContent = 'Erreur bridge';     btn.textContent = 'Réessayer'; btn.onclick = sacnConnect; }
  else                     { lbl.textContent = 'Non connecté'; btn.textContent = 'Connecter'; btn.onclick = sacnConnect; }
}

function setSacnMode(mode) {
  sacnMode = mode;
  document.getElementById('sacnmode-3ch').classList.toggle('active', mode === '3ch');
  updateDmxGrid();
}

function updateDmxGrid() {
  const grid = document.getElementById('dmxChannelGrid');
  if (!grid) return;
  const channels = SACN_MODES[sacnMode] || SACN_MODES['3ch'];
  const cols = Math.min(channels.length, 4);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';
  channels.forEach((ch, i) => {
    const addr = sacnStartAddr + i;
    const val = sacnDmxValues[addr - 1] || 0;
    const tile = document.createElement('div');
    tile.className = 'dmx-tile';
    tile.innerHTML = `<div class="dmx-ch">CH ${addr}</div><div class="dmx-label">${ch.short}</div><div class="dmx-val" id="dmxval-${i}">${val}</div><div class="dmx-bar"><div class="dmx-bar-fill" id="dmxbar-${i}" style="width:${(val/255*100).toFixed(1)}%"></div></div>`;
    grid.appendChild(tile);
  });
}

function receiveDmx(dmx) {
  sacnDmxValues = dmx;
  const channels = SACN_MODES[sacnMode] || [];
  channels.forEach((_, i) => {
    const val = dmx[sacnStartAddr - 1 + i] || 0;
    const valEl = document.getElementById(`dmxval-${i}`);
    const barEl = document.getElementById(`dmxbar-${i}`);
    if (valEl) valEl.textContent = val;
    if (barEl) barEl.style.width = (val / 255 * 100).toFixed(1) + '%';
  });
  applyDmxToOutput(dmx);
}

function applyDmxToOutput(dmx) {
  const addr = sacnStartAddr - 1; // 0-indexed
  const ch   = (n) => Math.max(0, Math.min(255, dmx[addr + n] || 0));
  const dimmer = ch(0) / 255;

  if (sacnMode === '3ch') {
    const kelvin = Math.round(1700 + (ch(1) / 255) * (20000 - 1700));
    const gmRaw  = ch(2);
    const gm     = gmRaw <= 127 ? ((gmRaw / 127) - 1) * 100 : ((gmRaw - 128) / 127) * 100;
    const color  = dmxKelvinGM(kelvin, gm, dimmer);
    sacnSendColor(color, `sACN 3CH`);
  }
}

function dmxKelvinGM(kelvin, gm, dimmer) {
  const rgb = kelvinToRgb(kelvin);
  let r = rgb.r, g = rgb.g, b = rgb.b;
  if (gm > 0)      { r *= (1 - gm/100 * 0.45); b *= (1 - gm/100 * 0.45); }
  else if (gm < 0) { const t = Math.abs(gm)/100; g *= (1 - t * 0.65); }
  return rgbToHex(Math.round(r * dimmer), Math.round(g * dimmer), Math.round(b * dimmer));
}

function sacnSendColor(color, meta) {
  applyColor(color, meta);
  const now = Date.now();
  if (now - _sacnLastSend < 40) return; // Throttle → max 25Hz vers MQTT
  _sacnLastSend = now;
  sendMsg({ type:'color', color });
  const el = document.getElementById('autosendBadge');
  if (el) { el.classList.add('visible'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), 300); }
}

