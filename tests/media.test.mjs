// Réception d'images en fragments côté écran (mediaImgStart / mediaImgChunk) :
// transferts parallèles entrelacés, doublons, désordre, plafonds, validation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, openPage } from './helpers/harness.mjs';

let browser, ctx, imgs;
before(async () => {
  browser = await launchBrowser();
  ctx = await openPage(browser);
  await ctx.page.evaluate(() => enterScreenMode('media'));
  // Vraies data-URL d'images (PNG/JPEG générées par canvas)
  imgs = await ctx.page.evaluate(() => ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'].map((col, i) => {
    const c = document.createElement('canvas'); c.width = 48 + i; c.height = 32;
    const g = c.getContext('2d'); g.fillStyle = col; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.fillText(String(i), 5, 20);
    return i % 2 ? c.toDataURL('image/jpeg', 0.8) : c.toDataURL('image/png');
  }));
});
after(async () => { await ctx?.close(); await browser?.close(); });

const split = (s, n) => { const size = Math.ceil(s.length / n), out = []; for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size)); return out; };

test('deux transferts parallèles entrelacés, désordonnés et dupliqués', async () => {
  const { page } = ctx;
  const A = split(imgs[0], 5), B = split(imgs[1], 7);
  const seq = [];
  seq.push({ type: 'media-img-start', id: 'tA', total: A.length, mediaId: 'mA', show: false });
  seq.push({ type: 'media-img-start', id: 'tB', total: B.length, mediaId: 'mB', show: true });
  // Entrelacement + ordre inversé pour B + doublons
  const order = [];
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    if (i < A.length) order.push({ type: 'media-img-chunk', id: 'tA', i, data: A[i] });
    const j = B.length - 1 - i;
    if (j >= 0) order.push({ type: 'media-img-chunk', id: 'tB', i: j, data: B[j] });
    if (i === 1) order.push({ type: 'media-img-chunk', id: 'tA', i: 0, data: 'CORROMPU-ignoré' }); // doublon
  }
  seq.push(...order);
  const r = await page.evaluate(([seq]) => {
    const pending = [];
    for (const m of seq) {
      if (m.type === 'media-img-start') mediaImgStart(m); else mediaImgChunk(m);
      pending.push(_imgBufs.size);
    }
    const im = document.getElementById('screen-media-img');
    return {
      bufs: _imgBufs.size, maxPar: Math.max(...pending),
      cacheA: _mediaCache.get('mA'), cacheB: _mediaCache.get('mB'),
      src: im.getAttribute('src'), shown: im.style.display, active: _screenActiveId,
    };
  }, [seq]);
  assert.equal(r.bufs, 0, 'tampons libérés');
  assert.equal(r.maxPar, 2);
  assert.deepEqual(r.cacheA, { kind: 'img', data: imgs[0] }, 'A reconstituée à l\'identique');
  assert.deepEqual(r.cacheB, { kind: 'img', data: imgs[1] });
  assert.equal(r.src, imgs[1], 'seule B (show:true) est affichée');
  assert.equal(r.shown, 'block');
  assert.equal(r.active, 'mB');
  // Le cache permet un affichage instantané de A
  const a = await page.evaluate(() => { screenShowCached('mA'); return [document.getElementById('screen-media-img').getAttribute('src'), _screenActiveId]; });
  assert.deepEqual(a, [imgs[0], 'mA']);
});

test('plafond de 4 transferts simultanés : le plus ancien est abandonné', async () => {
  const { page } = ctx;
  const parts = imgs.map((s) => split(s, 3));
  const r = await page.evaluate(([parts]) => {
    _mediaCache.clear();
    parts.forEach((p, k) => mediaImgStart({ id: 't' + k, total: p.length, mediaId: 'p' + k, show: false }));
    const sizeAfterStarts = _imgBufs.size;
    parts.forEach((p, k) => p.forEach((data, i) => mediaImgChunk({ id: 't' + k, i, data })));
    return { sizeAfterStarts, cached: [..._mediaCache.keys()].sort(), left: _imgBufs.size };
  }, [parts]);
  assert.equal(r.sizeAfterStarts, 4);
  assert.deepEqual(r.cached, ['p1', 'p2', 'p3', 'p4']);
  assert.equal(r.left, 0);
});

test('contenus et fragments non conformes ignorés', async () => {
  const { page } = ctx;
  const r = await page.evaluate(([png]) => {
    _mediaCache.clear();
    const out = {};
    // Pas une data-URL image → ignoré
    mediaImgStart({ id: 'bad', total: 1, mediaId: 'bad1', show: true });
    mediaImgChunk({ id: 'bad', i: 0, data: 'https://tracker.example/x.png' });
    out.badUrl = _mediaCache.has('bad1');
    // Data-URL avec injection CSS → ignoré
    mediaImgStart({ id: 'inj', total: 1, mediaId: 'inj1' });
    mediaImgChunk({ id: 'inj', i: 0, data: 'data:image/png;base64,AAA=") url("x' });
    out.inj = _mediaCache.has('inj1');
    // Totaux invalides
    mediaImgStart({ id: 'z', total: 0 }); mediaImgStart({ id: 'z2', total: 1e9 }); mediaImgStart({ id: 5, total: 2 });
    out.invalidStarts = ['z', 'z2', 5].filter((k) => _imgBufs.has(k)).length;
    // Index hors bornes / fragment trop long
    mediaImgStart({ id: 'ok', total: 2, mediaId: 'ok1' });
    mediaImgChunk({ id: 'ok', i: 2, data: 'x' }); mediaImgChunk({ id: 'ok', i: -1, data: 'x' });
    mediaImgChunk({ id: 'ok', i: 0.5, data: 'x' }); mediaImgChunk({ id: 'ok', i: 0, data: 'x'.repeat(20001) });
    out.okGot = _imgBufs.get('ok').got;
    // mediaId non conforme → transfert accepté mais non mis en cache sous cet id
    mediaImgStart({ id: 'id', total: 1, mediaId: '../../etc', show: false });
    mediaImgChunk({ id: 'id', i: 0, data: png });
    out.weirdId = [..._mediaCache.keys()];
    // Bande son : seule une data-URL audio est acceptée sous __callaudio
    mediaImgStart({ id: 'au', total: 1, mediaId: '__callaudio', show: true });
    mediaImgChunk({ id: 'au', i: 0, data: png });
    out.audioFromImg = _mediaCache.has('__callaudio');
    mediaImgStart({ id: 'au2', total: 1, mediaId: '__callaudio', show: true });
    mediaImgChunk({ id: 'au2', i: 0, data: 'data:audio/mpeg;base64,SUQzAAAA' });
    out.audio = _mediaCache.get('__callaudio');
    _imgBufs.clear();
    return out;
  }, [imgs[2]]);
  assert.deepEqual(r, {
    badUrl: false, inj: false, invalidStarts: 0, okGot: 0, weirdId: [],
    audioFromImg: false, audio: { kind: 'audio', data: 'data:audio/mpeg;base64,SUQzAAAA' },
  });
  assert.deepEqual(ctx.errors, []);
});
