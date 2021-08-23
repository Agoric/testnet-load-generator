/* global Buffer */

// Protobufjs patch is mostly necessary for Firestore but keep around as it doesn't hurt
import './setup-protobufjs-inquire.js';

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';

export const getCredentials = async (auth, newToken) => {
  const firstDot = newToken.indexOf('.');

  if (firstDot < 0) return null;

  const jwt = newToken.slice(firstDot + 1);
  const newCredentials = await signInWithCustomToken(auth, jwt);

  return newCredentials;
};

export const makeAuthBroker = (
  connectionHandlerFactory,
  makeApp = initializeApp,
) => {
  const objectsForAuthDomain = new Map();

  return async (customToken) => {
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
      const app = makeApp(firebaseConfig, firebaseConfig.projectId);
      const auth = getAuth(app);
      const { connectFacet, configFacet } = connectionHandlerFactory(app);
      authDomainObjects = {
        auth,
        connectFacet,
        configFacet,
        encodedFirebaseConfig,
      };
      objectsForAuthDomain.set(authDomain, authDomainObjects);
    }

    const credentials = await getCredentials(
      authDomainObjects.auth,
      customToken,
    );

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
  };
};
