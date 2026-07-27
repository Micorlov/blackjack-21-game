// Lazy, OPTIONAL Firebase auth + Firestore. The core of the app must never
// depend on this: a signed-out user, a blocked CDN, or no network at all should
// still get a fully working app — only the social layer goes dark.

// {{FIREBASE_CONFIG}} — replace with the real config object from
// Firebase Console -> Project settings -> Your apps -> Web app -> SDK setup.
// This is a public client config (not a secret), but it is still per-project,
// so it must be filled in per app. sw.js needs the SAME object.
// Left as `null` until then: an unresolved `{{...}}` placeholder is not valid
// JS, and since build.js concatenates every module into ONE <script> tag, a
// syntax error here would fail to parse and take the entire app down with it
// (not just the social layer) — `null` keeps this file parseable and simply
// runs the app in offline mode until a real config is filled in.
const firebaseConfig = null;

// Nullable on purpose. Every consumer checks `if (!db) return;` — that is what
// makes "works fully offline without Firebase" true rather than aspirational.
let auth = null;
let db = null;
try {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK failed to load (offline or blocked CDN)');
    if (!firebaseConfig) throw new Error('Firebase config not set — running in offline mode');
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    try {
        // Offline cache + cross-tab sync. Rejects when several tabs are open or
        // the browser doesn't support it — neither is fatal, so swallow it.
        db.enablePersistence({ synchronizeTabs: true }).catch(function() { /* multi-tab or unsupported */ });
    } catch (e) { /* older browser — online-only */ }
} catch (e) {
    console.warn('Firebase unavailable, continuing in offline mode:', e);
}

// Wrap EVERY Firestore call. Handles both a synchronous throw and a rejected
// promise, so a backend failure can never break a UI flow; the optional
// `fallback` receives the error if the caller wants to react. Keep verbatim.
function firebaseSafe(operation, fallback) {
    try {
        const result = operation();
        if (result && typeof result.catch === 'function') {
            return result.catch(function(err) {
                if (typeof fallback === 'function') fallback(err);
                return null;
            });
        }
        return result;
    } catch (err) {
        if (typeof fallback === 'function') fallback(err);
        return null;
    }
}

// --- Remote feature flags (admin-controlled via the config/features doc) ---
// Lets a feature be killed in production without a redeploy. DEFAULT_FEATURES
// is the offline/first-paint answer; the remote doc merges over it when it
// arrives. APP-SPECIFIC: replace these with this app's real toggles.
const DEFAULT_FEATURES = {
    social: true,        // friends / invites
    leaderboard: true,
    push: true
};
window.bj21Features = Object.assign({}, DEFAULT_FEATURES);

// Called twice: once immediately with defaults (so the UI is never blank while
// the network round-trips) and again when the remote doc lands.
function applyFeatureFlags() {
    const f = window.bj21Features;
    // APP-SPECIFIC: hide/show the surfaces each flag governs.
    const navSocial = document.getElementById('nav-social');
    if (navSocial) navSocial.classList.toggle('hidden', !f.social);
}

function loadFeatureConfig() {
    applyFeatureFlags();
    if (!db) return;
    firebaseSafe(function() {
        return db.collection('config').doc('features').get().then(function(doc) {
            if (doc.exists) {
                window.bj21Features = Object.assign({}, DEFAULT_FEATURES, doc.data());
            }
            applyFeatureFlags();
        });
    });
}
loadFeatureConfig();

// --- Share links ---
// {{SHARE_BASE_URL}} — the canonical public URL, e.g. the GitHub Pages one.
// Needed because inside the native shell window.location is capacitor://… or
// https://localhost, neither of which is shareable.
const SHARE_BASE_URL = 'https://micorlov.github.io/blackjack-21-game/';

function getShareBaseUrl() {
    const origin = window.location.origin || '';
    if (origin === 'https://localhost' || origin.startsWith('capacitor://')) {
        return SHARE_BASE_URL;
    }
    return origin + window.location.pathname;
}

// Charset excludes I/O/0/1 — codes get read aloud, typed from screenshots and
// re-keyed by hand, so ambiguous glyphs cost real joins.
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    return code;
}

function isNativeApp() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
window.isNativeApp = isNativeApp;

// Sign-in can be triggered from #signin-modal OR from an onboarding overlay —
// surface the error in whichever is actually visible, otherwise a failure
// during onboarding is completely silent. Add ids here as entry points grow.
function clearSignInErrors() {
    ['signin-error', 'onboarding-signin-error'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function showSignInError(message) {
    ['signin-error', 'onboarding-signin-error'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) { el.textContent = message; el.classList.remove('hidden'); }
    });
}

function signInWithGoogle() {
    clearSignInErrors();

    // Offline mode (no/invalid firebaseConfig, blocked CDN, no network): `auth`
    // is null by design (see the top of this file), so every branch below that
    // touches it must be skipped rather than throwing on a signed-out user's
    // otherwise fully playable offline session.
    if (!auth) {
        showSignInError('Sign-in is unavailable right now — you can still play offline.');
        return;
    }

    if (isNativeApp()) {
        // Firebase's web popup/redirect auth does not work inside a native
        // WebView (no real popup window, no https origin). Use the native
        // Google Sign-In plugin, then hand its ID token to the Firebase JS SDK
        // so auth.currentUser and the Firestore security rules see the SAME
        // session as the web path.
        window.Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle().then(function(result) {
            const idToken = result && result.credential && result.credential.idToken;
            if (!idToken) throw new Error('No ID token returned from Google sign-in.');
            const credential = firebase.auth.GoogleAuthProvider.credential(idToken);
            return auth.signInWithCredential(credential);
        }).catch(function(err) {
            showSignInError(err.message || String(err));
        });
        return;
    }

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    // Popup first, redirect as fallback: iOS Safari and in-app browsers block
    // popups outright, and a blocked popup otherwise looks like a dead button.
    auth.signInWithPopup(provider).catch(function(popupErr) {
        if (popupErr.code === 'auth/popup-blocked' || popupErr.code === 'auth/popup-closed-by-user') {
            auth.signInWithRedirect(provider).catch(function(redirectErr) {
                showSignInError(redirectErr.message);
            });
        } else {
            showSignInError(popupErr.message);
        }
    });
}

function signOutUser() {
    if (isNativeApp()) {
        firebaseSafe(function() { return window.Capacitor.Plugins.FirebaseAuthentication.signOut(); });
    }
    if (auth) auth.signOut();
}
window.signOutUser = signOutUser;

// Completes the redirect leg of the popup-fallback above on page load.
if (auth) {
    auth.getRedirectResult().catch(function(err) {
        if (err && err.code !== 'auth/no-current-user') {
            showSignInError(err.message);
        }
    });
}

// The user profile document. APP-SPECIFIC FIELDS GO HERE.
// `score` is the generic stand-in for whatever single number this app ranks
// people by (points, streak, net profit, minutes...). Whatever you call it,
// keep ONE canonical numeric field: the leaderboard UI, the friends ranking and
// scripts/push/ all read the same one.
// `updatedAt` is load-bearing — the poller's incremental queries are
// `where('updatedAt', '>', since)`, so every write that should trigger a
// notification MUST stamp it.
function logUserToFirestore(user) {
    const ref = db.collection('users').doc(user.uid);
    return ref.set({
        uid: user.uid,
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        lastLogin: firebase.firestore.FieldValue.serverTimestamp()
        // APP-SPECIFIC: add profile fields here (level, avatar, preferences…)
    }, { merge: true }).then(function() {
        return ref.get();
    }).then(function(doc) {
        const data = doc.exists ? doc.data() : {};
        // Every user gets a stable invite code on first sign-in.
        if (!data.referralCode) {
            const code = generateRoomCode();
            return ref.update({ referralCode: code }).then(function() {
                window.bj21UserDoc = Object.assign({}, data, { referralCode: code });
            });
        }
        window.bj21UserDoc = data;
    });
}

// Pushes the app's canonical ranking number to the profile doc. Call this
// whenever the score changes. APP-SPECIFIC: rename `score` to suit, but keep
// the updatedAt stamp — the poller depends on it.
function pushScore(score) {
    if (!db || !window.bj21User) return;
    firebaseSafe(function() {
        return db.collection('users').doc(window.bj21User.uid).set({
            score: score,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}
window.pushScore = pushScore;

let _wasSignedIn = false;

// --- Auth fan-out ---
// The one place social features are started and stopped. Keep the two branches
// SYMMETRIC: anything started in the signed-in branch must have a matching
// stop/cleanup in the signed-out branch, or listeners leak across sessions and
// a second user sees the first user's data.
if (auth) {
    auth.onAuthStateChanged(function(user) {
        // Signals that Firebase has SETTLED the session. Before this fires,
        // window.bj21User is null even for a signed-in returning
        // user — so a deep link arriving at DOMContentLoaded must not read
        // "no user" as "signed out" and pop the sign-in modal.
        window._authResolved = true;
        window.bj21User = user || null;

        if (window.closeSignInModal) closeSignInModal();
        if (window.updateAccountUI) updateAccountUI();

        if (user) {
            _wasSignedIn = true;
            firebaseSafe(function() { return logUserToFirestore(user); });

            // Ask for push permission once, if onboarding never did.
            var pushAlreadyAsked = false;
            try { pushAlreadyAsked = localStorage.getItem('bj21_push_permission_asked') === '1'; } catch (e) {}
            if (!pushAlreadyAsked && window.bj21Features.push) {
                firebaseSafe(function() { return registerForPushNotifications(); });
            }

            if (window.bj21Features.social) {
                if (window.loadFriends) loadFriends();
                if (window.startPresence) startPresence();
            }
            if (window.bj21Features.leaderboard && window.subscribeLeaderboard) subscribeLeaderboard();

            // Replay any deep link that arrived before auth settled.
            if (window._pendingInviteCode && window.addFriendByInviteCode) {
                var code = window._pendingInviteCode;
                window._pendingInviteCode = null;
                addFriendByInviteCode(code);
            }
        } else {
            // SYMMETRIC teardown — one line here per start above.
            if (window.cleanupFriendsListeners) cleanupFriendsListeners();
            if (window.stopPresence) stopPresence();
            if (window.cleanupLeaderboard) cleanupLeaderboard();

            // A shared link that landed before auth settled: now that we know
            // the visitor is genuinely signed out, ask them to sign in. The
            // code stays parked and is replayed above on success.
            if (window._pendingInviteCode) {
                if (window.openSignInModal) openSignInModal();
                if (window.showToast) showToast('Sign in to continue');
            }

            // Native only: on a REAL sign-out (not the initial unauthenticated
            // state at cold start) re-show the sign-in step so the user can log
            // back in without restarting the app.
            if (_wasSignedIn && isNativeApp() && window.showOnboardingForReauth) {
                _wasSignedIn = false;
                showOnboardingForReauth();
            }
        }
    });
}
