// Friend leaderboard — computed CLIENT-SIDE from data js/friends.js already
// subscribes to (window.bj21GetFriends()) plus the current user's own live
// chip balance. No separate Firestore collection or query: see
// firebase-layer.md's "Friend leaderboards" note — cheapest option when a
// metric only needs ranking within a small circle.
//
// subscribeLeaderboard()/cleanupLeaderboard() exist only so js/firebase.js's
// symmetric auth fan-out has a matching pair to call; there is no listener of
// our own to start or stop here, just a re-render.

function subscribeLeaderboard() {
    renderLeaderboard();
}
window.subscribeLeaderboard = subscribeLeaderboard;

function cleanupLeaderboard() {
    renderLeaderboard();
}
window.cleanupLeaderboard = cleanupLeaderboard;

function _ownLeaderboardEntry() {
    // window.bj21Chips (js/blackjack.js) is the live in-session balance —
    // prefer it over window.bj21UserDoc.score, which only updates on the
    // cadence of pushScore() and can lag mid-session.
    const chips = typeof window.bj21Chips === 'number'
        ? window.bj21Chips
        : (window.bj21UserDoc && window.bj21UserDoc.score) || 0;
    return { displayName: 'You', score: chips, self: true };
}

function rankedLeaderboard() {
    const friends = window.bj21GetFriends ? window.bj21GetFriends() : [];
    const entries = window.bj21User ? friends.concat([_ownLeaderboardEntry()]) : friends.slice();
    return entries.sort(function(a, b) { return (b.score || 0) - (a.score || 0); });
}

function renderLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    rankedLeaderboard().forEach(function(entry, i) {
        const row = document.createElement('div');
        row.className = 'leaderboard-row' + (entry.self ? ' me' : '');

        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(i + 1);

        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = entry.self ? 'You' : (entry.displayName || 'Player');

        const score = document.createElement('span');
        score.className = 'leaderboard-score';
        score.textContent = '$' + (entry.score || 0);

        row.appendChild(rank);
        row.appendChild(name);
        row.appendChild(score);
        listEl.appendChild(row);
    });
}
window.renderLeaderboard = renderLeaderboard;
