// Shared firebase-admin bootstrap for every scripts/ Node script (run
// standalone via GitHub Actions, not as Firebase Cloud Functions). Auth
// comes from the standard GOOGLE_APPLICATION_CREDENTIALS env var, which the
// GitHub Actions workflows point at a temp file holding the
// FIREBASE_SERVICE_ACCOUNT_KEY secret's JSON content — initializeApp() picks
// that up automatically with no extra code here.
//
// firebase-admin@14 dropped the old namespaced compat API (admin.firestore(),
// admin.messaging(), admin.apps, admin.firestore.FieldValue) from the
// package's main entry point — only the modular subpath API
// (firebase-admin/app, firebase-admin/firestore, firebase-admin/messaging)
// is exported now, so this file (and its callers) use that instead.
const { initializeApp, getApps } = require('firebase-admin/app');
const { getFirestore: getModularFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { getMessaging: getModularMessaging } = require('firebase-admin/messaging');

if (!getApps().length) {
  initializeApp();
}

function getFirestore() {
  return getModularFirestore();
}

function getMessaging() {
  return getModularMessaging();
}

module.exports = { getFirestore, getMessaging, FieldValue, Timestamp };
