// Loads js/ui.js + js/blackjack.js into a throwaway vm context with a minimal
// fake DOM/window/localStorage, so the actual game logic can be unit tested
// with plain node:test — no jsdom, no browser, no bundler (matches the app's
// own "no build step" philosophy).
//
// Function DECLARATIONS at top level of a vm context become properties of the
// context object (same rule as `var`), so bjHandValue/dealRound/playerHit/etc.
// come back accessible as ctx.<name>. The module-level `let` state (bjShoe,
// bjHands, ...) does NOT — that state is only reachable through the functions
// the app itself already exposes on `window` (chips, stats, rendered DOM).
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function makeElement(id) {
    const el = {
        id: id,
        textContent: '',
        disabled: false,
        value: '',
        children: [],
        _classes: new Set(),
        // Real `container.innerHTML = ''` clears existing children — bjRenderHandInto
        // relies on exactly that to replace a hand's cards rather than accumulate
        // them across re-renders (e.g. dealRound's initial render followed by
        // bjFinishRound's re-render on an immediate natural).
        _innerHTML: '',
        get innerHTML() { return el._innerHTML; },
        set innerHTML(v) { el._innerHTML = v; el.children = []; },
        appendChild: function(child) { el.children.push(child); return child; },
        classList: {
            add: function(c) { el._classes.add(c); },
            remove: function(c) { el._classes.delete(c); },
            toggle: function(c, force) {
                if (force === undefined) {
                    if (el._classes.has(c)) el._classes.delete(c); else el._classes.add(c);
                } else if (force) {
                    el._classes.add(c);
                } else {
                    el._classes.delete(c);
                }
            },
            contains: function(c) { return el._classes.has(c); }
        }
    };
    return el;
}

function createSandbox() {
    const localStorageBacking = {};
    const elements = new Map();

    const document = {
        getElementById: function(id) {
            if (!elements.has(id)) elements.set(id, makeElement(id));
            return elements.get(id);
        },
        createElement: function() { return makeElement('__created__'); },
        addEventListener: function() {},
        body: makeElement('body')
    };

    const localStorage = {
        getItem: function(k) {
            return Object.prototype.hasOwnProperty.call(localStorageBacking, k) ? localStorageBacking[k] : null;
        },
        setItem: function(k, v) { localStorageBacking[k] = String(v); },
        removeItem: function(k) { delete localStorageBacking[k]; }
    };

    const navigator = { vibrate: function() { return true; } };

    const sandbox = {
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        JSON: JSON,
        Math: Object.create(Math), // shadow .random per-sandbox without touching the real global Math
        document: document,
        localStorage: localStorage,
        navigator: navigator
    };
    sandbox.window = sandbox; // window IS the global object, same as a real browser
    return sandbox;
}

// One fresh sandbox + freshly-loaded module per call — tests must never share
// state (module-level `let`s like bjShoe/bjChips persist for the lifetime of
// one vm context).
function loadGame() {
    const sandbox = createSandbox();
    const context = vm.createContext(sandbox);
    ['js/ui.js', 'js/blackjack.js'].forEach(function(relPath) {
        const code = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
        vm.runInContext(code, context, { filename: relPath });
    });
    context.initBlackjack();
    return context;
}

function card(rank, suit) { return { rank: rank, suit: suit || '♠' }; }

module.exports = { loadGame: loadGame, card: card };
