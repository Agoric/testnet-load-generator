/* global process */

import '@endo/init';

import { makeAuthBroker } from '../firebase/auth.js';
import {
  adminConnectionHandlerFactory,
  makeAdminApp,
} from '../firebase/admin.js';

const getAdminBroker = makeAuthBroker(
  adminConnectionHandlerFactory,
  makeAdminApp,
);

const adminBroker = getAdminBroker(process.argv[2]);

adminBroker.connect();
