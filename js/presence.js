// Presence — a 60s heartbeat writing users/{uid}.lastSeen, read back through
// isOnline() with a 2-minute window.
//
// Deliberately NOT Firebase Realtime Database onDisconnect: this stack is
// Firestore-only, and a coarse "seen in the last two minutes" dot is worth far
// less than a second database and its rules.
//
// Started/stopped from the auth fan-out in js/firebase.js (startPresence /
// stopPresence) — keep both sides symmetric or the interval outlives sign-out.

let presenceInterval = null;

const HEARTBEAT_MS = 60000;   // write cadence
const ONLINE_WINDOW_MS = 120000; // must be > HEARTBEAT_MS so a user is never
                                 // shown offline between two healthy beats

function _writeLastSeen(uid) {
    return firebaseSafe(function() {
        return db.collection('users').doc(uid).set({
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    });
}

function startPresence() {
    const user = window.bj21User;
    if (!user || !db) return;

    _writeLastSeen(user.uid);

    if (presenceInterval) clearInterval(presenceInterval);
    presenceInterval = setInterval(function() {
        const current = window.bj21User;
        // Self-healing: if the session ended without stopPresence() running,
        // the next tick tears the interval down itself.
        if (!current) { stopPresence(); return; }
        _writeLastSeen(current.uid);
    }, HEARTBEAT_MS);
}
window.startPresence = startPresence;

function stopPresence() {
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}
window.stopPresence = stopPresence;

// Accepts a Firestore Timestamp, a Date, or epoch millis — callers get lastSeen
// from snapshots, from cached plain objects, and from test fixtures.
function isOnline(lastSeen) {
    if (!lastSeen) return false;
    if (lastSeen.toDate) lastSeen = lastSeen.toDate();
    if (typeof lastSeen === 'number' || lastSeen instanceof Date) {
        const ms = typeof lastSeen === 'number' ? lastSeen : lastSeen.getTime();
        return (Date.now() - ms) < ONLINE_WINDOW_MS;
    }
    return false;
}
window.isOnline = isOnline;

// Capacitor lifecycle: beat immediately on foreground so a returning user shows
// online without waiting up to 60s for the next tick.
document.addEventListener('resume', function() {
    const user = window.bj21User;
    if (!user || !db) return;
    _writeLastSeen(user.uid);
});

// On background, do nothing on purpose — let the last heartbeat age out of the
// ONLINE_WINDOW_MS naturally. Writing an explicit "offline" marker would cost a
// write on every app switch and still be wrong when the app is killed outright.
document.addEventListener('pause', function() {});
