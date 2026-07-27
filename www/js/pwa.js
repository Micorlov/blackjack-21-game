// PWA: service worker registration + install prompt.
// Last in build.js jsFiles. initPwa() is called from the DOMContentLoaded
// bootstrap in js/tabs.js; pwaRegisterSw() runs immediately at the bottom
// because push registration needs navigator.serviceWorker.ready as early as
// possible.

const INSTALL_PROMPT_AFTER_VISITS = 3;

let pwaDeferredInstall = null;

// Service workers are refused on any non-secure origin. Guarding here rather
// than letting register() reject keeps file:// and http:// dev servers quiet.
function pwaCanUseSw() {
    return 'serviceWorker' in navigator &&
        (location.protocol === 'https:' || location.hostname === 'localhost');
}

function pwaRegisterSw() {
    if (!pwaCanUseSw()) return;
    navigator.serviceWorker.register('sw.js').catch(function() { /* offline / unsupported */ });
}

// One increment per calendar day, not per page load — a user reloading twenty
// times in one sitting is one visit, so the install prompt tracks genuine
// return visits.
function pwaTrackVisit() {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const raw = localStorage.getItem('bj21_visits');
        const v = raw ? JSON.parse(raw) : { count: 0, last: '' };
        if (v.last !== today) {
            v.count++;
            v.last = today;
            localStorage.setItem('bj21_visits', JSON.stringify(v));
        }
        return v.count;
    } catch (e) { return 0; }
}

function pwaShowBar(id, text, yesLabel, onYes) {
    if (document.getElementById(id)) return;
    const bar = document.createElement('div');
    bar.id = id;
    bar.className = 'pwa-bar';
    const yes = document.createElement('button');
    yes.className = 'pwa-bar-yes';
    yes.textContent = yesLabel;
    yes.onclick = function() { bar.remove(); onYes(); };
    const no = document.createElement('button');
    no.className = 'pwa-bar-no';
    no.textContent = '✕';
    no.onclick = function() { bar.remove(); };
    const span = document.createElement('span');
    span.textContent = text;
    bar.appendChild(span);
    bar.appendChild(yes);
    bar.appendChild(no);
    document.body.appendChild(bar);
}

// The browser fires this when the app becomes installable. Capture and defer
// it: prompting on first load converts badly and burns the one-shot event.
window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    pwaDeferredInstall = e;
    maybeShowInstallBar();
});

function maybeShowInstallBar() {
    if (!pwaDeferredInstall) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem('bj21_install_dismissed') === '1'; } catch (e) {}
    if (dismissed) return;
    let visits = 0;
    try { visits = (JSON.parse(localStorage.getItem('bj21_visits')) || {}).count || 0; } catch (e) {}
    if (visits < INSTALL_PROMPT_AFTER_VISITS) return;
    pwaShowBar('pwa-install-bar', 'Install Blackjack 21 for quick access', 'Install', function() {
        pwaDeferredInstall.prompt();
        pwaDeferredInstall = null;
    });
    // Show it once, ever. A repeatedly re-appearing install bar is the fastest
    // way to make people leave.
    try { localStorage.setItem('bj21_install_dismissed', '1'); } catch (e) {}
}

function initPwa() {
    pwaTrackVisit();
    maybeShowInstallBar();
}

pwaRegisterSw();
