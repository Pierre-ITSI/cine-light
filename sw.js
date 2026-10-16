/* Service Worker — SetRemote PWA */
const CACHE = 'setremote-v65';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  // Politique de confidentialité (Réglages) : lisible hors ligne ; sans copie, le repli
  // des navigations (index.html) afficherait l'app elle-même dans le cadre de la politique
  './confidentialite.html',
  './privacy.html',
  './vendor/mqtt-5.16.1.min.js', // version figée, servie depuis notre origine
  // QR d'appairage généré sur l'appareil (qrcode-generator, MIT, figé)
  './vendor/qrcode-generator-2.0.4.js',
  // Décodeur de QR (jsQR, Apache-2.0, figé) : scan sans BarcodeDetector (iPhone…)
  './vendor/jsqr-1.4.0.js',
  // Polices auto-hébergées (plus de Google Fonts) : disponibles hors ligne
  './vendor/fonts/dm-mono-latin-300-normal.woff2',
  './vendor/fonts/dm-mono-latin-ext-300-normal.woff2',
  './vendor/fonts/dm-mono-latin-400-normal.woff2',
  './vendor/fonts/dm-mono-latin-ext-400-normal.woff2',
  './vendor/fonts/dm-mono-latin-500-normal.woff2',
  './vendor/fonts/dm-mono-latin-ext-500-normal.woff2',
  './vendor/fonts/lato-latin-400-normal.woff2',
  './vendor/fonts/lato-latin-ext-400-normal.woff2',
  './vendor/fonts/lato-latin-700-normal.woff2',
  './vendor/fonts/lato-latin-ext-700-normal.woff2',
];
// Seules les ressources de notre origine sont mises en cache : aucune origine
// tierce (le QR d'appairage est dessiné sur l'appareil, plus aucun service en ligne).

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll échoue si une seule requête échoue → on tolère les manques (offline)
      Promise.allSettled(SHELL.map((u) => c.add(u)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Ne pas intercepter les WebSockets / autres schémas
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Navigations : réseau d'abord, repli cache → permet les mises à jour.
  // Seule la page d'accueil réussie remplace la copie hors-ligne (pas une 404,
  // ni une autre page).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const isApp = url.origin === self.location.origin &&
            /\/(index\.html)?$/.test(url.pathname);
          if (res.ok && isApp) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  const cacheable = url.origin === self.location.origin;

  // Autres ressources : cache d'abord, repli réseau (+ mise en cache opportuniste)
  e.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req)
        .then((res) => {
          if (cacheable && res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached)
    )
  );
});
