export const computeUserConnectionsSpans = (
  clients,
  clientConnections = {},
  logData = [],
) => {
  const clientIdsWithConnectionData = new Set(
    Object.values(clientConnections).map(({ clientId }) => clientId),
  );

  const connectLogEntries = logData
    .map(({ timestamp, textPayload }) => {
      const [delta, clientId] = textPayload.split(' ').slice(-2);

      return {
        timestamp: new Date(timestamp),
        clientId,
        delta: Number.parseInt(delta, 10),
      };
    })
    .filter(({ clientId }) => !clientIdsWithConnectionData.has(clientId));

  const clientLogConnectionsMap = new Map(
    connectLogEntries.map(({ clientId }) => [clientId, []]),
  );

  const userConnectionsMap = new Map();

  for (const [
    clientId,
    { userId, connectedAt, disconnectedAt, connected },
  ] of Object.entries(clients)) {
    let connections = userConnectionsMap.get(userId);

    if (!connections) {
      connections = [];
      userConnectionsMap.set(userId, connections);
    }

    if (!clientIdsWithConnectionData.has(clientId)) {
      connections.push({
        connectedAt: new Date(connectedAt),
        disconnectedAt: connected ? undefined : new Date(disconnectedAt),
        source: `clients:${clientId}`,
      });
    }
  }

  for (const [
    clientConnectionId,
    { clientId, connectedAt, lastSeenAt },
  ] of Object.entries(clientConnections)) {
    const { userId } = clients[clientId];
    const connections = userConnectionsMap.get(userId);

    if (connectedAt) {
      connections.push({
        connectedAt: new Date(connectedAt),
        disconnectedAt: new Date(lastSeenAt),
        source: `clientId:${clientId}:clientConnections:${clientConnectionId}`,
      });
    }
  }

  for (const { clientId, timestamp, delta } of connectLogEntries.values()) {
    const connections = clientLogConnectionsMap.get(clientId);
    const source = `connectedClientsCount:${clientId}`;

    if (delta === -1) {
      if (!connections.length) {
        connections.push({
          connectedAt: new Date(
            Math.min(clients[clientId].connectedAt, timestamp),
          ),
          source,
        });
      }

      let lastConnection = connections.slice(-1)[0];
      if (
        lastConnection.unexpected &&
        Math.abs(lastConnection.connectedAt - timestamp) < 5 * 1000
      ) {
        lastConnection.unexpected = false;
        lastConnection = connections.slice(-2)[0];
      }

      if (lastConnection.disconnectedAt) {
        console.warn('Found unexpected disconnect', {
          clientId,
          timestamp,
          lastConnection,
        });
      } else {
        lastConnection.disconnectedAt = timestamp;
      }
    } else if (delta === +1) {
      const lastConnection = connections.slice(-1)[0];

      if (lastConnection && !lastConnection.disconnectedAt) {
        connections.push({ connectedAt: timestamp, source, unexpected: true });
      } else {
        connections.push({ connectedAt: timestamp, source });
      }
    } else {
      throw new Error('Unexpected delta value');
    }
  }

  for (const [
    clientId,
    clientLogConnections,
  ] of clientLogConnectionsMap.entries()) {
    for (const [idx, connection] of clientLogConnections.entries()) {
      if (connection.unexpected) {
        console.warn('Found unexpected connect log', {
          clientId,
          previousConnection: clientLogConnections[idx - 1],
          connection,
        });
      }
    }

    const { userId } = clients[clientId];

    const userConnections = userConnectionsMap.get(userId);
    if (!userConnections) {
      console.warn('Unknown user', { userId, clientId });
    } else {
      userConnections.push(...clientLogConnections);
    }
  }

  for (const [userId, userConnections] of userConnectionsMap.entries()) {
    let activeConnection;
    const connections = [];

    userConnections.sort((a, b) => a.connectedAt - b.connectedAt);

    for (const connection of userConnections) {
      if (activeConnection && !activeConnection.disconnectedAt) {
        // other connection is still going, ignore this one
        activeConnection.source += `+${connection.source}`;
      } else if (
        activeConnection &&
        // Gloss over short transient disconnect
        connection.connectedAt - activeConnection.disconnectedAt < 2 * 1000
      ) {
        if (
          !connection.disconnectedAt ||
          activeConnection.disconnectedAt < connection.disconnectedAt
        ) {
          activeConnection.disconnectedAt = connection.disconnectedAt;
          activeConnection.source += `+${connection.source}`;
        }
      } else {
        activeConnection = { ...connection };
        connections.push(activeConnection);
      }
    }

    if (!connections.length) {
      console.log('no connections', userId, { connections, userConnections });
    }

    userConnections.splice(0, userConnections.length, ...connections);
  }

  return [...userConnectionsMap.entries()]
    .map(([userId, userConnections]) =>
      userConnections.map((connection) => ({ userId, ...connection })),
    )
    .flat();
};
