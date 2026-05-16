// Limpador de cache legado do Garcom.
// O cardapio precisa refletir o painel admin em tempo real, entao nao usamos cache offline aqui.
const CACHE_PREFIX = 'dom-leonardo-garcom-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key))))
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => Promise.all(clients.map(client => client.navigate(client.url).catch(() => {}))))
      .then(() => self.registration.unregister())
  );
});
