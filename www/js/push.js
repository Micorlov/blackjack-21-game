// Push notifications — native (Android/iOS via Capacitor) + web (Firebase
// Messaging + VAPID).
// Depends on: firebaseSafe()/db from js/firebase.js, window.bj21User
// from auth.onAuthStateChanged.
//
// Firestore schema:
//   users/{uid}/fcmTokens/{token} = { token, platform, updatedAt }
//   users/{uid}.notificationPrefs.<category>
// Categories must match the CATEGORY constants used by scripts/push/*.js.

// {{VAPID_KEY}} — Firebase Console -> Project settings -> Cloud Messaging ->
// Web Push certificates -> Key pair. Public key, safe to ship, but per-project.
const VAPID_KEY = '{{VAPID_KEY}}';

function registerForPushNotifications() {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
        // NATIVE path (Android / iOS via Capacitor). The plugin owns the OS
        // permission dialog; the token arrives asynchronously on the
        // 'registration' listener below, not from this call.
        const PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
        if (!PushNotifications) return;
        PushNotifications.requestPermissions().then(function(result) {
            if (result && result.receive === 'granted') PushNotifications.register();
        }).catch(function(err) { console.warn('Push permission request failed:', err); });
        return;
    }

    // WEB path — Firebase Messaging + VAPID. sw.js (registered by js/pwa.js)
    // already imports firebase-messaging-compat and handles onBackgroundMessage,
    // so the token must be bound to THAT registration.
    if (typeof firebase === 'undefined' || !firebase.messaging) return;
    Notification.requestPermission().then(function(permission) {
        if (permission !== 'granted') return;
        return navigator.serviceWorker.ready.then(function(swReg) {
            return firebase.messaging().getToken({
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: swReg
            });
        }).then(function(token) {
            if (token) saveFcmToken(token, 'web');
        });
    }).catch(function(err) { console.warn('Web push registration failed:', err); });

    try { localStorage.setItem('bj21_push_permission_asked', '1'); } catch (e) {}
}
window.registerForPushNotifications = registerForPushNotifications;

// Native always supports push; on web it depends on the browser (Safari only
// exposes it to installed PWAs, and firebase.messaging bails out entirely in
// unsupported ones). js/tabs.js uses this to decide whether the Settings
// notification panel is worth showing at all.
function isPushSupported() {
    if (window.isNativeApp && isNativeApp()) return true;
    return !!(window.Notification && navigator.serviceWorker &&
        typeof firebase !== 'undefined' && firebase.messaging &&
        firebase.messaging.isSupported && firebase.messaging.isSupported());
}
window.isPushSupported = isPushSupported;

// One doc per device token, keyed BY the token — re-registering the same device
// is idempotent, and scripts/lib/sendPush.js deletes docs whose token FCM
// reports as unregistered.
function saveFcmToken(token, platform) {
    if (!window.bj21User || typeof db === 'undefined' || !db) return;
    var p = platform || (window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : 'web');
    firebaseSafe(function() {
        return db.collection('users').doc(window.bj21User.uid)
            .collection('fcmTokens').doc(token)
            .set({
                token: token,
                platform: p,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
    });
}

// Per-category mute. Absent means enabled — sendPush.js only skips on an
// explicit `false`, so a brand-new category is opt-out, not opt-in.
function setNotificationPref(category, enabled) {
    if (!window.bj21User || typeof db === 'undefined' || !db) return;
    const prefs = {};
    prefs[category] = !!enabled;
    firebaseSafe(function() {
        return db.collection('users').doc(window.bj21User.uid)
            .set({ notificationPrefs: prefs }, { merge: true });
    });
}
window.setNotificationPref = setNotificationPref;

function initPushListeners() {
    if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
        return;
    }
    const PushNotifications = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications;
    if (!PushNotifications) return;

    PushNotifications.addListener('registration', function(token) {
        if (token && token.value) saveFcmToken(token.value);
    });

    PushNotifications.addListener('registrationError', function(err) {
        console.warn('Push registration error:', err);
    });

    // Tap handling. Start minimal — land on the screen where the notified
    // content lives — and only add per-category routing once categories
    // actually surface on different screens.
    PushNotifications.addListener('pushNotificationActionPerformed', function() {
        if (window.showScreen) showScreen('home');
    });
}
initPushListeners();
