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

function _buildLeaderboardRow(entry, rank) {
    const row = document.createElement('div');
    row.className = 'leaderboard-row' + (entry.self ? ' me' : '');

    const rankEl = document.createElement('span');
    rankEl.className = 'leaderboard-rank';
    rankEl.textContent = String(rank);

    const name = document.createElement('span');
    name.className = 'leaderboard-name';
    name.textContent = entry.self ? 'You' : (entry.displayName || 'Player');

    const score = document.createElement('span');
    score.className = 'leaderboard-score';
    score.textContent = '$' + (entry.score || 0);

    row.appendChild(rankEl);
    row.appendChild(name);
    row.appendChild(score);
    return row;
}

function renderLeaderboard() {
    const listEl = document.getElementById('leaderboard-list');
    if (!listEl) return;

    listEl.innerHTML = '';
    rankedLeaderboard().forEach(function(entry, i) {
        listEl.appendChild(_buildLeaderboardRow(entry, i + 1));
    });
}
window.renderLeaderboard = renderLeaderboard;

// Compact version of the same ranking for the Home screen — see
// architecture.md's screen convention; this is deliberately a SEPARATE
// element from the Friends screen's #leaderboard-list rather than shared,
// since the two show a different number of rows.
const HOME_FRIENDS_MAX_ROWS = 5;

function renderHomeFriends() {
    const panel = document.getElementById('home-friends-panel');
    const listEl = document.getElementById('home-friends-list');
    if (!panel || !listEl) return;

    // Nothing meaningful to show signed out, or signed in with no friends
    // yet — hide the panel entirely rather than show a lone "You" row or an
    // empty state that just repeats what the Friends tab already explains.
    const ranked = rankedLeaderboard();
    const hasFriends = ranked.some(function(entry) { return !entry.self; });
    panel.classList.toggle('hidden', !hasFriends);
    if (!hasFriends) return;

    listEl.innerHTML = '';
    ranked.slice(0, HOME_FRIENDS_MAX_ROWS).forEach(function(entry, i) {
        listEl.appendChild(_buildLeaderboardRow(entry, i + 1));
    });
}
window.renderHomeFriends = renderHomeFriends;
