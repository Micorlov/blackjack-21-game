// The app's core feature: single-player Blackjack vs. a dealer, 6-deck shoe.
// Depends only on js/ui.js (showToast/triggerHaptic, guaranteed to load first)
// and reaches into js/firebase.js's pushScore() through the optional-module
// guard, since Firebase may be absent or the player may be signed out — the
// game must be fully playable offline either way.

const BJ_SUITS = ['♠', '♥', '♦', '♣']; // spade, heart, diamond, club
const BJ_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const BJ_DECK_COUNT = 6;
// Reshuffle once the shoe drops below one deck's worth of cards, checked only
// between hands (never mid-hand, so a hand never runs out of cards). Real
// tables cut the shoe at ~75-80% penetration with a physical card; this is
// the same idea without needing one.
const BJ_RESHUFFLE_THRESHOLD = 52;
const BJ_STARTING_CHIPS = 1000;
const BJ_CHIPS_KEY = 'bj21_chips';
const BJ_STATS_KEY = 'bj21_stats';

let bjShoe = [];
let bjChips = BJ_STARTING_CHIPS;
let bjStats = null;
let bjPhase = 'betting'; // betting -> playing -> dealer -> settlement -> betting
let bjCurrentBet = 0;
let bjDealerHand = [];
let bjHands = []; // [{ cards, bet, status, isDoubled }] — status: active|stood|busted|blackjack|surrendered
let bjActiveHandIndex = 0;
let bjInsuranceBet = 0; // 0 = not taken this round

// --- Persistence ---

function bjLoadChips() {
    try {
        const raw = localStorage.getItem(BJ_CHIPS_KEY);
        const n = raw === null ? NaN : parseInt(raw, 10);
        return isNaN(n) ? BJ_STARTING_CHIPS : n;
    } catch (e) {
        return BJ_STARTING_CHIPS;
    }
}

function bjSaveChips() {
    window.bj21Chips = bjChips;
    try { localStorage.setItem(BJ_CHIPS_KEY, String(bjChips)); } catch (e) {}
}

function bjLoadStats() {
    let saved = null;
    try {
        const raw = localStorage.getItem(BJ_STATS_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch (e) {}
    return Object.assign({
        handsPlayed: 0, wins: 0, losses: 0, pushes: 0,
        blackjacks: 0, currentStreak: 0, bestStreak: 0
    }, saved || {});
}

// Only the persisted fields are written back out — sessionHands/sessionWins/
// sessionNet live on the same object (window.bj21Stats) for js/tabs.js to
// read, but they are intentionally session-only and must reset on reload.
function bjSaveStats() {
    try {
        localStorage.setItem(BJ_STATS_KEY, JSON.stringify({
            handsPlayed: bjStats.handsPlayed,
            wins: bjStats.wins,
            losses: bjStats.losses,
            pushes: bjStats.pushes,
            blackjacks: bjStats.blackjacks,
            currentStreak: bjStats.currentStreak,
            bestStreak: bjStats.bestStreak
        }));
    } catch (e) {}
}

// --- Shoe ---

function bjBuildShoe() {
    const shoe = [];
    for (let d = 0; d < BJ_DECK_COUNT; d++) {
        BJ_SUITS.forEach(function(suit) {
            BJ_RANKS.forEach(function(rank) {
                shoe.push({ rank: rank, suit: suit });
            });
        });
    }
    for (let i = shoe.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = shoe[i]; shoe[i] = shoe[j]; shoe[j] = tmp;
    }
    return shoe;
}

function bjDrawCard() {
    if (bjShoe.length === 0) bjShoe = bjBuildShoe();
    return bjShoe.pop();
}

// --- Hand value ---
// Aces count as 11 until that would bust the hand, then drop to 1 one at a
// time. `soft` (unused externally today, kept for clarity of intent) reports
// whether an ace is still counted as 11 in the final total.
function bjHandValue(cards) {
    let total = 0;
    let acesAs11 = 0;
    cards.forEach(function(c) {
        if (c.rank === 'A') { total += 11; acesAs11++; }
        else if (c.rank === 'K' || c.rank === 'Q' || c.rank === 'J' || c.rank === '10') total += 10;
        else total += parseInt(c.rank, 10);
    });
    while (total > 21 && acesAs11 > 0) { total -= 10; acesAs11--; }
    return { value: total, soft: acesAs11 > 0 };
}

function bjIsBlackjack(cards) {
    return cards.length === 2 && bjHandValue(cards).value === 21;
}

// --- Card + table rendering ---

function bjCreateCardEl(card, faceDown) {
    const el = document.createElement('div');
    if (faceDown) {
        el.className = 'bj-card bj-card-back';
        return el;
    }
    const isRed = card.suit === '♥' || card.suit === '♦';
    el.className = 'bj-card ' + (isRed ? 'bj-card-red' : 'bj-card-black');
    el.innerHTML =
        '<span class="bj-card-rank">' + card.rank + '</span>' +
        '<span class="bj-card-suit">' + card.suit + '</span>';
    return el;
}

function bjRenderHandInto(containerId, cards, hideSecondCard) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    cards.forEach(function(card, i) {
        container.appendChild(bjCreateCardEl(card, !!hideSecondCard && i === 1));
    });
}

function bjUpdateChipsDisplay() {
    const el = document.getElementById('chip-balance');
    if (el) el.textContent = '$' + bjChips;
}

function bjSetMessage(text, kind) {
    const el = document.getElementById('table-message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'table-message' + (kind ? ' message-' + kind : '');
}

// Dealer's hole card (2nd card) stays face-down only while the player is
// still acting or deciding on insurance — every other phase (dealing a
// blackjack, dealer's turn, settlement) shows it. Insurance is a bet on that
// hidden card, so revealing it early would give the decision away.
function bjRenderDealer() {
    const hideHole = bjPhase === 'playing' || bjPhase === 'insurance';
    bjRenderHandInto('dealer-cards', bjDealerHand, hideHole);
    const valueEl = document.getElementById('dealer-value');
    if (!valueEl) return;
    if (!bjDealerHand.length) { valueEl.textContent = ''; return; }
    valueEl.textContent = hideHole
        ? String(bjHandValue([bjDealerHand[0]]).value) + ' + ?'
        : String(bjHandValue(bjDealerHand).value);
}

function bjRenderPlayerHand(index) {
    const hand = bjHands[index];
    if (!hand) return;
    const cardsId = index === 0 ? 'player-cards' : 'player-cards-2';
    const valueId = index === 0 ? 'player-value' : 'player-value-2';
    bjRenderHandInto(cardsId, hand.cards, false);
    const valueEl = document.getElementById(valueId);
    if (valueEl) valueEl.textContent = String(bjHandValue(hand.cards).value);
}

function bjRenderHands() {
    bjRenderPlayerHand(0);
    const hand2Row = document.getElementById('hand-2-row');
    if (hand2Row) hand2Row.classList.toggle('hidden', bjHands.length < 2);
    if (bjHands.length > 1) bjRenderPlayerHand(1);

    const hand1Row = document.getElementById('player-hand-row');
    if (hand1Row) hand1Row.classList.toggle('active-hand', bjPhase === 'playing' && bjActiveHandIndex === 0 && bjHands.length > 1);
    if (hand2Row) hand2Row.classList.toggle('active-hand', bjPhase === 'playing' && bjActiveHandIndex === 1);
}

function bjRenderBetPanel() {
    const betPanel = document.getElementById('bet-panel');
    const outPanel = document.getElementById('out-of-chips-panel');
    const actionPanel = document.getElementById('action-panel');
    const betEl = document.getElementById('current-bet');
    if (betEl) betEl.textContent = '$' + bjCurrentBet;

    const isBetting = bjPhase === 'betting';
    const outOfChips = isBetting && bjChips <= 0;

    if (outPanel) outPanel.classList.toggle('hidden', !outOfChips);
    if (betPanel) betPanel.classList.toggle('hidden', !isBetting || outOfChips);
    if (actionPanel) actionPanel.classList.toggle('hidden', bjPhase !== 'playing');

    const dealBtn = document.getElementById('btn-deal');
    if (dealBtn) dealBtn.disabled = bjCurrentBet <= 0;
}

function bjRenderActionButtons() {
    const hand = bjHands[bjActiveHandIndex];
    if (!hand) return;
    const doubleBtn = document.getElementById('btn-double');
    const splitBtn = document.getElementById('btn-split');
    const surrenderBtn = document.getElementById('btn-surrender');
    const canDouble = hand.cards.length === 2 && !hand.isDoubled && bjChips >= hand.bet;
    // Exactly one split per round (v1 scope) — bjHands.length === 1 is enough
    // to forbid resplitting on EITHER resulting hand once a split happened.
    const canSplit = bjHands.length === 1 && hand.cards.length === 2 &&
        hand.cards[0].rank === hand.cards[1].rank && bjChips >= hand.bet;
    // Late surrender: only on the very first decision of an unsplit, undoubled
    // hand — matches real tables, and bjHands.length === 1 rules it out after
    // a split exactly like canSplit rules out a resplit.
    const canSurrender = bjHands.length === 1 && hand.cards.length === 2 && !hand.isDoubled;
    if (doubleBtn) doubleBtn.disabled = !canDouble;
    if (splitBtn) splitBtn.disabled = !canSplit;
    if (surrenderBtn) surrenderBtn.disabled = !canSurrender;
}

// Offered only when the dealer's up-card is an Ace, before any player action
// and before the usual natural-blackjack check — a real table peeks for
// dealer blackjack only after insurance is settled.
function bjRenderInsurancePanel() {
    const panel = document.getElementById('insurance-panel');
    if (!panel) return;
    const showing = bjPhase === 'insurance';
    panel.classList.toggle('hidden', !showing);
    if (!showing) return;
    const amountEl = document.getElementById('insurance-amount');
    if (amountEl) amountEl.textContent = '$' + Math.min(Math.floor(bjHands[0].bet / 2), bjChips);
}

function bjRenderTable() {
    bjUpdateChipsDisplay();
    bjRenderDealer();
    bjRenderHands();
    bjRenderBetPanel();
    bjRenderInsurancePanel();
    if (bjPhase === 'playing') bjRenderActionButtons();
}

// --- Betting ---

function placeBet(amount) {
    if (bjPhase !== 'betting') return;
    if (bjChips - bjCurrentBet < amount) { showToast('Not enough chips'); return; }
    bjCurrentBet += amount;
    bjRenderBetPanel();
    triggerHaptic('LIGHT');
}
window.placeBet = placeBet;

function clearBet() {
    if (bjPhase !== 'betting') return;
    bjCurrentBet = 0;
    bjRenderBetPanel();
}
window.clearBet = clearBet;

function resetBankroll() {
    bjChips = BJ_STARTING_CHIPS;
    bjSaveChips();
    bjUpdateChipsDisplay();
    bjRenderBetPanel();
    showToast('Complimentary chips from the house!');
    triggerHaptic('MEDIUM');
}
window.resetBankroll = resetBankroll;

// --- Round flow ---

function dealRound() {
    if (bjPhase !== 'betting' || bjCurrentBet <= 0 || bjCurrentBet > bjChips) return;
    if (bjShoe.length < BJ_RESHUFFLE_THRESHOLD) bjShoe = bjBuildShoe();

    bjChips -= bjCurrentBet;
    bjSaveChips();

    bjHands = [{ cards: [bjDrawCard(), bjDrawCard()], bet: bjCurrentBet, status: 'active', isDoubled: false }];
    bjDealerHand = [bjDrawCard(), bjDrawCard()];
    bjActiveHandIndex = 0;
    bjInsuranceBet = 0;
    bjSetMessage('', null);
    triggerHaptic('LIGHT');

    // Real tables offer insurance (dealer shows an Ace) BEFORE peeking for
    // blackjack, so that has to happen before the natural check below —
    // bjResolveNaturalsOrContinue() is the shared continuation both paths
    // reach afterward.
    if (bjDealerHand[0].rank === 'A') {
        bjPhase = 'insurance';
        bjRenderTable();
        return;
    }
    bjResolveNaturalsOrContinue();
}
window.dealRound = dealRound;

function bjSettleInsurance() {
    if (bjInsuranceBet <= 0) return;
    if (bjIsBlackjack(bjDealerHand)) {
        bjChips += bjInsuranceBet * 3; // stake back + 2:1 win
        showToast('Insurance paid 2:1');
    } else {
        showToast('Insurance lost');
    }
    bjSaveChips();
}

// Naturals resolve immediately, before the player can act — matches how a
// real table peeks/reveals blackjacks rather than letting a 21 hit.
function bjResolveNaturalsOrContinue() {
    bjPhase = 'playing';
    bjRenderTable();
    const playerBJ = bjIsBlackjack(bjHands[0].cards);
    const dealerBJ = bjIsBlackjack(bjDealerHand);
    if (playerBJ || dealerBJ) {
        bjHands[0].status = playerBJ ? 'blackjack' : 'stood';
        bjFinishRound();
    }
}

function takeInsurance() {
    if (bjPhase !== 'insurance') return;
    const amount = Math.min(Math.floor(bjHands[0].bet / 2), bjChips);
    if (amount <= 0) { declineInsurance(); return; }
    bjInsuranceBet = amount;
    bjChips -= amount;
    bjSaveChips();
    bjSettleInsurance();
    bjResolveNaturalsOrContinue();
}
window.takeInsurance = takeInsurance;

function declineInsurance() {
    if (bjPhase !== 'insurance') return;
    bjInsuranceBet = 0;
    bjResolveNaturalsOrContinue();
}
window.declineInsurance = declineInsurance;

function bjActiveHand() { return bjHands[bjActiveHandIndex]; }

function bjAdvanceHand() {
    if (bjActiveHandIndex < bjHands.length - 1) {
        bjActiveHandIndex++;
        bjRenderTable();
    } else {
        bjDealerTurn();
    }
}

function playerHit() {
    if (bjPhase !== 'playing') return;
    const hand = bjActiveHand();
    hand.cards.push(bjDrawCard());
    const v = bjHandValue(hand.cards).value;
    bjRenderTable();
    triggerHaptic('LIGHT');
    if (v > 21) {
        hand.status = 'busted';
        showToast('Bust');
        triggerHaptic('HEAVY');
        bjAdvanceHand();
    } else if (v === 21) {
        hand.status = 'stood';
        bjAdvanceHand();
    }
}
window.playerHit = playerHit;

function playerStand() {
    if (bjPhase !== 'playing') return;
    bjActiveHand().status = 'stood';
    bjAdvanceHand();
}
window.playerStand = playerStand;

// Late surrender: forfeit half the bet and end the hand immediately, before
// any other action. Only ever offered on an unsplit, undoubled 2-card hand —
// see the canSurrender gate in bjRenderActionButtons — so bjHands.length is
// always 1 here and this can never leave a second hand still to play.
function playerSurrender() {
    if (bjPhase !== 'playing') return;
    const hand = bjActiveHand();
    if (bjHands.length !== 1 || hand.cards.length !== 2 || hand.isDoubled) return;
    hand.status = 'surrendered';
    bjRenderTable();
    triggerHaptic('MEDIUM');
    bjAdvanceHand();
}
window.playerSurrender = playerSurrender;

function playerDouble() {
    if (bjPhase !== 'playing') return;
    const hand = bjActiveHand();
    if (hand.cards.length !== 2 || hand.isDoubled || bjChips < hand.bet) return;
    bjChips -= hand.bet;
    bjSaveChips();
    hand.bet *= 2;
    hand.isDoubled = true;
    hand.cards.push(bjDrawCard());
    const busted = bjHandValue(hand.cards).value > 21;
    hand.status = busted ? 'busted' : 'stood';
    bjRenderTable();
    triggerHaptic(busted ? 'HEAVY' : 'MEDIUM');
    bjAdvanceHand();
}
window.playerDouble = playerDouble;

function playerSplit() {
    if (bjPhase !== 'playing') return;
    const hand = bjActiveHand();
    if (bjHands.length !== 1 || hand.cards.length !== 2 ||
        hand.cards[0].rank !== hand.cards[1].rank || bjChips < hand.bet) return;

    bjChips -= hand.bet;
    bjSaveChips();

    const second = { cards: [hand.cards.pop()], bet: hand.bet, status: 'active', isDoubled: false };
    hand.cards.push(bjDrawCard());
    second.cards.push(bjDrawCard());
    bjHands.push(second);
    bjRenderTable();
    triggerHaptic('MEDIUM');
}
window.playerSplit = playerSplit;

function bjDealerTurn() {
    bjPhase = 'dealer';
    bjRenderTable();
    // S17 (stand on all 17s, including soft 17) rather than H17 — same payout
    // shape, simpler to implement and reason about correctly for a v1.
    while (bjHandValue(bjDealerHand).value < 17) {
        bjDealerHand.push(bjDrawCard());
    }
    bjFinishRound();
}

function bjFinishRound() {
    bjPhase = 'settlement';
    const dealerBJ = bjIsBlackjack(bjDealerHand);
    const dealerValue = bjHandValue(bjDealerHand).value;
    const dealerBusted = dealerValue > 21;

    let anyWin = false;
    let anyBlackjack = false;
    let allLose = true;

    bjHands.forEach(function(hand) {
        let outcome;
        if (hand.status === 'surrendered') {
            outcome = 'surrender';
        } else if (hand.status === 'blackjack') {
            outcome = dealerBJ ? 'push' : 'blackjack';
        } else if (hand.status === 'busted') {
            outcome = 'lose';
        } else if (dealerBJ) {
            outcome = 'lose';
        } else if (dealerBusted) {
            outcome = 'win';
        } else {
            const pv = bjHandValue(hand.cards).value;
            outcome = pv > dealerValue ? 'win' : pv < dealerValue ? 'lose' : 'push';
        }

        // Round DOWN on the 3:2 payout fraction so the house never hands out
        // a chip it doesn't have — matches how real tables handle odd bets.
        let payout = 0;
        if (outcome === 'blackjack') payout = Math.floor(hand.bet * 2.5);
        else if (outcome === 'win') payout = hand.bet * 2;
        else if (outcome === 'push') payout = hand.bet;
        else if (outcome === 'surrender') payout = Math.floor(hand.bet / 2);
        bjChips += payout;

        bjStats.handsPlayed++;
        bjStats.sessionHands++;
        bjStats.sessionNet += payout - hand.bet;

        if (outcome === 'win' || outcome === 'blackjack') {
            bjStats.wins++;
            bjStats.sessionWins++;
            bjStats.currentStreak++;
            bjStats.bestStreak = Math.max(bjStats.bestStreak, bjStats.currentStreak);
            anyWin = true;
            allLose = false;
        } else if (outcome === 'push') {
            bjStats.pushes++;
            allLose = false;
        } else {
            // 'lose' and 'surrender' both count as a loss for streak/win-rate
            // purposes — surrender only trims how much is lost, not whether it
            // was a loss.
            bjStats.losses++;
            bjStats.currentStreak = 0;
        }
        if (outcome === 'blackjack') { bjStats.blackjacks++; anyBlackjack = true; }
    });

    bjSaveChips();
    bjSaveStats();

    // Reveal the dealer's hole card and final hand values before announcing
    // the outcome. bjHands/bjDealerHand are deliberately left populated below
    // (only bet/phase state resets) so the finished table stays on screen
    // until the next Deal, instead of flashing empty at the betting screen.
    bjRenderDealer();
    bjRenderHands();

    let message, kind;
    // Surrender only ever happens on a lone, unsplit hand (see the
    // canSurrender gate), so bjHands.length === 1 is guaranteed here.
    if (bjHands.length === 1 && bjHands[0].status === 'surrendered') {
        message = 'Surrendered'; kind = 'lose';
    } else if (anyBlackjack) { message = 'Blackjack!'; kind = 'win'; }
    else if (anyWin) { message = 'You win'; kind = 'win'; }
    else if (allLose) {
        message = bjHands.every(function(h) { return h.status === 'busted'; }) ? 'Bust' : 'Dealer wins';
        kind = 'lose';
    } else {
        message = 'Push'; kind = 'push';
    }
    bjSetMessage(message, kind);
    triggerHaptic(anyWin ? 'MEDIUM' : allLose ? 'HEAVY' : 'LIGHT');

    // Optional and best-effort: chips ARE this app's canonical leaderboard
    // number, but a signed-out player or a blocked Firebase CDN must never
    // block settlement — pushScore() itself no-ops without `db`/`bj21User`.
    if (window.bj21User && window.pushScore) pushScore(bjChips);

    bjPhase = 'betting';
    bjCurrentBet = 0;
    bjActiveHandIndex = 0;
    bjUpdateChipsDisplay();
    bjRenderBetPanel();
}

function initBlackjack() {
    bjChips = bjLoadChips();
    bjStats = bjLoadStats();
    // Session-only counters live on the same object as the persisted stats
    // (window.bj21Stats) so js/tabs.js has one shape to read, but they must
    // never be written back by bjSaveStats().
    bjStats.sessionHands = 0;
    bjStats.sessionWins = 0;
    bjStats.sessionNet = 0;
    window.bj21Stats = bjStats;
    window.bj21Chips = bjChips;

    bjShoe = bjBuildShoe();
    bjPhase = 'betting';
    bjCurrentBet = 0;
    bjDealerHand = [];
    bjHands = [];
    bjSetMessage('Place your bet to begin', null);
    bjRenderTable();
}
window.initBlackjack = initBlackjack;
