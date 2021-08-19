// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

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

export const makeClientConnectionHandlerFactory = (clientAddress) => (app) => {
  const db = getDatabase(app);
  goOffline(db);

  const loadgen = push(ref(db, 'loadgens'));
  const loadgenId = loadgen.key;
  const loadgenConfigs = child(loadgen, 'configs');
  const loadgenTasks = child(loadgen, 'tasks');

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
        clientAddress,
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

  const recordTaskStart = (type, seq) => {
    set(child(loadgenTasks, `${type}/${seq}`), {
      startedAt: Date.now(),
    }).catch((err) =>
      console.error(`recordTaskStart ${type} ${seq} error`, err),
    );
  };

  const recordTaskEnd = (type, seq, success) => {
    update(child(loadgenTasks, `${type}/${seq}`), {
      endedAt: Date.now(),
      success,
    }).catch((err) =>
      console.error(`recordTaskEnd ${type} ${seq} ${success} error`, err),
    );
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
      recordTaskStart,
      recordTaskEnd,
    },
  });
};
