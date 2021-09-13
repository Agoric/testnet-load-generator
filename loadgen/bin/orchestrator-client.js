/* global process */

import '@agoric/install-ses';

import { makeAuthBroker } from '../firebase/auth.js';
import { makeClientConnectionHandlerFactory } from '../firebase/client.js';

const connectionHandlerFactory = makeClientConnectionHandlerFactory('test');

const getClientBroker = makeAuthBroker(connectionHandlerFactory);

const clientBroker = getClientBroker(process.argv[2]);
clientBroker.connect();
