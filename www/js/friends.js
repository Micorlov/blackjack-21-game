// Friends — mutual friend edges added by invite code, resolved into a live
// roster of each friend's own displayName/photoURL/score (chip balance).
// Also owns the invite-code deep-link flow (?ref=CODE). Exposes the merged
// roster via window.bj21GetFriends() so js/leaderboards.js can rank without
// running a second Firestore subscription — see architecture.md.

let _friendsEdgeUnsub = null;
let _friendDocUnsubs = {}; // friendUid -> unsubscribe function
let _friendsByUid = {};    // friendUid -> { uid, displayName, photoURL, score, ... }

function _friendsChanged() {
    renderFriendsScreen();
    if (window.renderLeaderboard) renderLeaderboard();
    if (window.renderHomeFriends) renderHomeFriends();
}

// The single source of truth js/leaderboards.js reads from — do not start a
// second subscription over the same data there.
function getFriendsList() {
    return Object.keys(_friendsByUid).map(function(uid) { return _friendsByUid[uid]; });
}
window.bj21GetFriends = getFriendsList;

function loadFriends() {
    const user = window.bj21User;
    if (!user || !db) return;

    cleanupFriendsListeners();

    _friendsEdgeUnsub = firebaseSafe(function() {
        return db.collection('users').doc(user.uid).collection('friends')
            .onSnapshot(function(snapshot) {
                const currentUids = {};
                snapshot.forEach(function(doc) { currentUids[doc.id] = true; });

                // Drop per-friend listeners for edges that no longer exist.
                Object.keys(_friendDocUnsubs).forEach(function(uid) {
                    if (currentUids[uid]) return;
                    _friendDocUnsubs[uid]();
                    delete _friendDocUnsubs[uid];
                    delete _friendsByUid[uid];
                });

                // Start a listener for every new edge so a friend's live chip
                // balance (not just their existence) drives the UI.
                Object.keys(currentUids).forEach(function(uid) {
                    if (_friendDocUnsubs[uid]) return;
                    _friendDocUnsubs[uid] = firebaseSafe(function() {
                        return db.collection('users').doc(uid).onSnapshot(function(friendDoc) {
                            if (friendDoc.exists) {
                                _friendsByUid[uid] = Object.assign({ uid: uid }, friendDoc.data());
                            } else {
                                delete _friendsByUid[uid];
                            }
                            _friendsChanged();
                        }, function() { /* silently ignore — firebaseSafe convention */ });
                    });
                });

                _friendsChanged();
            }, function() { /* silently ignore — see firebase-layer.md on firebaseSafe */ });
    });
}
window.loadFriends = loadFriends;

// Safe to call even when nothing was ever started (e.g. a fresh load that
// never signed in) — every unsubscribe is only invoked if it exists.
function cleanupFriendsListeners() {
    if (_friendsEdgeUnsub) { _friendsEdgeUnsub(); _friendsEdgeUnsub = null; }
    Object.keys(_friendDocUnsubs).forEach(function(uid) { _friendDocUnsubs[uid](); });
    _friendDocUnsubs = {};
    _friendsByUid = {};
    _friendsChanged();
}
window.cleanupFriendsListeners = cleanupFriendsListeners;

// DOM entry point: reads the code straight out of the Friends screen's own
// input, so index.html can wire the button with a bare onclick="addFriendByCode()".
function addFriendByCode() {
    const user = window.bj21User;
    if (!user) { if (window.openSignInModal) openSignInModal(); return Promise.resolve(false); }
    if (!db) return Promise.resolve(false);

    const input = document.getElementById('friend-code-input');
    const code = ((input && input.value) || '').trim().toUpperCase();
    if (!code) return Promise.resolve(false);

    const result = firebaseSafe(function() {
        return db.collection('users').where('referralCode', '==', code).limit(1).get().then(function(snap) {
            if (snap.empty) { showToast('No player found with that code.'); return false; }
            const friendUid = snap.docs[0].id;
            if (friendUid === user.uid) { showToast('That\'s your own code.'); return false; }

            const ownEdgeRef = db.collection('users').doc(user.uid).collection('friends').doc(friendUid);
            return ownEdgeRef.get().then(function(existing) {
                if (existing.exists) { showToast('Already friends.'); return false; }

                const addedAt = firebase.firestore.FieldValue.serverTimestamp();
                // MUTUAL WRITE: both sides of the edge, in one client operation.
                // This is exactly why firestore.rules' friends/{friendUid} rule
                // must accept request.auth.uid == friendUid as well as == uid —
                // see firebase-layer.md for the full "why".
                return Promise.all([
                    ownEdgeRef.set({ addedAt: addedAt }),
                    db.collection('users').doc(friendUid).collection('friends').doc(user.uid).set({ addedAt: addedAt })
                ]).then(function() {
                    showToast('Friend added!');
                    if (input) input.value = '';
                    return true;
                });
            });
        });
    }, function() { showToast('Could not add friend — try again.'); });

    // firebaseSafe only returns a non-promise (null) if `operation` threw
    // synchronously, which cannot happen here since db is already confirmed —
    // still, fall back to a resolved promise rather than calling .then() on
    // a possible null.
    return result || Promise.resolve(false);
}
window.addFriendByCode = addFriendByCode;

// Driven by ?ref=CODE arriving via handleIncomingInvite() below (or replayed
// by js/firebase.js's onAuthStateChanged from window._pendingInviteCode).
// Joining via a link connects the joiner to EVERY existing member of that
// link's circle, not just the link owner — referralGroups/{code}.members is
// the append-only roster that makes that possible. See firebase-layer.md.
function addFriendByInviteCode(code) {
    const user = window.bj21User;
    if (!user || !db) return;
    code = (code || '').trim().toUpperCase();
    if (!code) return;

    firebaseSafe(function() {
        return db.collection('users').where('referralCode', '==', code).limit(1).get().then(function(snap) {
            if (snap.empty) { showToast('No player found with that invite link.'); return; }
            const ownerUid = snap.docs[0].id;
            if (ownerUid === user.uid) { showToast('That\'s your own invite link.'); return; }

            const groupRef = db.collection('referralGroups').doc(code);
            return groupRef.get().then(function(groupDoc) {
                const members = groupDoc.exists ? (groupDoc.data().members || [ownerUid]) : [ownerUid];
                if (members.indexOf(user.uid) !== -1) { showToast('Already connected via this link.'); return; }

                const newFriendUids = members.filter(function(uid) { return uid !== user.uid; });
                return Promise.all(newFriendUids.map(function(friendUid) {
                    return db.collection('users').doc(user.uid).collection('friends').doc(friendUid).get()
                        .then(function(existing) {
                            if (existing.exists) return null;
                            // joinerUid marks which side of the edge is the NEW
                            // member, so a future poller can notify existing
                            // members about the joiner without also notifying
                            // the joiner about each of them.
                            const edge = {
                                addedAt: firebase.firestore.FieldValue.serverTimestamp(),
                                viaCode: code,
                                joinerUid: user.uid
                            };
                            return Promise.all([
                                db.collection('users').doc(user.uid).collection('friends').doc(friendUid).set(edge),
                                db.collection('users').doc(friendUid).collection('friends').doc(user.uid).set(edge)
                            ]);
                        });
                })).then(function() {
                    return groupRef.set({ members: members.concat([user.uid]) }, { merge: true });
                }).then(function() {
                    showToast(newFriendUids.length > 1
                        ? 'Connected with ' + newFriendUids.length + ' friends via this link!'
                        : 'Friend added!');
                });
            });
        });
    }, function() { showToast('Could not add friend — try again.'); });
}
window.addFriendByInviteCode = addFriendByInviteCode;

// Reads ?ref=CODE on page load (and again on a native warm-start deep link —
// see applyNativeDeepLinkUrl() in js/tabs.js). Auth may not have settled yet
// at this point, so the decision is deliberately narrow: only fire immediately
// when we KNOW there is a signed-in user; otherwise park the code and let
// js/firebase.js's onAuthStateChanged (which already handles both the
// signed-in replay and the signed-out sign-in prompt) pick it up. Duplicating
// that branching here risks ambushing an already-signed-in user with a
// sign-in modal before auth settles.
function handleIncomingInvite() {
    try {
        const params = new URLSearchParams(window.location.search);
        let refCode = params.get('ref');
        if (!refCode) return;
        refCode = refCode.trim().toUpperCase();
        if (!refCode) return;

        // Strip it from the URL so a refresh doesn't re-trigger the flow.
        if (window.history && window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('ref');
            window.history.replaceState({}, '', url);
        }

        if (window._authResolved && window.bj21User) {
            addFriendByInviteCode(refCode);
        } else {
            window._pendingInviteCode = refCode;
        }
    } catch (e) { /* URL parsing must never break page load */ }
}
window.handleIncomingInvite = handleIncomingInvite;

// Own invite link — share sheet with a clipboard fallback.
function shareInviteLink() {
    const user = window.bj21User;
    if (!user) { if (window.openSignInModal) openSignInModal(); return; }
    const code = window.bj21UserDoc && window.bj21UserDoc.referralCode;
    if (!code) { showToast('Your invite code isn\'t ready yet — try again in a moment.'); return; }

    const link = getShareBaseUrl() + '?ref=' + encodeURIComponent(code);

    if (navigator.share) {
        navigator.share({ title: 'Blackjack 21', text: 'Play Blackjack 21 with me!', url: link }).catch(function() {});
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(function() {
            showToast('Link copied');
        }).catch(function() {
            showToast('Could not copy link.');
        });
    } else {
        showToast('Could not copy link.');
    }
}
window.shareInviteLink = shareInviteLink;

function renderFriendsScreen() {
    const codeEl = document.getElementById('own-invite-code');
    if (codeEl) codeEl.textContent = (window.bj21UserDoc && window.bj21UserDoc.referralCode) || '------';

    const listEl = document.getElementById('friends-list');
    const emptyEl = document.getElementById('friends-empty');
    if (!listEl) return;

    const friends = getFriendsList().sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
    if (emptyEl) emptyEl.classList.toggle('hidden', friends.length > 0);

    listEl.innerHTML = '';
    friends.forEach(function(f) {
        const row = document.createElement('div');
        row.className = 'friend-row';

        const avatar = document.createElement('div');
        avatar.className = 'friend-avatar';
        avatar.textContent = (f.displayName || 'P').charAt(0).toUpperCase();

        const name = document.createElement('div');
        name.className = 'friend-name';
        name.textContent = f.displayName || 'Player';

        const score = document.createElement('div');
        score.className = 'friend-score';
        score.textContent = '$' + (f.score || 0);

        row.appendChild(avatar);
        row.appendChild(name);
        row.appendChild(score);
        listEl.appendChild(row);
    });
}
