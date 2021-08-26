export const computeUserConnectionsSpans = (clients, logData = []) => {
  const connectLogEntries = logData.map(({ timestamp, textPayload }) => {
    const [delta, clientId] = textPayload.split(' ').slice(-2);

    return {
      timestamp: new Date(timestamp),
      clientId,
      delta: Number.parseInt(delta, 10),
    };
  });

  const clientLogConnectionsMap = new Map(
    connectLogEntries.map(({ clientId }) => [clientId, []]),
  );

  const userConnectionsMap = new Map();

  for (const {
    userId,
    connectedAt,
    disconnectedAt,
    connected,
  } of Object.values(clients)) {
    let connections = userConnectionsMap.get(userId);

    if (!connections) {
      connections = [];
      userConnectionsMap.set(userId, connections);
    }

    connections.push({
      connectedAt: new Date(connectedAt),
      disconnectedAt: connected ? undefined : new Date(disconnectedAt),
    });
  }

  for (const { clientId, timestamp, delta } of connectLogEntries.values()) {
    const connections = clientLogConnectionsMap.get(clientId);

    if (delta === -1) {
      if (!connections.length) {
        connections.push({
          connectedAt: new Date(
            Math.min(clients[clientId].connectedAt, timestamp),
          ),
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
        connections.push({ connectedAt: timestamp, unexpected: true });
      } else {
        connections.push({ connectedAt: timestamp });
      }
    } else {
      throw new Error('Unexpected delta value');
    }
  }

  for (const [
    clientId,
    clientConnections,
  ] of clientLogConnectionsMap.entries()) {
    clientConnections.forEach((connection, idx) => {
      if (connection.unexpected) {
        console.warn('Found unexpected connect log', {
          clientId,
          previousConnection: clientConnections[idx - 1],
          connection,
        });
      }
    });

    const { userId } = clients[clientId];

    const userConnections = userConnectionsMap.get(clients[clientId].userId);
    if (!userConnections) {
      console.warn('Unknown user', { userId, clientId });
    } else {
      userConnections.push(...clientConnections);
    }
  }

  for (const [userId, userConnections] of userConnectionsMap.entries()) {
    let activeConnection;
    const connections = [];

    userConnections.sort((a, b) => a.connectedAt - b.connectedAt);

    for (const connection of userConnections) {
      if (activeConnection && !activeConnection.disconnectedAt) {
        // other connection is still going, ignore this one
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
