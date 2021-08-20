// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

import {
  getDatabase,
  ref,
  set,
  child,
  onValue,
  goOnline,
  goOffline,
  orderByChild,
  query,
  equalTo,
  onChildAdded,
  onChildRemoved,
} from 'firebase/database';

export const adminConnectionHandlerFactory = (app) => {
  const db = getDatabase(app);
  goOffline(db);

  let user;

  const loadgenRoot = ref(db, 'loadgen');
  const clients = child(loadgenRoot, 'clients');
  const cycles = child(loadgenRoot, 'cycles');
  const admin = child(loadgenRoot, 'admin');
  const requestedConfigs = child(loadgenRoot, 'requestedConfigs');

  const connectedClients = query(
    clients,
    orderByChild('connected'),
    equalTo(true),
  );

  const activeCycles = query(cycles, orderByChild('success'), equalTo(null));

  const connectedClientIds = new Set();
  let requestedClients = 0;
  let currentInterval = Infinity;
  let targetCycleStarts = 0;

  function updateConfigs() {
    const candidates = connectedClientIds.size;

    const interval = candidates
      ? (60 * 2 * candidates) / targetCycleStarts
      : Infinity;
    const waitOffset = interval / candidates;

    const configs =
      interval === Infinity
        ? null
        : Object.fromEntries(
            [...connectedClientIds].map((clientId, idx) => [
              clientId,
              {
                amm: { interval, wait: interval / 2 + idx * waitOffset },
                vault: { interval, wait: idx * waitOffset },
              },
            ]),
          );

    currentInterval = interval;
    requestedClients = candidates;
    set(requestedConfigs, configs).catch((err) =>
      console.error('error updating requested configs', err),
    );
  }

  function checkTargets() {
    const effectiveCycleStarts = (requestedClients * 2 * 60) / currentInterval;

    // console.log({
    //   requestedClients,
    //   currentInterval,
    //   effectiveCycleStarts,
    //   targetCycleStarts,
    // });

    if (
      Number.isNaN(effectiveCycleStarts) ||
      Math.abs(
        ((effectiveCycleStarts - targetCycleStarts) * 2) /
          (effectiveCycleStarts + targetCycleStarts),
      ) >
        10 / 100
    ) {
      console.log(
        `${effectiveCycleStarts} cycles starts per minutes deviated from target of ${targetCycleStarts}`,
      );
      updateConfigs();
      return;
    }

    const candidates = connectedClientIds.size;

    // console.log({ requestedClients, candidates });
    if (
      ((requestedClients - candidates) * 2) / (requestedClients + candidates) >
      10 / 100
    ) {
      console.log(
        `${requestedClients} enrolled clients deviated from ${candidates} candidates`,
      );
      updateConfigs();
    }
  }

  onChildAdded(connectedClients, (snap) => {
    connectedClientIds.add(snap.key);
    console.log(`found ${connectedClientIds.size} connected loadgen clients`);
    checkTargets();
  });
  onChildRemoved(connectedClients, (snap) => {
    connectedClientIds.delete(snap.key);
    console.log(`found ${connectedClientIds.size} connected loadgen clients`);
    checkTargets();
  });

  onValue(requestedConfigs, (snap) => {
    requestedClients = snap.size;
    console.log(`found ${snap.size} enrolled loadgen clients`);
    checkTargets();
  });

  onValue(activeCycles, (snap) => {
    console.log(`found ${snap.size} active cycles`);
  });

  onValue(child(admin, 'cycleStartsPerMinute'), (snap) => {
    targetCycleStarts = snap.val();
    console.log(`target cycle starts changed to ${targetCycleStarts}`);
    checkTargets();
  });

  const connect = async (newUser) => {
    if (user === newUser) return;

    if (user) {
      goOffline(db);
    }

    user = newUser;

    if (user || true) {
      goOnline(db);
      console.log('connecting');
    }
  };

  return {
    connectFacet: {
      connect,
    },
    configFacet: {
      disconnect: async () => connect(null),
    },
  };
};
