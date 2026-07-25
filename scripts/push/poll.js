// Push-notification poller entrypoint, run on a schedule by
// .github/workflows/push-poll.yml (every 5 minutes).
//
// WHY A POLLER AND NOT CLOUD FUNCTIONS
// Firestore event triggers require the Blaze (pay-as-you-go) plan. A scheduled
// GitHub Actions job with the Admin SDK does the same work on the free Spark
// plan: one process wakes up, asks "what changed since last time?", sends the
// notifications, and records where it got to.
//
// THE CONTRACT EVERY CHECK MODULE FOLLOWS
//   - export one `async function check<Thing>(since)`
//   - query incrementally: `.where('updatedAt', '>', since)`
//   - be idempotent: a re-run over the same window must not double-notify
//   - never throw for one bad document; a single failure must not sink the pass
const { getCursor, setCursor } = require('../lib/cursor');

// Each check is a self-contained module. Add one require + one entry in the
// Promise.all below; nothing else in the pipeline changes.
const { checkExample } = require('./example-check');
// const { checkNewFriends } = require('./friends');
// const { checkLeaderboard } = require('./leaderboard');

async function poll() {
  const since = await getCursor();

  // STAMP THE CURSOR FROM *BEFORE* THE CHECKS RAN.
  // Capturing the time up front and writing it at the end makes the window
  // [since, pollStartedAt] fully closed: anything written *while* the checks
  // are running falls after pollStartedAt and is therefore picked up by the
  // NEXT pass. Using `new Date()` at the end instead would silently swallow
  // every document written during the run — a permanently lost notification,
  // and the kind of gap that only shows up as "some users never get notified".
  // The cost is deliberate: a document may be seen twice at a window boundary,
  // which is exactly why every check must be idempotent.
  const pollStartedAt = new Date();

  // Checks run in parallel — they read disjoint data and each owns its own
  // "already notified" bookkeeping.
  await Promise.all([
    checkExample(since),
    // checkNewFriends(since),
    // checkLeaderboard(since),
  ]);

  await setCursor(pollStartedAt);
}

poll()
  .then(() => {
    console.log('Push poll complete.');
    process.exit(0);
  })
  .catch((err) => {
    // Fail the workflow run loudly: the cursor is NOT advanced on error, so the
    // next scheduled pass retries the same window rather than skipping it.
    console.error('Push poll failed:', err);
    process.exit(1);
  });
