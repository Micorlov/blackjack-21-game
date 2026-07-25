// Sends one notification to one user, with per-category opt-out, automatic
// cleanup of tokens FCM reports as unregistered, and a log row for every
// attempt (including skips). Deliberately NOT a Cloud Function — this runs
// from the GitHub Actions poller, so init comes from scripts/lib/firebaseAdmin.js
// (GOOGLE_APPLICATION_CREDENTIALS), not from a Cloud-Functions-managed context.
const { getFirestore, getMessaging } = require('./firebaseAdmin');
const { logPush } = require('./pushLog');

async function sendPushToUser(uid, category, notification) {
  const db = getFirestore();
  const userSnap = await db.doc(`users/${uid}`).get();
  const displayName = userSnap.get('displayName') || null;
  const prefs = userSnap.get('notificationPrefs') || {};

  // Skipped sends are logged too — the admin panel needs to explain why a
  // user is missing from a delivery, not just omit them silently.
  const base = {
    uid,
    displayName,
    category,
    title: notification.title,
    body: notification.body,
    source: 'poll',
  };

  if (prefs[category] === false) {
    await logPush({ ...base, status: 'skipped', error: 'Category muted in notificationPrefs' });
    return;
  }

  const tokensSnap = await db.collection(`users/${uid}/fcmTokens`).get();
  if (tokensSnap.empty) {
    await logPush({ ...base, status: 'skipped', error: 'No registered device tokens' });
    return;
  }

  const tokens = tokensSnap.docs.map((doc) => doc.id);
  const platforms = tokensSnap.docs.map((doc) => doc.get('platform') || 'unknown');
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification,
  });

  await logPush({
    ...base,
    status: response.successCount > 0 ? 'sent' : 'failed',
    tokenCount: tokens.length,
    successCount: response.successCount,
    failureCount: response.failureCount,
    platforms,
  });

  const staleTokens = [];
  response.responses.forEach((result, index) => {
    if (!result.success && result.error.code === 'messaging/registration-token-not-registered') {
      staleTokens.push(tokens[index]);
    }
  });

  await Promise.all(
    staleTokens.map((token) => db.doc(`users/${uid}/fcmTokens/${token}`).delete())
  );
}

module.exports = { sendPushToUser };
