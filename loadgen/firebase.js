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
  child,
  onValue,
  serverTimestamp,
  onDisconnect,
  goOnline,
  goOffline,
  remove,
} from 'firebase/database';

const objectsForAuthDomain = new Map();

const makeFirebaseConnectionHandler = (app) => {
  const db = getDatabase(app);
  goOffline(db);

  const loadgen = push(ref(db, 'loadgens'));
  const loadgenId = loadgen.key;
  const loadgenConfigs = child(loadgen, 'configs');

  let user;
  let userActiveLoadgen;
  let connectedUnsubscribe;

  let configHandler;
  let requestConfigUnsubscribe;

  const connect = async (newUser) => {
    const connectedRef = ref(db, '.info/connected');

    if (user === newUser) return;

    if (user) {
      connectedUnsubscribe();
      connectedUnsubscribe = null;
      await Promise.all([
        update(loadgen, {
          disconnectedAt: serverTimestamp(),
          connected: false,
        }),
        remove(userActiveLoadgen),
        onDisconnect(ref(db)).cancel(),
      ]);
      goOffline(db);
      userActiveLoadgen = null;
    }

    user = newUser;

    if (user) {
      goOnline(db);
      let firstConnection = makePromiseKit();

      const userId = user.uid;
      userActiveLoadgen = ref(
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

      connectedUnsubscribe = onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
          const done = Promise.all([
            update(loadgen, {
              connectedAt: serverTimestamp(),
              connected: true,
            }),
            set(userActiveLoadgen, true),
            onDisconnect(loadgen).update({
              disconnectedAt: serverTimestamp(),
              connected: false,
            }),
            onDisconnect(userActiveLoadgen).remove(),
          ]).then(() => {});
          if (firstConnection) {
            firstConnection.resolve(done);
          } else {
            done.catch((err) => console.error('onConnected error', err));
          }
        }
      });

      await firstConnection.promise;
      firstConnection = null;
    }
  };

  const getId = () => loadgenId;

  const configUpdated = async (newConfig) => {
    await push(loadgenConfigs, {
      updatedAt: Date.now(),
      data: newConfig,
    });
  };

  const setRequestedConfigHandler = (newConfigHandler) => {
    if (requestConfigUnsubscribe) {
      requestConfigUnsubscribe();
      requestConfigUnsubscribe = null;
      configHandler = null;
    }

    configHandler = newConfigHandler;

    if (configHandler) {
      requestConfigUnsubscribe = onValue(
        child(loadgen, 'requestedConfig'),
        (snap) => {
          configHandler(snap.val());
        },
      );
    }
  };

  return harden({
    connectFacet: {
      connect,
    },
    configFacet: {
      disconnect: async () => connect(null),
      getId,
      configUpdated,
      setRequestedConfigHandler,
    },
  });
};

const getCredentials = async (auth, newToken) => {
  const firstDot = newToken.indexOf('.');

  if (firstDot < 0) return null;

  const jwt = newToken.slice(firstDot + 1);
  const newCredentials = await signInWithCustomToken(auth, jwt);

  return newCredentials;
};

export async function getFirebaseHandler(customToken) {
  const firstDot = customToken.indexOf('.');
  const encodedFirebaseConfig =
    firstDot >= 0 ? customToken.slice(0, firstDot) : customToken;

  const firebaseConfig = JSON.parse(
    Buffer.from(encodedFirebaseConfig, 'base64').toString('utf-8'),
  );

  console.log('parsed firebase config', firebaseConfig);

  const { authDomain } = firebaseConfig;

  if (!authDomain) {
    throw new Error('Invalid config');
  }

  let authDomainObjects = objectsForAuthDomain.get(authDomain);

  if (authDomainObjects) {
    const { encodedFirebaseConfig: encodedConfig } = authDomainObjects;
    if (encodedConfig !== encodedFirebaseConfig) {
      throw new Error('new token is for a different config');
    }
  } else {
    const app = initializeApp(firebaseConfig, firebaseConfig.projectId);
    const auth = getAuth(app);
    const { connectFacet, configFacet } = makeFirebaseConnectionHandler(app);
    authDomainObjects = {
      auth,
      connectFacet,
      configFacet,
      encodedFirebaseConfig,
    };
    objectsForAuthDomain.set(authDomain, authDomainObjects);
  }

  const credentials = await getCredentials(authDomainObjects.auth, customToken);

  if (
    authDomainObjects.credentials &&
    credentials &&
    credentials.user.id !== authDomainObjects.credentials.user.id
  ) {
    throw new Error('Cannot re-authenticate with different userId');
  }

  authDomainObjects.credentials = credentials;

  await authDomainObjects.connectFacet.connect(
    credentials ? credentials.user : null,
  );

  return authDomainObjects.configFacet;
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
