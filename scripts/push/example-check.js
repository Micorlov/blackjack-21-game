// TEMPLATE for a poller check module. Copy this file, rename it, and replace
// the query + message. Read the two comment blocks below first — they encode
// the two things that are easy to get wrong on this stack.
//
// This example: notify a user's friends when that user's `score` increases past
// theirs ("Alice just passed you"). Swap in whatever event your app has.
const { getFirestore } = require('../lib/firebaseAdmin');
const { sendPushToUser } = require('../lib/sendPush');

// Must match a key the client writes under users/{uid}.notificationPrefs —
// sendPush.js skips delivery when that key is explicitly false.
const CATEGORY = 'leaderboard';
const TITLE = 'Leaderboard';

// ---------------------------------------------------------------------------
// PATTERN 1 — THE INCREMENTAL QUERY
//
//   db.collection('users').where('updatedAt', '>', since)
//
// `since` comes from scripts/lib/cursor.js. This is what keeps the job O(number
// of things that changed) instead of O(all users), which is what makes a
// 5-minute cron affordable on the free plan.
//
// Requirement on the client: EVERY write that should be able to trigger this
// notification must stamp `updatedAt` with a server timestamp (see pushScore()
// in js/firebase.js). A write that forgets it is invisible to the poller.
//
// Requirement on Firestore: a `collectionGroup(...).where(...)` variant needs an
// explicit COLLECTION GROUP index (Console -> Firestore -> Indexes -> Collection
// Group tab). Plain single-collection single-field indexes are automatic;
// collection-group scope is not. Both are free on Spark.
// ---------------------------------------------------------------------------
//
// PATTERN 2 — `_prev*` STATE CACHED ON THE DOCUMENT
//
// A Cloud Functions trigger receives (before, after) for free. A poller does
// not: it only ever sees the CURRENT document. So each check stores what it
// last saw directly on the doc it watches, under an underscore-prefixed field,
// and diffs against that.
//
// Rules for these fields:
//   - underscore-prefix them (`_prevScore`) so they are obviously machine-owned
//   - they are safe to delete: the next pass re-seeds them and notifies nobody
//   - NEVER treat a missing cache as a meaningful "before" value. Seeding must
//     be silent. Reading absent-as-zero here would tell every friend they had
//     just been overtaken the very first time the poller ever ran.
//   - write the cache even when nothing was sent, or the diff never converges
//   - document them in the project's Firestore rules notes as poller-owned
// ---------------------------------------------------------------------------

function scoreOf(doc) {
  const value = doc.get('score');
  return typeof value === 'number' ? value : 0;
}

async function checkExample(since) {
  const db = getFirestore();

  // PATTERN 1: only documents that actually changed.
  const movers = await db.collection('users').where('updatedAt', '>', since).get();
  if (movers.empty) return;

  await Promise.all(movers.docs.map(async (doc) => {
    const after = scoreOf(doc);
    const cached = doc.get('_prevScore'); // PATTERN 2

    // Cold cache -> seed only. Note this is `typeof cached === 'number'`, not a
    // truthiness check: a legitimate cached 0 must not be read as "unseeded".
    if (typeof cached === 'number' && after > cached) {
      const friendsSnap = await db.collection(`users/${doc.id}/friends`).get();

      if (!friendsSnap.empty) {
        const moverName = doc.get('displayName') || 'Someone';
        const friendDocs = await Promise.all(
          friendsSnap.docs.map((f) => db.doc(`users/${f.id}`).get())
        );

        // Only the friends the mover actually crossed: their score sat strictly
        // between the cached and current value. This is what makes the check
        // idempotent — re-running with an unchanged cache crosses nobody.
        const overtaken = friendDocs.filter((friendDoc) => {
          if (!friendDoc.exists) return false;
          const friendScore = scoreOf(friendDoc);
          return friendScore > cached && friendScore <= after;
        });

        await Promise.all(overtaken.map((friendDoc) => sendPushToUser(friendDoc.id, CATEGORY, {
          title: TITLE,
          body: `${moverName} just passed you`,
        })));
      }
    }

    // Always advance the cache — including on the seeding pass and when nobody
    // was notified. merge:true so this never clobbers the user's real fields.
    await doc.ref.set({ _prevScore: after }, { merge: true });
  }));
}

module.exports = { checkExample };
