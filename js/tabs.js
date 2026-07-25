// Screen switching, sub-tabs, theming, and the app's single bootstrap.
// Second-to-last in build.js jsFiles (only js/pwa.js comes after), because the
// DOMContentLoaded handler at the bottom calls into every other module.

// --- CONVENTION 1: screens ---
// One entry per <section id="screen-X"> / <button id="nav-X">. showScreen()
// toggles `active` on BOTH in lockstep, so the id suffixes must match the name
// passed here and used in index.html's onclick="showScreen('x')".
const SCREENS = ['home', 'stats', 'settings'];

function showScreen(name) {
    SCREENS.forEach(function(s) {
        const el = document.getElementById('screen-' + s);
        if (el) el.classList.toggle('active', s === name);
        const nav = document.getElementById('nav-' + s);
        if (nav) nav.classList.toggle('active', s === name);
    });
    // Re-render on entry rather than keeping every screen live — cheap, and it
    // guarantees a screen never shows stale data after a background update.
    if (name === 'stats') renderStatsScreen();
}
window.showScreen = showScreen;

// --- CONVENTION 2: sub-tabs ---
// Within a screen, a segmented control toggles `.selected` on the buttons and
// `.hidden` on the matching views. One helper drives both so the two can never
// drift apart.
//   ids: button = <prefix>-tab-<tab>, view = <prefix>-<tab>-view
function setSubTab(prefix, tabs, tab) {
    tabs.forEach(function(t) {
        const btn = document.getElementById(prefix + '-tab-' + t);
        if (btn) btn.classList.toggle('selected', t === tab);
        const view = document.getElementById(prefix + '-' + t + '-view');
        if (view) view.classList.toggle('hidden', t !== tab);
    });
}

const STATS_TABS = ['recent', 'alltime'];
let statsTab = 'recent';

function setStatsTab(tab) {
    statsTab = tab;
    setSubTab('stats', STATS_TABS, tab);
    renderStatsScreen();
}

// Reads window.bj21Stats, the single shape js/blackjack.js writes both its
// persisted fields (handsPlayed, wins, losses, pushes, blackjacks,
// currentStreak, bestStreak) and its session-only counters (sessionHands,
// sessionWins, sessionNet) onto.
function renderStatsScreen() {
    const stats = window.bj21Stats || {};
    const setText = function(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (statsTab === 'recent') {
        setText('stat-session-hands', String(stats.sessionHands || 0));
        setText('stat-session-wins', String(stats.sessionWins || 0));
        const net = stats.sessionNet || 0;
        setText('stat-session-net', (net > 0 ? '+$' : '$') + net);
    } else {
        const handsPlayed = stats.handsPlayed || 0;
        const winRate = handsPlayed > 0 ? Math.round((stats.wins || 0) / handsPlayed * 100) : 0;
        setText('stat-hands-played', String(handsPlayed));
        setText('stat-win-rate', winRate + '%');
        setText('stat-blackjacks', String(stats.blackjacks || 0));
        setText('stat-current-streak', String(stats.currentStreak || 0));
        setText('stat-best-streak', String(stats.bestStreak || 0));
    }
}

// --- CONVENTION 3: themes ---
// The first entry is the default and adds NO body class; every other theme adds
// `body.theme-<name>`, matching the override blocks in styles/tokens.css.
// Persisted under localStorage['bj21_theme'].
const THEMES = ['default', 'ocean', 'ember'];
const THEME_STORAGE_KEY = 'bj21_theme';

let currentTheme = THEMES[0];
try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && THEMES.includes(saved)) currentTheme = saved;
} catch (e) {}

function _paintTheme() {
    THEMES.slice(1).forEach(function(t) { document.body.classList.remove('theme-' + t); });
    if (currentTheme !== THEMES[0]) document.body.classList.add('theme-' + currentTheme);
    THEMES.forEach(function(t) {
        const btn = document.getElementById('theme-' + t);
        if (btn) btn.classList.toggle('selected', t === currentTheme);
    });
}

function setTheme(theme) {
    if (!THEMES.includes(theme) || theme === currentTheme) return;
    currentTheme = theme;
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch (e) {}
    _paintTheme();
    triggerHaptic('LIGHT');
}

// Applied on boot from the persisted value, before first paint of the screens.
function applyTheme() { _paintTheme(); }

// --- Overlays ---
// Every modal and sheet in the app is shown/hidden with the same `.hidden`
// utility — never inline styles.
function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function openSheet(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeSheet(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
window.openSheet = openSheet;
window.closeSheet = closeSheet;

// js/firebase.js calls closeSignInModal() from onAuthStateChanged.
function openSignInModal() { openModal('signin-modal'); }
function closeSignInModal() { closeModal('signin-modal'); }
window.openSignInModal = openSignInModal;
window.closeSignInModal = closeSignInModal;

function updateAccountUI() {
    const user = window.bj21User;
    const signedOut = document.getElementById('account-signed-out');
    const signedIn = document.getElementById('account-signed-in');
    if (!signedOut || !signedIn) return;
    signedOut.classList.toggle('hidden', !!user);
    signedIn.classList.toggle('hidden', !user);
    if (user) {
        const nameEl = document.getElementById('account-display-name');
        if (nameEl) nameEl.textContent = user.displayName || 'Signed in';
    }
}
window.updateAccountUI = updateAccountUI;

// --- Settings ---
const NOTIFICATION_PREF_CATEGORIES = ['social', 'leaderboard', 'dailyReminder'];

function initSettingsScreen() {
    initNotificationSettings();
}

function initNotificationSettings() {
    const panel = document.getElementById('settings-notifications-panel');
    if (!panel) return;
    // Gated on push SUPPORT, not on being a native app: web push works too
    // (Firebase Messaging + VAPID, see js/push.js), and gating on native would
    // leave browser users with no way to enable or mute notifications.
    const supported = window.isPushSupported
        ? isPushSupported()
        : !!(window.isNativeApp && isNativeApp());
    panel.classList.toggle('hidden', !supported);
    if (!supported) return;

    const enableBtn = document.getElementById('settings-notifications-enable');
    if (enableBtn) {
        enableBtn.onclick = function() {
            if (window.registerForPushNotifications) registerForPushNotifications();
        };
    }

    const prefs = (window.bj21UserDoc && window.bj21UserDoc.notificationPrefs) || {};
    NOTIFICATION_PREF_CATEGORIES.forEach(function(category) {
        const toggle = document.getElementById('settings-notif-' + category);
        if (!toggle) return;
        toggle.checked = prefs[category] !== false; // default ON
        toggle.onchange = function() {
            if (window.setNotificationPref) setNotificationPref(category, toggle.checked);
        };
    });
}

// --- Native deep links ---
// Handles blackjack21://open?ref=CODE / ?join=CODE while running inside the
// Capacitor shell: merge the scheme URL's query params into the page URL, then
// reuse the exact same handlers the web build already uses.
function applyNativeDeepLinkUrl(rawUrl) {
    try {
        var incoming = new URL(rawUrl);
        var target = new URL(window.location.href);
        incoming.searchParams.forEach(function(value, key) {
            target.searchParams.set(key, value);
        });
        window.history.replaceState({}, '', target);
        if (window.handleIncomingInvite) handleIncomingInvite();
        if (window.handleJoinDeepLink) handleJoinDeepLink();
    } catch (e) {}
}

function initNativeDeepLinkHandling() {
    var CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (!CapApp) return;
    // Cold start: the app was launched directly via the custom scheme.
    CapApp.getLaunchUrl().then(function(result) {
        if (result && result.url) applyNativeDeepLinkUrl(result.url);
    }).catch(function() {});
    // Warm start: the app was already running when the scheme URL was opened.
    CapApp.addListener('appUrlOpen', function(data) {
        applyNativeDeepLinkUrl(data.url);
    });
}

// --- CONVENTION 4: the single bootstrap ---
// EXACTLY ONE DOMContentLoaded listener in the whole app, here. Every module's
// init runs from this list, in an order you can read top to bottom.
//
// Optional-module guard: `if (window.fn) fn();`. Because build.js concatenates
// files into one scope with no imports, a module that is not in jsFiles (yet,
// or on this platform) simply leaves its globals undefined — the guard turns a
// hard ReferenceError into a silently skipped feature. Anything OPTIONAL is
// guarded; anything this template guarantees is called bare, so a genuine
// breakage is loud rather than silent.
document.addEventListener('DOMContentLoaded', function() {
    applyTheme();
    initSettingsScreen();
    updateAccountUI();

    // APP-SPECIFIC: initialise the app's core feature module here.
    if (window.initBlackjack) initBlackjack();

    if (window.initOnboarding) initOnboarding(); else showScreen(SCREENS[0]);
    initPwa();

    // Web/PWA deep links (?ref=CODE, ?join=CODE). These must run on web too —
    // wiring them only into applyNativeDeepLinkUrl() silently drops every
    // shared link opened in a browser.
    if (window.handleIncomingInvite) handleIncomingInvite();
    if (window.handleJoinDeepLink) handleJoinDeepLink();
    initNativeDeepLinkHandling();
});
