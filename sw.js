// Garde l'app en cache pour qu'elle se recharge même sans réseau.
const CACHE = 'confessionnal-v1';
const SHELL = [
  './', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'js/db.js', 'js/cats.js',
  'assets/couple.png', 'assets/favicon.svg', 'assets/apple-touch-icon.png',
  'assets/fonts/dm-serif-display-latin-400-normal.woff2', 'assets/fonts/dm-serif-display-latin-400-italic.woff2',
  'assets/fonts/instrument-sans-latin-400-normal.woff2', 'assets/fonts/instrument-sans-latin-500-normal.woff2',
  'assets/fonts/instrument-sans-latin-600-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/.netlify/')) return;
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
