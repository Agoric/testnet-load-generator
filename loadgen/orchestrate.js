/* global process */

import { makeAuthBroker } from './firebase/auth.js';
import {
  adminConnectionHandlerFactory,
  makeAdminApp,
} from './firebase/admin.js';

const adminBroker = makeAuthBroker(adminConnectionHandlerFactory, makeAdminApp);

adminBroker(process.argv[2]);
