// Small UI utilities: toast messages + haptic feedback (Settings toggle).
// No dependencies — this file is first in build.js jsFiles so everything else
// can call showToast()/triggerHaptic() at any time.

function showToast(text) {
    let el = document.getElementById('bj21-toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'bj21-toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.remove('show');
    // Force a reflow so re-adding `show` restarts the CSS transition even when
    // a second toast fires while the first is still visible.
    void el.offsetWidth;
    el.classList.add('show');
    setTimeout(function() { el.classList.remove('show'); }, 2200);
}

let hapticsEnabled = true;
try {
    const storedHaptics = localStorage.getItem('bj21_haptics_enabled');
    if (storedHaptics !== null) hapticsEnabled = storedHaptics === 'true';
} catch (e) {}

function toggleHaptics() {
    hapticsEnabled = !hapticsEnabled;
    try { localStorage.setItem('bj21_haptics_enabled', hapticsEnabled); } catch (e) {}
    triggerHaptic('LIGHT');
}

// Native Capacitor haptics when running in the app shell; navigator.vibrate as
// the web fallback. Never throws — haptics are decoration, not behaviour.
function triggerHaptic(style) {
    if (!hapticsEnabled) return;
    try {
        const plugins = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
            ? window.Capacitor.Plugins : null;
        if (plugins && plugins.Haptics) {
            plugins.Haptics.impact({ style: style || 'MEDIUM' });
        } else if (navigator.vibrate) {
            navigator.vibrate(style === 'HEAVY' ? 60 : style === 'LIGHT' ? 8 : 15);
        }
    } catch (e) {}
}
