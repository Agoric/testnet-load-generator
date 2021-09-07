/* global setInterval clearInterval */

// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

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
  goOnline,
  goOffline,
  child,
} from 'firebase/database';

export const makeClientConnectionHandlerFactory = (walletAddress) => (app) => {
  const db = getDatabase(app);
  goOffline(db);

  const loadgenRoot = ref(db, 'loadgen');

  const client = push(child(loadgenRoot, 'clients')).ref;
  const clientId = client.key;
  const cycles = child(loadgenRoot, 'cycles');
  const configs = child(loadgenRoot, 'configs');
  const requestedConfig = child(loadgenRoot, `requestedConfigs/${clientId}`);

  const pendingCycles = new Map();

  let user;
  let userActiveClient;
  let userActiveIntervalHandle;
  let connectedUnsubscribe;

  let configHandler;
  let requestedConfigUnsubscribe;

  const updateUser = async (newUser) => {
    const connectedRef = ref(db, '.info/connected');
    const clearActive = () => {
      if (userActiveIntervalHandle) {
        clearInterval(userActiveIntervalHandle);
        userActiveIntervalHandle = null;
      }
    };

    if (user === newUser) return;

    if (user) {
      goOffline(db);
      clearActive();
      if (connectedUnsubscribe) {
        connectedUnsubscribe();
        connectedUnsubscribe = null;
      }
      userActiveClient = null;
      if (configHandler) {
        configHandler(null);
      }
    }

    user = newUser;

    if (user) {
      goOnline(db);
      let firstConnection = makePromiseKit();

      const userId = user.uid;
      userActiveClient = ref(
        db,
        `users/${userId}/activeLoadgenClients/${clientId}`,
      );

      await Promise.all([
        set(client, {
          userId,
          walletAddress,
          connected: false,
          connectedAt: null,
          disconnectedAt: null,
        }),
        set(requestedConfig, null),
      ]);

      connectedUnsubscribe = onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
          console.log('Firebase connected');
          const updateActive = () => set(userActiveClient, serverTimestamp());
          const done = Promise.all([
            onDisconnect(client).update({
              disconnectedAt: serverTimestamp(),
              connected: false,
            }),
            onDisconnect(userActiveClient).set(null),
            onDisconnect(requestedConfig).set(null),
            update(client, {
              connectedAt: serverTimestamp(),
              connected: true,
            }),
            updateActive(),
          ]).then(() => {});
          userActiveIntervalHandle = setInterval(updateActive, 60 * 1000);
          if (firstConnection) {
            firstConnection.resolve(done);
          } else {
            done.catch((err) => console.error('onConnected error', err));
          }
        } else {
          clearActive();
          console.log('Firebase disconnected');
        }
      });

      await firstConnection.promise;
      firstConnection = null;
    }
  };

  const getId = () => clientId;

  const configUpdated = async (newConfig) => {
    await push(configs, {
      clientId,
      updatedAt: Date.now(),
      data: newConfig,
    });
  };

  const setRequestedConfigHandler = (newConfigHandler) => {
    if (requestedConfigUnsubscribe) {
      requestedConfigUnsubscribe();
      requestedConfigUnsubscribe = null;
      configHandler = null;
    }

    configHandler = newConfigHandler;

    if (configHandler) {
      requestedConfigUnsubscribe = onValue(requestedConfig, (snap) => {
        configHandler(snap.val());
      });
    }
  };

  const recordTaskStart = (type, seq) => {
    const startedAt = Date.now();
    const cycle = push(cycles).ref;
    pendingCycles.set(`${type}/${seq}`, cycle);

    set(cycle, {
      clientId,
      type,
      seq,
    })
      .then(() =>
        Promise.all([
          onDisconnect(cycle).update({
            disconnectedAt: serverTimestamp(),
            success: false,
          }),
          update(cycle, {
            startedAt,
          }),
        ]),
      )
      .catch((err) =>
        console.error(`recordTaskStart ${type} ${seq} error`, err),
      );
  };

  const recordTaskEnd = (type, seq, success) => {
    const key = `${type}/${seq}`;
    const cycle = pendingCycles.get(key);

    if (!cycle) return;
    pendingCycles.delete(key);

    Promise.all([
      onDisconnect(cycle).cancel(),
      update(cycle, {
        endedAt: Date.now(),
        disconnectedAt: null,
        success,
      }),
    ]).catch((err) =>
      console.error(`recordTaskEnd ${type} ${seq} ${success} error`, err),
    );
  };

  return harden({
    authFacet: {
      updateUser,
    },
    configFacet: {
      getId,
      configUpdated,
      setRequestedConfigHandler,
      recordTaskStart,
      recordTaskEnd,
    },
  });
};
