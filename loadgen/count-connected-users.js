/* global process */

import '@agoric/install-ses';

import { fetchAsJSON } from '../runner/lib/tasks/helpers.js';

import { computeUserConnectionsSpans } from './firebase/admin/user-connections.js';

// ${firebaseOrigin}/loadgen/clients.json
const clientsUrl = process.argv[2];
// file:///path/to/downloaded.log
// download as JSON from Cloud Function Log Explorer with query
// log_name="projects/${projectId}/logs/cloudfunctions.googleapis.com%2Fcloud-functions"
// resource.labels.function_name="connectedClientsCount"
// severity="INFO"
const logUrl = process.argv[3];

(async () => {
  const clients = await fetchAsJSON(clientsUrl);

  const logData = logUrl ? await fetchAsJSON(logUrl) : [];

  const userConnectionsData = computeUserConnectionsSpans(clients, logData);

  console.log(JSON.stringify(userConnectionsData, null, 2));
})().then(
  (res) => {
    res === undefined || process.exit(res);
  },
  (rej) => {
    // console.log(process._getActiveRequests(), process._getActiveHandles());
    console.error(rej);
    process.exit(2);
  },
);
