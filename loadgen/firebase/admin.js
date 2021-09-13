// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

import firebase from 'firebase/compat/app';
import 'firebase/compat/database';

import { debounce } from './admin/helpers.js';
import { updateConfigs, updateNeeded } from './admin/config.js';

export const makeAdminApp = (firebaseConfig, name) =>
  firebase.initializeApp(firebaseConfig, name);

export const adminConnectionHandlerFactory = (app) => {
  const db = firebase.database(app);
  db.goOffline();

  let user;

  const loadgenRoot = db.ref('loadgen');

  loadgenRoot.child('admin').on(
    'value',
    debounce((snap) => {
      if (updateNeeded(snap)) {
        updateConfigs(snap).catch((err) =>
          console.error('updateConfigs error', err),
        );
      }
    }),
  );

  loadgenRoot
    .child('cycles')
    .orderByChild('success')
    .equalTo(null)
    .on('value', (snap) => {
      const count =
        snap.numChildren() &&
        Object.values(snap.val()).reduce(
          (acc, cycle) => (cycle.startedAt ? acc + 1 : acc),
          0,
        );

      return loadgenRoot.child('admin/computed/activeCycles').set(count);
    });

  loadgenRoot
    .child('clients')
    .orderByChild('connected')
    .equalTo(true)
    .on('value', (snap) => {
      const count = snap.numChildren();

      return loadgenRoot.child('admin/computed/connectedClients').set(count);
    });

  loadgenRoot.child('requestedConfigs').on('value', (snap) => {
    const count = snap.numChildren();

    return loadgenRoot.child('admin/computed/enrolledClients').set(count);
  });

  const updateUser = async (newUser) => {
    if (user === newUser) return;

    if (user) {
      console.log('disconnecting');
      db.goOffline();
    }

    user = newUser;

    if (user) {
      db.goOnline();
      console.log('connecting');
    }
  };

  return {
    authFacet: {
      updateUser,
    },
    configFacet: {},
  };
};
