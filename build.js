// Single-file bundler: inlines every CSS + JS module into index.html and emits
// blackjack21.html — one self-contained artifact that GitHub Pages serves and
// Capacitor wraps. No webpack, no npm build chain, no source maps to lose.
const fs = require('fs');
const path = require('path');

const projectDir = __dirname;
const templatePath = path.join(projectDir, 'index.html');
const outputPath = path.join(projectDir, 'blackjack21.html');

if (!fs.existsSync(templatePath)) {
    console.error('index.html template not found!');
    process.exit(1);
}

let indexHtml = fs.readFileSync(templatePath, 'utf8');

// ORDER IS THE DEPENDENCY GRAPH.
// Everything is concatenated into one <style> block in document order, so a
// later file can override an earlier one. tokens.css must come first — every
// other stylesheet reads its custom properties.
const cssFiles = [
    'styles/tokens.css',    // palette, radii, --nav-height, theme overrides — ALWAYS FIRST
    'styles/layout.css',    // .app / .screen / .bottom-nav / modals / buttons
    'styles/blackjack.css', // felt table, cards, chips, betting/action panels
];

let combinedCss = '';
cssFiles.forEach(file => {
    combinedCss += `\n/* --- ${file} --- */\n` + fs.readFileSync(path.join(projectDir, file), 'utf8') + '\n';
});

// ORDER IS THE DEPENDENCY GRAPH.
// There are no imports and no modules — every file shares one global scope and
// runs top-level code as soon as it is concatenated. So a file may only call
// functions defined ABOVE it at load time. The convention that makes this
// survivable: cross-module calls that fire later are guarded with
// `if (window.fn) fn();` (see js/tabs.js), and js/tabs.js — which bootstraps
// everything on DOMContentLoaded — goes LAST but one, with js/pwa.js after it.
const jsFiles = [
    'js/ui.js',         // showToast / triggerHaptic — no dependencies, so first
    'js/firebase.js',   // defines db, auth, firebaseSafe(); everything social needs these
    'js/push.js',       // needs firebaseSafe + db
    'js/presence.js',   // needs firebaseSafe + db
    'js/blackjack.js',  // the app's core feature: shoe, hands, betting, table render
    'js/tabs.js',       // screen switching + the single DOMContentLoaded bootstrap
    'js/pwa.js'         // service worker registration + install prompt
];

let combinedJs = '';
jsFiles.forEach(file => {
    combinedJs += `\n/* --- ${file} --- */\n` + fs.readFileSync(path.join(projectDir, file), 'utf8') + '\n';
});

// Replace placeholders
// Replacer FUNCTIONS, not strings: a string replacement gives '$&', "$`", "$'"
// etc. special meaning in the replacement text, and app code containing e.g.
// '$' + someVar (a dollar sign directly followed by a quote) silently
// corrupts the build. A function replacer inserts its return value verbatim.
indexHtml = indexHtml.replace('<!-- BUILD_CSS_PLACEHOLDER -->', () => combinedCss);
indexHtml = indexHtml.replace('<!-- BUILD_JS_PLACEHOLDER -->', () => combinedJs);

fs.writeFileSync(outputPath, indexHtml, 'utf8');
console.log('Successfully built blackjack21.html');

// Copy to the Capacitor www/ directory so the native Android/iOS shells pick up
// the same build. Skipped silently if the project has no native wrapper yet.
const wwwDir = path.join(projectDir, 'www');
if (fs.existsSync(wwwDir)) {
    fs.copyFileSync(outputPath, path.join(wwwDir, 'blackjack21.html'));
    const dirsToCopy = ['media', 'styles', 'js'];
    dirsToCopy.forEach(function(dir) {
        const src = path.join(projectDir, dir);
        const dst = path.join(wwwDir, dir);
        if (fs.existsSync(src)) {
            fs.cpSync(src, dst, { recursive: true });
        }
    });
    const rootFiles = ['manifest.json', 'icon.svg', 'sw.js'];
    rootFiles.forEach(function(file) {
        const src = path.join(projectDir, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(wwwDir, file));
        }
    });
    console.log('Copied to www/ for the native app shell');
}
