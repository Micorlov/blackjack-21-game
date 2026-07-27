// Service worker: offline caching + background push handling.
//
// Firebase messaging SW must be imported for background push to work at all —
// the page-side SDK hands FCM messages to whichever SW registered the token.
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// CACHE VERSION BUMP PATTERN: increment this on EVERY deploy that changes any
// cached asset. The activate handler deletes every cache whose key !== this
// one, which is the only reliable way to evict a stale precached HTML bundle
// from a returning user's browser. Forgetting to bump it is the single most
// common cause of "my fix isn't live" on this stack.
const CACHE_NAME = 'bj21-cache-v1';
const ASSETS = [
  'blackjack21.html',
  'manifest.json',
  'icon.svg'
];

// {{FIREBASE_CONFIG}} — same object as js/firebase.js. Left as `null` until
// filled in: an unresolved `{{...}}` placeholder is not valid JS, and unlike
// js/firebase.js this file has no bundler-imposed reason to swallow the
// failure — but a broken Firebase init must still not take down install/
// activate/fetch below, which is what makes offline caching work at all.
const firebaseConfig = null;

let messaging = null;
try {
    if (!firebaseConfig) throw new Error('Firebase config not set — push disabled in this SW');
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
} catch (e) {
    console.warn('SW: Firebase messaging unavailable:', e);
}

// Background push notifications via FCM.
// scripts/lib/sendPush.js sends a `notification` payload (title/body), which
// FCM delivers on payload.notification — reading only payload.data made every
// web push fall back to the generic copy below and drop the sender's name.
// Read BOTH, notification first: the Admin SDK path populates .notification,
// while data-only sends (and any future silent/data pushes) populate .data.
if (messaging) {
  messaging.onBackgroundMessage(payload => {
    const data = payload.data || {};
    const notification = payload.notification || {};
    const title = notification.title || data.title || 'Blackjack 21';
    const options = {
      body: notification.body || data.body || 'You have a new notification!',
      icon: 'icon.svg',
      badge: 'icon.svg',
      vibrate: [100, 50, 100],
      tag: data.tag || 'bj21-notification',
      data: { url: data.url || 'blackjack21.html' }
    };
    return self.registration.showNotification(title, options);
  });
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // FIREBASE API BYPASS ALLOWLIST — these hosts must never be intercepted.
  // Firestore's streaming/long-poll channels, auth token refresh and FCM
  // registration all break in confusing, intermittent ways if a SW touches
  // them (cached auth responses, aborted streams, tokens that never refresh).
  // Add any other live-API host your app talks to here.
  if (
    event.request.url.includes('firestore.googleapis.com') ||
    event.request.url.includes('firebaseinstallations.googleapis.com') ||
    event.request.url.includes('identitytoolkit.googleapis.com') ||
    event.request.url.includes('fcmregistrations.googleapis.com') ||
    event.request.url.includes('fcm.googleapis.com')
  ) {
    return;
  }

  // NETWORK-FIRST for navigations: a returning user always gets the freshest
  // HTML bundle, with the cache as an offline fallback.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match('blackjack21.html')))
    );
    return;
  }

  // CACHE-FIRST for everything else (icons, fonts, media) — immutable enough
  // that a version bump is the right invalidation mechanism.
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Notification click — focus an already-open app window rather than opening a
// duplicate tab, falling back to openWindow when nothing is running.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'blackjack21.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes('blackjack21') && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});

// Legacy push fallback (non-FCM Web Push).
self.addEventListener('push', event => {
  let data = { title: 'Blackjack 21', body: 'You have a new notification!' };
  try { data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icon.svg',
      badge: 'icon.svg',
      vibrate: [100, 50, 100]
    })
  );
});
