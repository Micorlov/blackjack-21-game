// Tracks the polling cursor in a single Firestore doc (system/pushCursor),
// since a standalone poller — unlike a Cloud Functions trigger — has no
// automatic "since last event" context and has to persist it itself.
const { getFirestore, Timestamp } = require('./firebaseAdmin');

const CURSOR_DOC_PATH = 'system/pushCursor';
const DEFAULT_LOOKBACK_MS = 60 * 60 * 1000; // 1 hour, used only on first-ever run

async function getCursor() {
  const db = getFirestore();
  const snap = await db.doc(CURSOR_DOC_PATH).get();
  const lastCheckedAt = snap.get('lastCheckedAt');
  if (lastCheckedAt && typeof lastCheckedAt.toDate === 'function') {
    return lastCheckedAt.toDate();
  }
  return new Date(Date.now() - DEFAULT_LOOKBACK_MS);
}

async function setCursor(date) {
  const db = getFirestore();
  await db.doc(CURSOR_DOC_PATH).set(
    { lastCheckedAt: Timestamp.fromDate(date) },
    { merge: true }
  );
}

module.exports = { getCursor, setCursor };
