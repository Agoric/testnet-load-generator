/* global Buffer */

// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

const parseConfig = (customToken) => {
  const tokenParts = customToken.split('.');
  const encodedFirebaseConfig = tokenParts.shift();

  const firebaseConfig = JSON.parse(
    Buffer.from(encodedFirebaseConfig, 'base64').toString('utf-8'),
  );

  console.log('parsed firebase config', firebaseConfig);

  const jwtData = tokenParts[1]
    ? JSON.parse(Buffer.from(tokenParts[1], 'base64').toString('utf-8'))
    : {};

  const { uid } = jwtData;

  if (!firebaseConfig.projectId || !uid) {
    throw new Error('Invalid config');
  }

  return {
    encodedFirebaseConfig,
    firebaseConfig,
    authToken: tokenParts.join('.'),
    uid,
  };
};

export const makeAuthBroker = (
  connectionHandlerFactory,
  makeApp = initializeApp,
) => {
  const objectsForAuthInfo = new Map();

  return (customToken) => {
    const parsedConfig = parseConfig(customToken);

    const authIdentifier = `${parsedConfig.uid}@${parsedConfig.firebaseConfig.projectId}`;

    let authObjects = objectsForAuthInfo.get(authIdentifier);

    const updateAuthConfig = (newConfig) => {
      if (
        authObjects.encodedFirebaseConfig !== newConfig.encodedFirebaseConfig ||
        authObjects.uid !== newConfig.uid
      ) {
        throw new Error('new token is for a different config');
      }
      Object.assign(authObjects, newConfig);
    };

    if (authObjects) {
      updateAuthConfig(parsedConfig);
    } else {
      const app = makeApp(parsedConfig.firebaseConfig, authIdentifier);
      const auth = getAuth(app);
      const { authFacet, configFacet } = connectionHandlerFactory(app);

      const connect = async (newToken = null) => {
        if (newToken) {
          updateAuthConfig(parseConfig(newToken));
        }
        return signInWithCustomToken(auth, authObjects.authToken);
      };

      const disconnect = async () => {
        // Explicitly disconnect client before discarding auth
        await authFacet.updateUser(null);
        return signOut(auth);
      };

      let lastSeenUser = null;

      onAuthStateChanged(auth, (user) => {
        if (lastSeenUser !== user) {
          // Dedup initial user auth event
          console.log('Firebase updating authentication status');
          lastSeenUser = user;
        }
        if (user) {
          if (user.uid !== authObjects.uid) {
            console.warn('Firebase authenticated unexpected user');
          }
        }
        authFacet.updateUser(user);
      });

      const brokerFacet = harden({
        connect,
        disconnect,
        configFacet,
      });

      authObjects = {
        brokerFacet,
        ...parsedConfig,
      };
      objectsForAuthInfo.set(authIdentifier, authObjects);
    }

    return authObjects.brokerFacet;
  };
};
