/* global Buffer */

// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';

import { makePromiseKit } from '@agoric/promise-kit';

import {
  getDatabase,
  ref,
  update,
  set,
  push,
  onValue,
  serverTimestamp,
  onDisconnect,
} from 'firebase/database';

const handlersForAuthDomain = new Map();

export async function getFirebaseHandler(customToken) {
  const encodedFirebaseConfig = customToken.slice(0, customToken.indexOf('.'));

  const firebaseConfig = JSON.parse(
    Buffer.from(encodedFirebaseConfig, 'base64').toString('utf-8'),
  );

  console.log('parsed firebase config', firebaseConfig);

  const { authDomain } = firebaseConfig;

  if (!authDomain) {
    throw new Error('Invalid config');
  }

  let handler = handlersForAuthDomain.get(authDomain);

  if (handler) {
    await handler.updateToken(customToken);
    return handler;
  }

  const app = initializeApp(firebaseConfig, firebaseConfig.projectId);
  const auth = getAuth(app);

  let credentials;
  let loadgenId;

  const updateToken = async (newToken) => {
    const firstDot = newToken.indexOf('.');

    if (newToken.slice(0, firstDot) !== encodedFirebaseConfig) {
      throw new Error('new token is for a different config');
    }

    const jwt = newToken.slice(firstDot + 1);
    const newCredentials = await signInWithCustomToken(auth, jwt);

    if (credentials && newCredentials.user.id !== credentials.user.id) {
      throw new Error('Cannot re-authenticate with different userId');
    }
    credentials = newCredentials;
  };

  const getId = () => loadgenId;

  handler = harden({ updateToken, getId });
  handlersForAuthDomain.set(authDomain, handler);

  await updateToken(customToken);

  const db = getDatabase(app);
  const connectedRef = ref(db, '.info/connected');

  const userId = credentials.user.uid;

  const loadgen = push(ref(db, 'loadgens'));
  loadgenId = loadgen.key;
  const userActiveLoadgen = ref(
    db,
    `users/${userId}/activeLoadgens/${loadgenId}`,
  );

  await set(loadgen, {
    userId,
    connected: false,
    connectedAt: null,
    disconnectedAt: null,
    requestedConfig: null,
  });

  let firstConnection = makePromiseKit();

  onValue(connectedRef, (snap) => {
    if (snap.val() === true) {
      const done = Promise.all([
        update(loadgen, { connectedAt: serverTimestamp(), connected: true }),
        set(userActiveLoadgen, true),
        onDisconnect(loadgen).update({
          disconnectedAt: serverTimestamp(),
          connected: false,
        }),
        onDisconnect(userActiveLoadgen).remove(),
      ]).then(() => {});
      if (firstConnection) {
        firstConnection.resolve(done);
      }
    }
  });

  await firstConnection.promise;
  firstConnection = null;

  return handler;
}

// startFirebase().then(
//   (res) => {
//     process.exit(res);
//   },
//   (rej) => {
//     // console.log(process._getActiveRequests(), process._getActiveHandles());
//     console.error(rej);
//     process.exit(2);
//   },
// );
