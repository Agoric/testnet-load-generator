export const updateConfigs = async (data) => {
  const computed = data.child('computed');
  const config = data.child('config');
  const root = data.ref.parent;
  let candidates = computed.child('connectedClients').val();

  const taskWeights = config.child('taskWeights').val() || {};
  const targetCycleStarts = config.child('cycleStartsPerMinute').val() || 0;

  const weightDenom = Object.values(taskWeights)
    .filter((weight) => weight)
    .reduce((acc, weight) => acc + weight, 0);

  const targetInterval = (60 * candidates) / targetCycleStarts;

  const taskIntervals =
    targetCycleStarts && targetInterval && weightDenom
      ? Object.fromEntries(
          Object.entries(taskWeights)
            .filter(([, weight]) => weight)
            .map(([name, weight]) => [
              name,
              (targetInterval * weightDenom) / weight,
            ]),
        )
      : null;

  let connectedClientIds = [];
  if (taskIntervals) {
    const clientsRef = root.child('clients');
    const connectedClients = clientsRef.orderByChild('connected').equalTo(true);

    const connectedClientsSnap = await connectedClients.once('value');
    connectedClientIds = Object.keys(connectedClientsSnap.val() || {});

    // TODO: recompute earlier or compute other later
    candidates = connectedClientIds.length;
  }

  const configs = candidates
    ? Object.fromEntries(
        connectedClientIds.map((clientId, clientIdx) => [
          clientId,
          Object.fromEntries(
            Object.entries(taskIntervals).map(([name, interval], taskIdx) => [
              name,
              {
                interval,
                wait:
                  // rudimental task staggering (ignoring weights)
                  (taskIdx * targetInterval +
                    (clientIdx * interval) / candidates) %
                  interval,
              },
            ]),
          ),
        ]),
      )
    : null;

  const requested = {
    intervals: taskIntervals,
    clients: connectedClientIds.length,
  };

  console.log(
    'updating config',
    'candidates=',
    candidates,
    'targetCycleStarts=',
    targetCycleStarts,
    'taskIntervals=',
    JSON.stringify(taskIntervals),
  );

  return data.ref.parent.update({
    [`${data.key}/requested`]: requested,
    requestedConfigs: configs,
  });
};

export const updateNeeded = (data) => {
  const computed = data.child('computed');
  const requested = data.child('requested');
  const config = data.child('config');

  if (
    !computed.hasChild('connectedClients') ||
    !computed.hasChild('enrolledClients')
  ) {
    return null;
  }

  const taskWeights = config.child('taskWeights').val() || {};

  const taskIntervals = requested.child('intervals').val() || {};

  const targetActiveTasks = Object.entries(taskWeights)
    .filter(([, weight]) => weight) // 0 weight are disabled
    .map(([name]) => name)
    .sort();
  const requestedTasks = Object.keys(taskIntervals).sort();

  if (
    targetActiveTasks.length !== requestedTasks.length ||
    !targetActiveTasks.every((task, i) => task === requestedTasks[i])
  ) {
    console.log(
      `'${requestedTasks.join(
        '+',
      )}' current tasks differ from '${targetActiveTasks.join(
        '+',
      )}' target tasks`,
    );
    return true;
  }

  if (!targetActiveTasks.length) {
    // consider making sure requested is cleared out
  }

  const adjustedIntervals = Object.entries(taskIntervals).map(
    ([name, value]) => value * taskWeights[name],
  );

  if (
    !adjustedIntervals.every((interval) => interval === adjustedIntervals[0])
  ) {
    console.log('active task weights have changed');
    return true;
  }

  const targetCycleStarts = config.child('cycleStartsPerMinute').val() || 0;
  const enrolledClients = computed.child('enrolledClients').val();

  const effectiveCycleStarts =
    Object.values(taskIntervals).reduce(
      (acc, interval) => acc + 60 / interval,
      0,
    ) * enrolledClients;

  if (
    !(effectiveCycleStarts === 0 && targetCycleStarts === 0) &&
    (Number.isNaN(effectiveCycleStarts) ||
      targetCycleStarts === 0 ||
      Math.abs(effectiveCycleStarts - targetCycleStarts) / targetCycleStarts >
        10 / 100)
  ) {
    console.log(
      `${effectiveCycleStarts} cycles starts per minutes deviated from target of ${targetCycleStarts}`,
    );
    return true;
  }

  const candidates = computed.child('connectedClients').val();

  if (
    !(enrolledClients === 0 && candidates === 0) &&
    Math.abs((enrolledClients - candidates) * 2) /
      (enrolledClients + candidates) >
      10 / 100
  ) {
    console.log(
      `${enrolledClients} enrolled clients deviated from ${candidates} candidates`,
    );
    return true;
  }

  return false;
};
