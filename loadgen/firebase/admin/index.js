import functions from 'firebase-functions';
import admin from 'firebase-admin';
import { Logging } from '@google-cloud/logging';

import { debounce } from './helpers.js';
import { updateConfigs, updateNeeded } from './config.js';
import { computeUserConnectionsSpans } from './user-connections.js';

admin.initializeApp();

const defaultIncluded = (snap) => snap.exists();

const updateCollectionCount = ({
  collectionEntryPath,
  countPath,
  idParam,
  logDesc,
  included = defaultIncluded,
  excluded = (snap) => !included(snap),
}) =>
  functions.database
    .ref(collectionEntryPath)
    .onWrite(async (change, context) => {
      const db = admin.database();
      const countRef = db.ref(countPath);

      let delta;
      if (excluded(change.before) && included(change.after)) {
        delta = 1;
      } else if (included(change.before) && excluded(change.after)) {
        delta = -1;
      } else {
        return null;
      }

      await countRef.set(admin.database.ServerValue.increment(delta));

      if (logDesc) {
        functions.logger.log(
          `${logDesc} total updated.`,
          delta > 0 ? `+${delta}` : delta,
          context.params[idParam],
        );
      }
      return null;
    });

// Keep track of connecting clients
export const connectedClientsCount = updateCollectionCount({
  collectionEntryPath: '/loadgen/clients/{clientId}/connected',
  countPath: '/loadgen/admin/computed/connectedClients',
  idParam: 'clientId',
  logDesc: 'Connected clients',
  included: (snap) => snap.val() === true,
  excluded: (snap) => !snap.exists() || snap.val() === false,
});

// If the number of likes gets deleted, recount the number of likes
export const recountConnectedClients = functions.database
  .ref('/loadgen/admin/computed/connectedClients')
  .onDelete(async (snap) => {
    const db = admin.database();
    const countRef = snap.ref;
    const clientsRef = db.ref('/loadgen/clients');
    const connectedClients = clientsRef.orderByChild('connected').equalTo(true);

    const connectedClientsSnap = await connectedClients.once('value');
    return countRef.set(connectedClientsSnap.numChildren());
  });

// Keep track of active cycles
export const activeCyclesCount = updateCollectionCount({
  collectionEntryPath: '/loadgen/cycles/{cycleId}',
  countPath: '/loadgen/admin/computed/activeCycles',
  idParam: 'cycleId',
  logDesc: 'Active cycles',
  included: (snap) => snap.hasChild('startedAt') && !snap.hasChild('success'),
});

export const recountActiveCycles = functions.database
  .ref('/loadgen/admin/computed/activeCycles')
  .onDelete(async (snap) => {
    const db = admin.database();
    const countRef = snap.ref;
    const cyclesRef = db.ref('/loadgen/cycles');
    const maybeActiveCycles = cyclesRef.orderByChild('success').equalTo(null);

    const maybeActiveCyclesSnap = await maybeActiveCycles.once('value');
    const count =
      maybeActiveCyclesSnap.numChildren() &&
      Object.values(maybeActiveCyclesSnap.val()).reduce(
        (acc, cycle) => (cycle.startedAt ? acc + 1 : acc),
        0,
      );

    return countRef.set(count);
  });

// Keep track of requested clients still connected
export const enrolledClientsCount = updateCollectionCount({
  collectionEntryPath: '/loadgen/requestedConfigs/{clientId}',
  countPath: '/loadgen/admin/computed/enrolledClients',
  idParam: 'clientId',
  logDesc: 'Enrolled clients',
});

// If the number of likes gets deleted, recount the number of likes
export const recountEnrolledClients = functions.database
  .ref('/loadgen/admin/computed/enrolledClients')
  .onDelete(async (snap) => {
    const db = admin.database();
    const countRef = snap.ref;
    const configsRef = db.ref('/loadgen/requestedConfigs');

    const enrolledClientsSnap = await configsRef.once('value');
    return countRef.set(enrolledClientsSnap.numChildren());
  });

const after = (change) => change.after;

export const adminShapeChange = functions.database
  .ref('/loadgen/admin')
  .onWrite(
    debounce(async (change) => {
      const data = after(change);
      if (updateNeeded(data)) {
        return updateConfigs(data);
      }
      return null;
    }, after),
  );

export const userConnectedSpans = functions.https.onRequest(
  async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(403).send('Forbidden!');
      return;
    }

    const clients = (
      await admin.database().ref('/loadgen/clients').once('value')
    ).val();

    let logData;

    if (req.query.includeLogs) {
      const startDate = new Date(
        Math.min(
          ...[...Object.values(clients)].map(({ connectedAt }) =>
            new Date(connectedAt).valueOf(),
          ),
        ),
      );

      const logging = new Logging();

      const [entries] = await logging.getEntries({
        log: 'cloudfunctions.googleapis.com%2Fcloud-functions',
        filter: `timestamp > "${startDate.toISOString()}" resource.labels.function_name="connectedClientsCount" severity=INFO`,
        pageSize: 1000,
        orderBy: 'timestamp asc',
      });

      logData = entries.map(({ metadata }) => metadata);
    }

    const userConnectionsData = computeUserConnectionsSpans(clients, logData);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(JSON.stringify(userConnectionsData, null, 2));
  },
);
