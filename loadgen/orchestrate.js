/* global process */

import { makeAuthBroker } from './firebase/auth.js';
import { adminConnectionHandlerFactory } from './firebase/admin.js';

const adminBroker = makeAuthBroker(adminConnectionHandlerFactory);

adminBroker(process.argv[2]);
