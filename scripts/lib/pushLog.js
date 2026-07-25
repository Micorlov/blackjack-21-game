// Delivery log for every push sent by any path (poll checks via sendPush.js,
// manual broadcasts, admin tools) so there is one place to see who was
// actually reached and why anyone was missed. Build an admin view over this
// collection if you want it visible in-app. Writes never throw — a logging
// failure must not abort or retry an already-delivered notification.
const { getFirestore } = require('./firebaseAdmin');

const PUSH_LOGS_COLLECTION = 'pushLogs';

async function logPush(entry) {
  try {
    const db = getFirestore();
    await db.collection(PUSH_LOGS_COLLECTION).add({
      uid: entry.uid || null,
      displayName: entry.displayName || null,
      category: entry.category || 'unknown',
      title: entry.title || '',
      body: entry.body || '',
      source: entry.source || 'poll',
      status: entry.status || 'sent',
      tokenCount: entry.tokenCount || 0,
      successCount: entry.successCount || 0,
      failureCount: entry.failureCount || 0,
      platforms: entry.platforms || [],
      error: entry.error || null,
      sentAt: new Date(),
    });
  } catch (err) {
    console.error('Failed to write push log:', err.message);
  }
}

module.exports = { logPush, PUSH_LOGS_COLLECTION };
