// TEMPLATE test for a poller check module. Run with `npm test`
// (`node --test "scripts/**/*.test.js"` — no test framework to install).
//
// THE PATTERN: REQUIRE-CACHE STUBBING
// A check module reaches the outside world through exactly two tiny modules —
// ../lib/firebaseAdmin (Firestore) and ../lib/sendPush (FCM). Both are replaced
// in Node's require cache with fakes BEFORE the module under test is required,
// so the test needs no emulator, no network, and no service-account key. This
// only works because the check has no other I/O: keep it that way.
//
// The fake Firestore implements ONLY the access shapes the module actually
// uses. Do not build a general-purpose Firestore mock — an unexpected path
// should throw loudly so the test tells you the module started doing something
// new, rather than silently returning undefined.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const adminPath = require.resolve('./../lib/firebaseAdmin');
const sendPushPath = require.resolve('./../lib/sendPush');

let currentDb = null;
let sentPushes = [];

function stub(modulePath, exports) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    path: path.dirname(modulePath),
    loaded: true,
    exports,
  };
}

stub(adminPath, { getFirestore: () => currentDb });
stub(sendPushPath, {
  sendPushToUser: async (uid, category, notification) => {
    sentPushes.push({ uid, category, body: notification.body });
  },
});

// MUST come after the stubs above — requiring it earlier would capture the real
// modules.
const { checkExample } = require('./example-check');

// users: { uid: { friends: [uid...], ...docFields } }
function fakeDb(users) {
  const snapOf = (uid) => {
    const user = users[uid];
    return {
      id: uid,
      exists: !!user,
      get: (field) => (user ? user[field] : undefined),
      ref: {
        // Mutating the fixture is the point: assertions below check that the
        // _prev* cache was advanced.
        set: (patch) => {
          Object.assign(user, patch);
          return Promise.resolve();
        },
      },
    };
  };

  return {
    collection(collectionPath) {
      const friendsMatch = /^users\/(.+)\/friends$/.exec(collectionPath);
      if (friendsMatch) {
        const ids = users[friendsMatch[1]] ? users[friendsMatch[1]].friends || [] : [];
        return { get: async () => ({ empty: ids.length === 0, docs: ids.map((id) => ({ id })) }) };
      }
      if (collectionPath === 'users') {
        return {
          where: (field, _op, value) => ({
            get: async () => {
              const docs = Object.keys(users)
                .filter((uid) => (users[uid][field] || 0) > value)
                .map(snapOf);
              return { empty: docs.length === 0, docs };
            },
          }),
        };
      }
      throw new Error(`fakeDb: unexpected collection ${collectionPath}`);
    },
    doc(docPath) {
      const match = /^users\/([^/]+)$/.exec(docPath);
      if (!match) throw new Error(`fakeDb: unexpected doc ${docPath}`);
      return { get: async () => snapOf(match[1]) };
    },
  };
}

async function run(users) {
  currentDb = fakeDb(users);
  sentPushes = [];
  await checkExample(0); // `since` is only ever compared with `>`
  return sentPushes;
}

const bodiesFor = (pushes, uid) => pushes.filter((p) => p.uid === uid).map((p) => p.body);

test('seeds silently on first run instead of notifying', async () => {
  // Arrange — nobody has _prevScore yet.
  const users = {
    alice: { displayName: 'Alice', score: 500, updatedAt: 1, friends: ['bob'] },
    bob: { displayName: 'Bob', score: 100, updatedAt: 0, friends: ['alice'] },
  };

  // Act
  const pushes = await run(users);

  // Assert — a cold cache must not be read as "everyone was just overtaken".
  assert.deepStrictEqual(pushes, []);
  assert.strictEqual(users.alice._prevScore, 500);
});

test('notifies the friend who was passed', async () => {
  // Arrange — Alice climbs from 50 to 300, crossing Bob on 100.
  const users = {
    alice: { displayName: 'Alice', score: 300, updatedAt: 1, friends: ['bob'], _prevScore: 50 },
    bob: { displayName: 'Bob', score: 100, updatedAt: 0, friends: ['alice'], _prevScore: 100 },
  };

  // Act
  const pushes = await run(users);

  // Assert
  assert.deepStrictEqual(bodiesFor(pushes, 'bob'), ['Alice just passed you']);
});

test('is idempotent — a second pass over the same state notifies nobody', async () => {
  // Arrange — the cache already reflects the current score.
  const users = {
    alice: { displayName: 'Alice', score: 300, updatedAt: 1, friends: ['bob'], _prevScore: 300 },
    bob: { displayName: 'Bob', score: 100, updatedAt: 0, friends: ['alice'], _prevScore: 100 },
  };

  // Act
  const pushes = await run(users);

  // Assert — window boundaries re-deliver documents; that must be harmless.
  assert.deepStrictEqual(pushes, []);
});

test('does not notify friends who were never crossed', async () => {
  // Arrange — Alice climbs 50 -> 80; Bob on 100 is still ahead.
  const users = {
    alice: { displayName: 'Alice', score: 80, updatedAt: 1, friends: ['bob'], _prevScore: 50 },
    bob: { displayName: 'Bob', score: 100, updatedAt: 0, friends: ['alice'], _prevScore: 100 },
  };

  // Act
  const pushes = await run(users);

  // Assert
  assert.deepStrictEqual(pushes, []);
  assert.strictEqual(users.alice._prevScore, 80);
});

test('ignores users with no friends', async () => {
  // Arrange
  const users = {
    solo: { displayName: 'Solo', score: 999, updatedAt: 1, friends: [], _prevScore: 0 },
  };

  // Act
  const pushes = await run(users);

  // Assert — still advances the cache, just notifies nobody.
  assert.deepStrictEqual(pushes, []);
  assert.strictEqual(users.solo._prevScore, 999);
});
