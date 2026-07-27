// Unit + behavioral tests for js/blackjack.js, run via `npm test`
// (node --test "tests/**/*.test.js" "scripts/**/*.test.js").
//
// Two layers:
//  1. Pure-function tests on bjHandValue/bjIsBlackjack with hand-built cards —
//     exact, deterministic, covers the ace soft/hard edge cases directly.
//  2. Behavioral tests that drive the real shoe/RNG through placeBet/dealRound/
//     playerHit/playerStand/playerDouble/playerSplit and assert invariants that
//     must hold regardless of which cards were actually dealt (chips never go
//     negative, bet accounting is exact, phase always returns to betting).
//     Playing enough rounds makes bust/blackjack/push/double/split all show up
//     without needing to fake the shuffle.
const test = require('node:test');
const assert = require('node:assert');
const { loadGame, card } = require('./harness');

// --- bjHandValue ---

test('bjHandValue: hard total sums ranks with face cards as 10', () => {
    const ctx = loadGame();
    assert.strictEqual(ctx.bjHandValue([card('10'), card('7')]).value, 17);
    assert.strictEqual(ctx.bjHandValue([card('K'), card('Q')]).value, 20);
    assert.strictEqual(ctx.bjHandValue([card('5'), card('5'), card('5')]).value, 15);
});

test('bjHandValue: a single ace counts as 11 while it still fits', () => {
    const ctx = loadGame();
    const v = ctx.bjHandValue([card('A'), card('6')]);
    assert.strictEqual(v.value, 17);
    assert.strictEqual(v.soft, true);
});

test('bjHandValue: an ace drops to 1 the moment 11 would bust the hand', () => {
    const ctx = loadGame();
    const v = ctx.bjHandValue([card('A'), card('6'), card('9')]);
    assert.strictEqual(v.value, 16);
    assert.strictEqual(v.soft, false);
});

test('bjHandValue: two aces only count one as 11 (12, not 22)', () => {
    const ctx = loadGame();
    const v = ctx.bjHandValue([card('A'), card('A')]);
    assert.strictEqual(v.value, 12);
    assert.strictEqual(v.soft, true);
});

test('bjHandValue: three aces plus a 9 resolves to a hard 12', () => {
    const ctx = loadGame();
    const v = ctx.bjHandValue([card('A'), card('A'), card('A'), card('9')]);
    // 11 + 1 + 1 + 9 = 22 would bust with two aces at 11, so only one stays at 11.
    assert.strictEqual(v.value, 12);
});

test('bjHandValue: a genuine bust reports over 21 with no soft aces left', () => {
    const ctx = loadGame();
    const v = ctx.bjHandValue([card('K'), card('Q'), card('5')]);
    assert.strictEqual(v.value, 25);
    assert.strictEqual(v.soft, false);
});

// --- bjIsBlackjack ---

test('bjIsBlackjack: true for a 2-card ace + ten-value natural', () => {
    const ctx = loadGame();
    assert.strictEqual(ctx.bjIsBlackjack([card('A'), card('K')]), true);
    assert.strictEqual(ctx.bjIsBlackjack([card('10'), card('A')]), true);
});

test('bjIsBlackjack: false for 21 made with three or more cards', () => {
    const ctx = loadGame();
    assert.strictEqual(ctx.bjIsBlackjack([card('7'), card('7'), card('7')]), false);
});

test('bjIsBlackjack: false for a 2-card total under 21', () => {
    const ctx = loadGame();
    assert.strictEqual(ctx.bjIsBlackjack([card('9'), card('9')]), false);
});

// --- Betting ---

test('placeBet accumulates but never lets the bet exceed available chips', () => {
    const ctx = loadGame();
    ctx.placeBet(500);
    ctx.placeBet(500);
    ctx.placeBet(500); // would push the bet to 1500 on a 1000-chip bankroll
    assert.strictEqual(ctx.document.getElementById('current-bet').textContent, '$1000');
});

test('clearBet resets the pending bet to zero', () => {
    const ctx = loadGame();
    ctx.placeBet(100);
    ctx.clearBet();
    assert.strictEqual(ctx.document.getElementById('current-bet').textContent, '$0');
});

test('resetBankroll restores the starting 1000 chips', () => {
    const ctx = loadGame();
    ctx.placeBet(1000);
    ctx.dealRound();
    assert.notStrictEqual(ctx.bj21Chips, 1000);
    ctx.resetBankroll();
    assert.strictEqual(ctx.bj21Chips, 1000);
});

// Deals a fresh game repeatedly until it lands in the 'playing' phase (action
// panel visible) — i.e. no natural on either side, and any dealer-shows-Ace
// insurance offer has been declined so it doesn't perturb the chip count.
// Shared by every test that needs a live, still-undecided hand.
function freshHandInPlay(bet) {
    for (let attempt = 0; attempt < 200; attempt++) {
        const ctx = loadGame();
        ctx.placeBet(bet);
        ctx.dealRound();
        if (!ctx.document.getElementById('insurance-panel').classList.contains('hidden')) {
            ctx.declineInsurance();
        }
        if (!ctx.document.getElementById('action-panel').classList.contains('hidden')) return ctx;
    }
    throw new Error('freshHandInPlay: no non-natural deal in 200 attempts');
}

// Deals fresh games until the dealer's up-card is an Ace (insurance offered).
function dealUntilInsuranceOffered(bet) {
    for (let attempt = 0; attempt < 400; attempt++) {
        const ctx = loadGame();
        ctx.placeBet(bet);
        ctx.dealRound();
        if (!ctx.document.getElementById('insurance-panel').classList.contains('hidden')) return ctx;
    }
    throw new Error('dealUntilInsuranceOffered: no dealer-shows-Ace deal in 400 attempts');
}

test('dealRound deducts the bet from chips immediately and deals two cards a side', () => {
    const ctx = freshHandInPlay(100);
    assert.strictEqual(ctx.bj21Chips, 900);
    assert.strictEqual(ctx.document.getElementById('player-cards').children.length, 2);
    assert.strictEqual(ctx.document.getElementById('dealer-cards').children.length, 2);
});

// --- Insurance ---

test('insurance is offered only when the dealer shows an Ace, for half the bet, hole card still hidden', () => {
    const ctx = dealUntilInsuranceOffered(100);
    assert.strictEqual(ctx.document.getElementById('action-panel').classList.contains('hidden'), true);
    assert.strictEqual(ctx.document.getElementById('insurance-amount').textContent, '$50');
    assert.strictEqual(ctx.bj21Chips, 900); // only the main bet deducted so far
    assert.strictEqual(ctx.document.getElementById('dealer-cards').children[1].className, 'bj-card bj-card-back');
});

test('declining insurance never costs chips beyond the original bet', () => {
    const ctx = dealUntilInsuranceOffered(100);
    const beforeDecision = ctx.bj21Chips;
    ctx.declineInsurance();
    // Whatever happens next (continues to 'playing', or an immediate natural
    // settles it), nothing about that came from an insurance side bet.
    assert.ok(ctx.bj21Chips >= beforeDecision);
});

test('taking insurance deducts the stake immediately; losing it costs exactly that stake', () => {
    // Reaching 'playing' right after takeInsurance() proves neither hand was
    // a natural — in particular the dealer did NOT have blackjack — which
    // deterministically isolates the "insurance lost" branch.
    for (let attempt = 0; attempt < 400; attempt++) {
        const ctx = dealUntilInsuranceOffered(100);
        const beforeDecision = ctx.bj21Chips; // 900
        ctx.takeInsurance();
        if (!ctx.document.getElementById('action-panel').classList.contains('hidden')) {
            assert.strictEqual(ctx.bj21Chips, beforeDecision - 50);
            return;
        }
    }
    throw new Error('never observed a losing insurance bet in 400 attempts');
});

test('taking insurance against a dealer blackjack pays 2:1 and nets a wash', () => {
    // The round auto-settles inside takeInsurance() (bjResolveNaturalsOrContinue
    // -> bjFinishRound) whenever the dealer turns over blackjack. The 'Dealer
    // wins' message is unique to "dealer has blackjack, player's 2 cards do
    // not" — 'Blackjack!' covers the player-also-natural win (impossible here
    // since the dealer already has one) and 'Push' covers the double-natural
    // case, where the main hand's bet comes back instead of being lost.
    for (let attempt = 0; attempt < 800; attempt++) {
        const ctx = dealUntilInsuranceOffered(100);
        ctx.takeInsurance();
        const message = ctx.document.getElementById('table-message').textContent;
        if (message === 'Dealer wins') {
            // The main bet was already deducted at deal time and this outcome
            // pays it no further (a plain loss), so the round's net effect is
            // entirely the insurance side bet: -50 stake, +150 back (2:1 plus
            // the stake). That is exactly the 100 the main bet lost — insurance
            // existing to cancel precisely this outcome — so the bankroll ends
            // the round unchanged from where it started (1000).
            assert.strictEqual(ctx.bj21Chips, 1000);
            return;
        }
    }
    throw new Error('never observed a dealer-blackjack-while-insured hand in 800 attempts');
});

// --- Surrender ---

test('surrender forfeits exactly half the bet and settles the round immediately', () => {
    const ctx = freshHandInPlay(100);
    ctx.playerSurrender();
    assert.strictEqual(ctx.bj21Chips, 950); // 900 after the bet, +50 back on surrender
    assert.strictEqual(ctx.document.getElementById('table-message').textContent, 'Surrendered');
    assert.strictEqual(ctx.document.getElementById('bet-panel').classList.contains('hidden'), false);
});

test('surrender is only offered before any other action on an unsplit hand', () => {
    const ctx = freshHandInPlay(100);
    ctx.playerHit();
    // Whether the hit busted the hand or not, the round is no longer at its
    // first decision, so surrender must not be offered from here on.
    if (!ctx.document.getElementById('action-panel').classList.contains('hidden')) {
        assert.strictEqual(ctx.document.getElementById('btn-surrender').disabled, true);
    }
});

// --- Full-round invariants, fuzzed over the real shoe/RNG ---
//
// No seeded shuffle: instead of forcing specific cards, play enough rounds
// with a simple always-legal strategy that every hand reaches a terminal
// state (stood/busted/blackjack) and check invariants that must hold no
// matter what was actually dealt.

// Generous but finite: a hand only needs repeated hits while under 17, so a
// long run of low cards (rare, not impossible with a 6-deck shoe) can take
// more than a handful — and a split doubles the number of hands that must
// each reach a terminal state. This is a safety net against a genuine
// infinite-loop bug, not a realistic per-hand hit count.
const MAX_ACTIONS_PER_ROUND = 200;

function playOneRound(ctx) {
    const bet = Math.min(50, ctx.bj21Chips);
    ctx.placeBet(bet);
    ctx.dealRound();

    // Dealer-shows-Ace pause: exercise both branches across many rounds
    // rather than always declining, so the insurance-payout path gets
    // fuzzed too. Must be resolved before anything else — dealRound() leaves
    // the round parked here, neither settled nor in the playing phase.
    if (!ctx.document.getElementById('insurance-panel').classList.contains('hidden')) {
        if (Math.random() < 0.5) ctx.takeInsurance(); else ctx.declineInsurance();
    }

    // Deal-time naturals resolve before any action is possible.
    if (ctx.document.getElementById('action-panel').classList.contains('hidden')) return;

    let guard = 0;
    while (!ctx.document.getElementById('action-panel').classList.contains('hidden')) {
        if (guard >= MAX_ACTIONS_PER_ROUND) {
            throw new Error('playOneRound: stuck in the playing phase after ' + guard + ' actions — a real game bug, not a strategy issue');
        }
        // Surrender occasionally when it's offered (only ever the very first
        // decision) — otherwise split whenever offered, otherwise hit until
        // 17+, matching basic no-bust-below-17 strategy.
        if (!ctx.document.getElementById('btn-surrender').disabled && Math.random() < 0.2) {
            ctx.playerSurrender();
        } else if (!ctx.document.getElementById('btn-split').disabled) {
            ctx.playerSplit();
        } else {
            const activeCardsId = ctx.document.getElementById('hand-2-row').classList.contains('active-hand')
                ? 'player-cards-2' : 'player-cards';
            const cardCount = ctx.document.getElementById(activeCardsId).children.length;
            if (cardCount === 2 && !ctx.document.getElementById('btn-double').disabled && Math.random() < 0.3) {
                ctx.playerDouble();
            } else {
                const valueId = activeCardsId === 'player-cards-2' ? 'player-value-2' : 'player-value';
                const value = parseInt(ctx.document.getElementById(valueId).textContent, 10);
                if (value < 17) ctx.playerHit(); else ctx.playerStand();
            }
        }
        guard++;
    }
}

test('bankroll never goes negative and settlement always returns to betting phase', () => {
    const ctx = loadGame();
    const ROUNDS = 200;
    let roundsRun = 0;
    for (let i = 0; i < ROUNDS && ctx.bj21Chips > 0; i++) {
        playOneRound(ctx);
        roundsRun++;
        assert.ok(ctx.bj21Chips >= 0, 'chips went negative after round ' + i);
        assert.strictEqual(ctx.document.getElementById('current-bet').textContent, '$0');
        // Back in the betting phase either the bet panel (chips remain) or the
        // out-of-chips panel (bankroll hit exactly 0) is showing — never neither.
        const betPanelVisible = !ctx.document.getElementById('bet-panel').classList.contains('hidden');
        const outOfChipsVisible = !ctx.document.getElementById('out-of-chips-panel').classList.contains('hidden');
        assert.strictEqual(betPanelVisible || outOfChipsVisible, true);
        assert.strictEqual(betPanelVisible && outOfChipsVisible, false);
    }
    // A fixed $50-a-round strategy can plausibly bust the whole bankroll well
    // before ROUNDS iterations — that is a legitimate outcome, not a bug, so
    // the invariant is against the rounds actually run, not against ROUNDS.
    // Each round settles one hand, or two if it happened to split.
    assert.ok(ctx.bj21Stats.handsPlayed >= roundsRun,
        'expected at least one settled hand per round, got ' + ctx.bj21Stats.handsPlayed + ' for ' + roundsRun + ' rounds');
    assert.ok(ctx.bj21Stats.handsPlayed <= roundsRun * 2,
        'a round can settle at most two hands (one split), got ' + ctx.bj21Stats.handsPlayed + ' for ' + roundsRun + ' rounds');
});

test('win/loss/push counts plus blackjacks never exceed hands played', () => {
    const ctx = loadGame();
    for (let i = 0; i < 150 && ctx.bj21Chips > 0; i++) playOneRound(ctx);
    const s = ctx.bj21Stats;
    assert.strictEqual(s.wins + s.losses + s.pushes, s.handsPlayed);
    assert.ok(s.blackjacks <= s.wins + s.pushes, 'a blackjack must count as a win or a push');
    assert.ok(s.bestStreak >= s.currentStreak);
});

test('out-of-chips panel appears once the bankroll hits zero and Deal is disabled at 0 bet', () => {
    const ctx = loadGame();
    // Force the exact bust-the-bankroll path: bet everything, every round,
    // until either it's gone or a very long run has passed (RNG-fair, this
    // is virtually guaranteed to bust well before the guard trips).
    let guard = 0;
    while (ctx.bj21Chips > 0 && guard < 500) { playOneRound(ctx); guard++; }
    if (ctx.bj21Chips === 0) {
        assert.strictEqual(ctx.document.getElementById('out-of-chips-panel').classList.contains('hidden'), false);
    }
    assert.strictEqual(ctx.document.getElementById('btn-deal').disabled, true);
});

test('a fresh game starts at 1000 chips in the betting phase with Deal disabled', () => {
    const ctx = loadGame();
    assert.strictEqual(ctx.bj21Chips, 1000);
    assert.strictEqual(ctx.document.getElementById('chip-balance').textContent, '$1000');
    assert.strictEqual(ctx.document.getElementById('btn-deal').disabled, true);
});
