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
  remove,
  child,
} from 'firebase/database';

export const makeClientConnectionHandlerFactory = (walletAddress) => (app) => {
  const db = getDatabase(app);
  goOffline(db);

  const loadgenRoot = ref(db, 'loadgen');

  const client = push(child(loadgenRoot, 'clients'));
  const clientId = client.key;
  const cycles = child(loadgenRoot, 'cycles');
  const configs = child(loadgenRoot, 'configs');
  const requestedConfig = child(loadgenRoot, `requestedConfigs/${clientId}`);

  const pendingCycles = new Map();

  let user;
  let userActiveClient;
  let connectedUnsubscribe;

  let configHandler;
  let requestedConfigUnsubscribe;

  const connect = async (newUser) => {
    const connectedRef = ref(db, '.info/connected');

    if (user === newUser) return;

    if (user) {
      connectedUnsubscribe();
      connectedUnsubscribe = null;
      goOffline(db);
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
        remove(requestedConfig),
      ]);

      connectedUnsubscribe = onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
          const done = Promise.all([
            update(client, {
              connectedAt: serverTimestamp(),
              connected: true,
            }),
            set(userActiveClient, true),
            onDisconnect(client).update({
              disconnectedAt: serverTimestamp(),
              connected: false,
            }),
            onDisconnect(userActiveClient).remove(),
            onDisconnect(requestedConfig).remove(),
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
    const cycle = push(cycles, {
      clientId,
      type,
      seq,
      startedAt: Date.now(),
    });

    pendingCycles.set(`${type}/${seq}`, cycle);
    const onDisconnectUpdate = onDisconnect(cycle).update({
      disconnectedAt: serverTimestamp(),
      success: false,
    });

    Promise.all([cycle, onDisconnectUpdate]).catch((err) =>
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
