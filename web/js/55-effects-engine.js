// SPDX-License-Identifier: AGPL-3.0-only — © 2026 ITSI APP
// ══════════════════════════ EFFECTS TAB — RÉCEPTEUR (screen) ══════════════════════════
let _screenEffect = null, _screenFxParams = null, _screenFxSuspended = false;

// ── MOTEUR D'EFFETS CANVAS ──
// Chaque effet dessine ses frames dans un canvas basse résolution étiré
// (240×136 plein écran, mini-canvas pour les aperçus). Le même code anime
// l'écran de jeu et les aperçus de la télécommande.

function _fxHexRgb(h) {
  const c = /^#[0-9a-fA-F]{6}$/.test(h || '') ? hexToRgb(h) : null;
  return c || { r: 255, g: 255, b: 255 };
}

// Modulation « Chaos » (jitter lisse) + « Dérive » (marche aléatoire lente)
// appliquée à vitesse et intensité à chaque frame.
function _fxModulate(p, st, t) {
  const chaos = Math.max(0, Math.min(1, (p.chaos != null ? p.chaos : 30) / 100));
  const drift = Math.max(0, Math.min(1, (p.drift || 0) / 100));
  if (!st._m) st._m = { ph: Math.random() * 100, walk: 0, lastT: t };
  const dt = Math.max(0, Math.min(0.1, t - st._m.lastT)); st._m.lastT = t;
  st._m.walk += (Math.random() - 0.5) * drift * dt * 1.6;
  st._m.walk = Math.max(-0.7, Math.min(0.7, st._m.walk * (1 - 0.05 * dt)));
  const jit = Math.sin(t * 4.7 + st._m.ph) * Math.sin(t * 1.3 + st._m.ph * 1.7); // bruit lisse [-1..1]
  const m = Object.assign({}, p);
  m.speed = (p.speed || 1) * (1 + jit * chaos * 0.55) * (1 + st._m.walk);
  m.intensity = Math.max(5, Math.min(100, (p.intensity || 80) * (1 + jit * chaos * 0.35)));
  return m;
}

function makeFxRenderer(canvasId) {
  let raf = null, name = null, p = null, st = null, t0 = 0;
  const el = () => document.getElementById(canvasId);
  function start(n, params) {
    stop();
    const c = el(); if (!c || !FX_LIB[n]) return;
    name = n; p = params || {}; st = {}; t0 = performance.now();
    c.style.display = 'block';
    loop();
  }
  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null; name = null;
    const c = el(); if (c) c.style.display = 'none';
  }
  function update(params) { if (name && params) p = params; }
  function loop() {
    if (!name) return;
    raf = requestAnimationFrame(loop);
    const c = el(); const fx = FX_LIB[name];
    if (!c || !fx) return;
    const t = (performance.now() - t0) / 1000;
    try { fx(c.getContext('2d'), c.width, c.height, t, _fxModulate(p, st, t), st); } catch (_) {}
  }
  return { start, stop, update, current: () => name };
}

// ── Bibliothèque d'effets : fx(ctx, W, H, t, p, st) dessine une frame ──
const FX_LIB = {
  // — Ambiances —
  tv(ctx, W, H, t, p, st) {
    const iv = Math.max(0.03, 0.4 / (p.speed || 1));
    if (st.tN == null || t >= st.tN) {
      st.tN = t + iv * (0.5 + Math.random());
      st.prev = st.col || { r: 0, g: 0, b: 0 };
      st.t0 = t;
      const pal = (p.blocks && p.blocks.length) ? p.blocks : ['#000000','#101040','#2040b0','#ffffff','#c0c8d0','#800010'];
      st.col = _fxHexRgb(pal[Math.floor(Math.random() * pal.length)]);
    }
    const k = p.intensity / 100;
    let c = st.col || { r: 0, g: 0, b: 0 };
    // Lissage : fondu progressif entre deux couleurs au lieu d'une saute
    const sm = Math.max(0, Math.min(1, (p.smooth || 0) / 100));
    if (sm > 0 && st.prev) {
      const dur = Math.max(0.016, iv * sm);
      const u = Math.min(1, (t - (st.t0 || 0)) / dur);
      c = {
        r: st.prev.r + (c.r - st.prev.r) * u,
        g: st.prev.g + (c.g - st.prev.g) * u,
        b: st.prev.b + (c.b - st.prev.b) * u,
      };
    }
    ctx.fillStyle = `rgb(${c.r * k | 0},${c.g * k | 0},${c.b * k | 0})`;
    ctx.fillRect(0, 0, W, H);
  },
  candle(ctx, W, H, t, p, st) {
    const flame = _fxHexRgb(p.color1 || '#ff7814');
    if (st.fN == null || t >= st.fN) { st.fN = t + (0.12 / (p.speed || 1)) * (0.5 + Math.random()); st.tgt = 0.55 + Math.random() * 0.45; }
    if (st.fl == null) st.fl = 1;
    st.fl += ((st.tgt || 1) - st.fl) * 0.15;
    const k = st.fl * p.intensity / 100;
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, `rgb(${flame.r * k | 0},${flame.g * k | 0},${flame.b * k | 0})`);
    g.addColorStop(1, `rgb(${flame.r * k * 0.25 | 0},${flame.g * k * 0.16 | 0},${flame.b * k * 0.1 | 0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  },
  fire(ctx, W, H, t, p, st) {
    const hot = _fxHexRgb(p.color1 || '#ff7314');
    const cool = _fxHexRgb(p.color2 || '#3c0a00');
    const k = p.intensity / 100;
    const heat = 0.55 + 0.45 * Math.abs(Math.sin(t * (p.speed || 3) * 1.7) * Math.sin(t * 2.3 + 1));
    const mx = (a, b, u) => a + (b - a) * u;
    const g = ctx.createLinearGradient(0, H, 0, 0);
    g.addColorStop(0, `rgb(${mx(cool.r, hot.r, heat) * k | 0},${mx(cool.g, hot.g, heat) * k | 0},${mx(cool.b, hot.b, heat) * k | 0})`);
    g.addColorStop(1, `rgb(${cool.r * k * 0.5 | 0},${cool.g * k * 0.5 | 0},${cool.b * k * 0.5 | 0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // Langues de feu aléatoires à la base
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = Math.random() * W, w = W * (0.05 + Math.random() * 0.1);
      const h = H * (0.15 + Math.random() * 0.35);
      const gg = ctx.createLinearGradient(0, H, 0, H - h);
      gg.addColorStop(0, `rgba(${hot.r},${hot.g},${hot.b},${0.14 * k})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.fillRect(x - w / 2, H - h, w, h);
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  // — Rythmiques —
  police(ctx, W, H, t, p, st) {
    const a = _fxHexRgb(p.color1 || '#ff2020');
    const b = _fxHexRgb(p.color2 || '#2040ff');
    const k = p.intensity / 100;
    const phase = Math.floor(t * (p.speed || 3) * 2) % 2;
    const L = phase ? a : b, R = phase ? b : a;
    ctx.fillStyle = `rgb(${L.r * k | 0},${L.g * k | 0},${L.b * k | 0})`; ctx.fillRect(0, 0, W / 2, H);
    ctx.fillStyle = `rgb(${R.r * k | 0},${R.g * k | 0},${R.b * k | 0})`; ctx.fillRect(W / 2, 0, W - W / 2, H);
  },
  lightning(ctx, W, H, t, p, st) {
    const rest = _fxHexRgb(p.color2 || '#03030a');
    const flash = _fxHexRgb(p.color1 || '#f4f0ff');
    if (st.next == null) st.next = t + 0.8;
    let on = false;
    if (st.until != null && t < st.until) {
      on = (Math.sin(t * 60 + (st.seed || 0)) > -0.2) && Math.random() > 0.25;
    } else if (t >= st.next) {
      st.until = t + 0.15 + Math.random() * 0.5;
      st.seed = Math.random() * 100;
      st.next = st.until + (0.6 + Math.random() * 2.4) / Math.max(0.05, p.speed || 0.8);
    }
    const k = p.intensity / 100;
    ctx.fillStyle = on
      ? `rgb(${flash.r * k | 0},${flash.g * k | 0},${flash.b * k | 0})`
      : `rgb(${rest.r},${rest.g},${rest.b})`;
    ctx.fillRect(0, 0, W, H);
  },
  paparazzi(ctx, W, H, t, p, st) {
    const rest = _fxHexRgb(p.color2 || '#080808');
    const flash = _fxHexRgb(p.color1 || '#fffce6');
    const burst = Math.max(1, p.count || 3);
    if (st.plan == null || t >= st.planEnd) {
      // planifie la prochaine rafale : intervalles [début, fin] de chaque flash
      let tt = t + (0.3 + Math.random() * 0.8) / Math.max(0.2, p.speed || 1);
      st.plan = [];
      for (let i = 0; i < burst; i++) { st.plan.push([tt, tt + 0.03 + Math.random() * 0.05]); tt += 0.09 + Math.random() * 0.13; }
      st.planEnd = tt + 0.2;
    }
    const on = st.plan.some(w => t >= w[0] && t < w[1]);
    const k = p.intensity / 100;
    ctx.fillStyle = on
      ? `rgb(${flash.r * k | 0},${flash.g * k | 0},${flash.b * k | 0})`
      : `rgb(${rest.r},${rest.g},${rest.b})`;
    ctx.fillRect(0, 0, W, H);
  },
  pulse(ctx, W, H, t, p, st) {
    const hi = _fxHexRgb(p.color1 || '#ffffff');
    const lo = _fxHexRgb(p.color2 || '#000000');
    const bpm = Math.max(10, p.speed || 60);
    const u = (Math.sin(t * bpm / 60 * 2 * Math.PI - Math.PI / 2) + 1) / 2;
    const e = Math.pow(u, 1.6) * p.intensity / 100;
    ctx.fillStyle = `rgb(${lo.r + (hi.r - lo.r) * e | 0},${lo.g + (hi.g - lo.g) * e | 0},${lo.b + (hi.b - lo.b) * e | 0})`;
    ctx.fillRect(0, 0, W, H);
  },
  traffic(ctx, W, H, t, p, st) {
    const night = _fxHexRgb(p.color2 || '#050508');
    const beam = _fxHexRgb(p.color1 || '#ffb054');
    ctx.fillStyle = `rgb(${night.r},${night.g},${night.b})`; ctx.fillRect(0, 0, W, H);
    if (st.cars == null) st.cars = [];
    if (st.next == null) st.next = t + 0.8;
    if (t >= st.next) {
      st.cars.push({ t0: t, dirR: Math.random() < 0.5, dur: 1.1 + Math.random() * 0.9 });
      st.next = t + (0.4 + Math.random() * 1.6) / Math.max(0.05, p.speed || 0.3);
    }
    st.cars = st.cars.filter(c => t - c.t0 < c.dur);
    ctx.globalCompositeOperation = 'lighter';
    const k = p.intensity / 100;
    for (const c of st.cars) {
      const u = (t - c.t0) / c.dur;
      const x = (c.dirR ? u : 1 - u) * (W * 1.6) - W * 0.3;
      const w = W * 0.35;
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, `rgba(${beam.r},${beam.g},${beam.b},${0.75 * k * Math.sin(u * Math.PI)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  weld(ctx, W, H, t, p, st) {
    const rest = _fxHexRgb(p.color2 || '#05060a');
    const arc = _fxHexRgb(p.color1 || '#cfe4ff');
    if (st.next == null) st.next = t + 0.5;
    let on = false;
    if (st.until != null && t < st.until) on = Math.random() > 0.35; // crépitement de l'arc
    else if (t >= st.next) {
      st.until = t + 0.3 + Math.random() * 1.2;
      st.next = st.until + (0.3 + Math.random() * 1.5) / Math.max(0.2, p.speed || 1.5);
    }
    const k = p.intensity / 100;
    if (on) {
      const v = 0.6 + Math.random() * 0.4;
      ctx.fillStyle = `rgb(${arc.r * k * v | 0},${arc.g * k * v | 0},${arc.b * k * v | 0})`;
    } else ctx.fillStyle = `rgb(${rest.r},${rest.g},${rest.b})`;
    ctx.fillRect(0, 0, W, H);
  },
  neon(ctx, W, H, t, p, st) {
    const c = _fxHexRgb(p.color1 || '#ff2e88');
    if (st.mode == null) { st.mode = 'on'; st.next = t + 2; }
    if (t >= st.next) {
      if (st.mode === 'on') {
        st.mode = Math.random() < 0.6 ? 'drop' : 'stutter';
        st.next = t + (st.mode === 'drop' ? 0.05 + Math.random() * 0.35 : 0.4 + Math.random() * 0.5);
        st.seed = Math.random() * 10;
      } else {
        st.mode = 'on';
        st.next = t + (0.5 + Math.random() * 3.5) / Math.max(0.2, p.speed || 1.5);
      }
    }
    let v;
    if (st.mode === 'drop') v = 0.02;
    else if (st.mode === 'stutter') v = (Math.sin(t * 55 + st.seed) > 0 && Math.random() > 0.3) ? 1 : 0.05;
    else v = 0.92 + Math.random() * 0.08; // grésillement permanent léger
    const k = v * p.intensity / 100;
    ctx.fillStyle = `rgb(${c.r * k | 0},${c.g * k | 0},${c.b * k | 0})`;
    ctx.fillRect(0, 0, W, H);
  },
  // — Spatiaux —
  chaser(ctx, W, H, t, p, st) {
    // Bande lumineuse (color1) qui PASSE sur le fond (color2), en comète :
    // avant net, corps plein, puis traîne lumineuse qui décroît
    // progressivement derrière la fin de la bande. Le dégradé est borné
    // (alpha 0 aux deux extrémités) : rien ne s'allume devant la bande,
    // donc aucun claquement au rebouclage.
    const col = _fxHexRgb(p.color1 || '#ffffff');
    const bg = _fxHexRgb(p.color2 || '#05050a');
    const n = Math.max(1, p.count || 3);
    const k = p.intensity / 100;
    const w = Math.max(0.01, (p.width != null ? p.width : 8) / 100); // largeur de bande
    const hw = w / 2;
    const ramp = Math.max(0.02, ((p.fade != null ? p.fade : 250) / 600) * 0.8); // traîne arrière
    const EDGE = Math.max(0.005, ((p.lead || 0) / 600) * 0.8); // traîne avant (fader)
    const wing = Math.max(1, Math.min(4, p.wing || 1));
    const bounce = p.mode === 'bounce';
    // Angle = base de la direction (H/V/diag) + fader de rotation
    const dir = p.dir || 'h';
    const rot = ((p.rot || 0) * Math.PI / 180)
              + (dir === 'v' ? Math.PI / 2 : dir === 'd' ? Math.PI / 4 : 0);
    // Espace tourné autour du centre : on dessine dans un carré D×D
    // (D = diagonale) pour couvrir les coins quel que soit l'angle.
    const D = Math.sqrt(W * W + H * H);
    const shape = p.shape || 'band';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgb(${bg.r},${bg.g},${bg.b})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    // Course loop étendue : la forme entre puis sort ENTIÈREMENT de l'écran
    // (marge = la plus longue des deux traînes, valable dans les deux sens)
    const M = hw + Math.max(EDGE, ramp) + 0.01;
    const cStart = -M, cEnd = 1 + M, span = cEnd - cStart;
    const L = EDGE + w + ramp; // longueur totale du profil lumineux
    // Position + sens de déplacement d'un élément (bande ou anneau)
    const travel = (i) => {
      const raw = t * (p.speed || 1) * 0.35 + (i / n) * (bounce ? 2 : 1);
      let c, fwd;
      if (bounce) { const ph = raw % 2; fwd = ph < 1; c = fwd ? ph : 2 - ph; }
      else { fwd = true; c = cStart + (raw % 1) * span; }
      if (p.invert) { c = 1 - c; fwd = !fwd; }
      return { c, sgn: fwd ? 1 : -1 };
    };
    if (shape === 'band') {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(rot);
      ctx.translate(-D / 2, -D / 2);
      for (let s = 0; s < wing; s++) {
        ctx.save();
        // Wing : l'axe est découpé en sections miroir alternées
        const mirror = s % 2 === 1;
        const Ds = D / wing;
        ctx.translate(s * Ds + (mirror ? Ds : 0), 0);
        ctx.scale((mirror ? -1 : 1) * Ds / D, 1);
        for (let i = 0; i < n; i++) {
          const { c, sgn } = travel(i);
          // Profil : 0 devant (traîne avant) → plein sur la bande →
          // décroissance sur la traîne arrière → 0 (borné des deux côtés)
          const a = c + sgn * (hw + EDGE);
          const b = c - sgn * (hw + ramp);
          const g = ctx.createLinearGradient(a * D, 0, b * D, 0);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(Math.min(1, EDGE / L), `rgba(${col.r},${col.g},${col.b},${k})`);
          g.addColorStop(Math.min(1, (EDGE + w) / L), `rgba(${col.r},${col.g},${col.b},${k})`);
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g; ctx.fillRect(0, 0, D, D);
        }
        ctx.restore();
      }
    } else {
      // Formes radiales : rond ou losange, du centre (out) ou des bords (in)
      const cx = W / 2, cy = H / 2;
      const Rmax = Math.sqrt(W * W + H * H) / 2;
      const outward = p.dir !== 'in';
      // Luminosité du profil à un rayon donné (rc = centre de l'anneau)
      const alphaAt = (r, rc, sgnR) => {
        const d = (r - rc) * sgnR;
        if (d >= hw + EDGE || d <= -(hw + ramp)) return 0;
        if (d >= hw) return k * (1 - (d - hw) / Math.max(EDGE, 0.001));
        if (d <= -hw) return k * (1 + (d + hw) / Math.max(ramp, 0.001));
        return k;
      };
      for (let i = 0; i < n; i++) {
        const tr = travel(i);
        const rc = outward ? tr.c : 1 - tr.c;          // rayon du centre de l'anneau
        const sgnR = outward ? tr.sgn : -tr.sgn;        // sens de déplacement radial
        let rIn = Math.max(0, rc - (hw + Math.max(EDGE, ramp)));
        let rOut = Math.min(1.35, rc + hw + Math.max(EDGE, ramp));
        if (rOut <= 0.002 || rOut - rIn < 0.002) continue;
        if (shape === 'circle') {
          const g = ctx.createRadialGradient(cx, cy, rIn * Rmax, cx, cy, rOut * Rmax);
          const pts = [rIn, rc - hw, rc - hw / 2, rc, rc + hw / 2, rc + hw, rOut];
          let last = -1;
          for (const r of pts) {
            if (r < rIn || r > rOut) continue;
            let sp = (r - rIn) / (rOut - rIn);
            if (sp <= last) sp = last + 0.0001;
            if (sp > 1) break;
            last = sp;
            g.addColorStop(sp, `rgba(${col.r},${col.g},${col.b},${Math.max(0, Math.min(1, alphaAt(r, rc, sgnR)))})`);
          }
          ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        } else {
          // Losange : anneaux concentriques tracés par couches successives
          const steps = 18;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(rot);
          const lw = (rOut - rIn) * Rmax / steps * 1.25;
          for (let s2 = 0; s2 < steps; s2++) {
            const r = rIn + (rOut - rIn) * (s2 + 0.5) / steps;
            const a = alphaAt(r, rc, sgnR);
            if (a <= 0.004) continue;
            const R = Math.max(0.5, r * Rmax);
            ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},${Math.min(1, a)})`;
            ctx.lineWidth = lw;
            ctx.beginPath();
            ctx.moveTo(0, -R); ctx.lineTo(R, 0); ctx.lineTo(0, R); ctx.lineTo(-R, 0);
            ctx.closePath();
            ctx.stroke();
          }
          ctx.restore();
        }
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  },
  noise(ctx, W, H, t, p, st) {
    const fps = Math.max(1, p.speed || 12);
    if (st.next != null && t < st.next) return; // conserve la frame précédente
    st.next = t + 1 / fps;
    const tint = _fxHexRgb(p.color1 || '#ffffff');
    const g = Math.max(2, p.count || 8);
    const k = p.intensity / 100;
    for (let y = 0; y < H; y += g) {
      for (let x = 0; x < W; x += g) {
        const v = Math.random() * k;
        ctx.fillStyle = `rgb(${tint.r * v | 0},${tint.g * v | 0},${tint.b * v | 0})`;
        ctx.fillRect(x, y, g, g);
      }
    }
  },
  aurora(ctx, W, H, t, p, st) {
    const c1 = _fxHexRgb(p.color1 || '#20e0a0');
    const c2 = _fxHexRgb(p.color2 || '#3040ff');
    const k = p.intensity / 100, s = p.speed || 0.3;
    ctx.fillStyle = '#020208'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const blobs = [
      { c: c1, x: 0.5 + 0.4 * Math.sin(t * s),            y: 0.4 + 0.3 * Math.sin(t * s * 0.7 + 2), r: 0.75 },
      { c: c2, x: 0.5 + 0.4 * Math.sin(t * s * 0.6 + 4),  y: 0.6 + 0.3 * Math.sin(t * s * 0.9 + 1), r: 0.85 },
      { c: c1, x: 0.5 + 0.45 * Math.sin(t * s * 0.45 + 7),y: 0.5 + 0.35 * Math.sin(t * s * 1.2 + 5), r: 0.6 },
    ];
    for (const b of blobs) {
      const g = ctx.createRadialGradient(b.x * W, b.y * H, 0, b.x * W, b.y * H, b.r * W);
      g.addColorStop(0, `rgba(${b.c.r},${b.c.g},${b.c.b},${0.5 * k})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  water(ctx, W, H, t, p, st) {
    const wat = _fxHexRgb(p.color1 || '#25c8e8');
    const deep = _fxHexRgb(p.color2 || '#021620');
    const s = (p.speed || 0.8) * 2, k = p.intensity / 100;
    const cell = 6;
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const v = Math.sin(x * 0.11 + t * s) * Math.sin(y * 0.13 - t * s * 0.8)
                + Math.sin((x + y) * 0.07 + t * s * 1.3);
        const u = Math.max(0, Math.min(1, 0.5 + v * 0.35)) * k;
        ctx.fillStyle = `rgb(${deep.r + (wat.r - deep.r) * u | 0},${deep.g + (wat.g - deep.g) * u | 0},${deep.b + (wat.b - deep.b) * u | 0})`;
        ctx.fillRect(x, y, cell, cell);
      }
    }
  },
};

// Moteur branché sur le canvas plein écran de l'écran de jeu
const _screenFxR = makeFxRenderer('screen-fx-canvas');

// Paramètres reçus du réseau, bornés selon les plages de EFFECT_CONFIG (et
// des curseurs de la télécommande) AVANT tout rendu : un message forgé
// (ex. Paparazzi à 1e9 flashes, 1e6 bandes de chaser) ne peut plus geler
// l'écran. Valeur absente ou invalide → omise (défaut de l'effet).
const _FX_ENUMS = { dir: ['h', 'v', 'd', 'in', 'out'], shape: ['band', 'circle', 'diamond'], mode: ['loop', 'bounce'] };
const _FX_RANGES = { intensity: [0, 100], chaos: [0, 100], drift: [0, 100], width: [1, 60], wing: [1, 4],
  rot: [0, 359], lead: [0, 600], fade: [0, 600], smooth: [0, 100] };
const FX_MAX_COUNT = 32, FX_MAX_BLOCKS = 8;
function _fxSanitizeParams(name, p) {
  const cfg = EFFECT_CONFIG[name] || {};
  const src = (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
  const out = {};
  const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v)) ? Math.min(max, Math.max(min, v)) : undefined;
  const put = (k, v) => { if (v !== undefined) out[k] = v; };
  if (cfg.min != null) put('speed', num(src.speed, cfg.min, cfg.max));
  for (const k in _FX_RANGES) put(k, num(src[k], _FX_RANGES[k][0], _FX_RANGES[k][1]));
  // Quantité (bandes ≤ 12, flashes ≤ 10, grain 2–32) : plage propre à l'effet
  if (cfg.count) put('count', num(src.count, cfg.count.min, Math.min(cfg.count.max, FX_MAX_COUNT)));
  for (const k in _FX_ENUMS) if (_FX_ENUMS[k].includes(src[k])) out[k] = src[k];
  if (typeof src.invert === 'boolean') out.invert = src.invert;
  for (const k of ['color1', 'color2']) if (typeof src[k] === 'string' && /^#[0-9a-f]{6}$/i.test(src[k])) out[k] = src[k];
  if (Array.isArray(src.blocks)) {
    const b = src.blocks.slice(0, FX_MAX_BLOCKS).filter((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));
    if (b.length) out.blocks = b;
  }
  return out;
}

function receiveEffect(msg) {
  if (!msg.active) {
    stopScreenEffect();
    const sc = document.getElementById('screen-mode');
    if (sc) { sc.style.transition = 'background-color 0.4s'; sc.style.backgroundColor = screenBaseColor; }
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(EFFECT_CONFIG, msg.name) || !FX_LIB[msg.name]) return; // effet inconnu
  _screenEffect = msg.name;
  _screenFxParams = _fxSanitizeParams(msg.name, msg.params);
  if (_screenFxSuspended) return; // strobe en cours : reprendra à la fin
  if (_screenFxR.current() === msg.name) _screenFxR.update(_screenFxParams);
  else _screenFxR.start(msg.name, _screenFxParams);
}

function stopScreenEffect() {
  _screenFxR.stop();
  _screenEffect = null;
  _screenFxParams = null;
}

// Le strobe masque le canvas d'effet pendant qu'il flashe, puis le relance
function suspendScreenFx(on) {
  _screenFxSuspended = !!on;
  if (on) _screenFxR.stop();
  else if (_screenEffect) _screenFxR.start(_screenEffect, _screenFxParams || {});
}

