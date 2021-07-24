#!/bin/sh
set -x

# Runs a full 24h loadgen on the latest HEAD and save the output in the current directory
# Requires a docker image named `loadgen-runner`

SDK_REPO="${SDK_REPO:-https://github.com/Agoric/agoric-sdk.git}"
running=1
DOCKER_ID=
SLEEP_PID=

stop_sleep() { [ -z "$SLEEP_PID" ] && return; kill -TERM $SLEEP_PID; exit 0; }
stop_container() { [ -z "${DOCKER_ID}" ] && return; docker kill --signal=SIGTERM ${DOCKER_ID}; }

trap '' HUP
trap 'running=0; stop_sleep; stop_container' INT TERM

while [ $running -eq 1 ]
do
  while true
  do
    SDK_REVISION=$(git ls-remote ${SDK_REPO} HEAD | awk '{ print substr($1,1,12) }')
    OUTPUT_DIR="daily-perf-${SDK_REVISION}"
    [ ! -d "${OUTPUT_DIR}" ] && break
    sleep 60 &
    SLEEP_PID=$!
    wait $SLEEP_PID
    SLEEP_PID=
  done
  echo "processing ${SDK_REVISION}"
  mkdir "${OUTPUT_DIR}"
  DOCKER_ID=$(docker create -v "$(pwd)/${OUTPUT_DIR}:/out" -e SDK_REVISION=${SDK_REVISION} --name "${OUTPUT_DIR}" loadgen-runner --no-reset) || exit $?
  docker start ${DOCKER_ID}
  docker wait ${DOCKER_ID} >"${OUTPUT_DIR}/exit_code" &
  DOCKER_WAIT_PID=$!
  while kill -0 $DOCKER_WAIT_PID 2>/dev/null; do wait $DOCKER_WAIT_PID; done
  docker logs ${DOCKER_ID} >"${OUTPUT_DIR}/docker.log" 2>&1
  [ -d "/var/lib/docker" ] && sudo -n cat /var/lib/docker/containers/${DOCKER_ID}/${DOCKER_ID}-json.log >"${OUTPUT_DIR}/docker.json.log"
  docker rm ${DOCKER_ID}
  DOCKER_ID=
done
