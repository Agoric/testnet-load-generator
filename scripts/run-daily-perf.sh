#!/bin/sh
set -x

# Runs a full 24h loadgen on the latest HEAD and save the output in the current directory
# Requires a docker image named `loadgen-runner`

running=0
SDK_REPO="${SDK_REPO:-https://github.com/Agoric/agoric-sdk.git}"
DOCKER_ID=

stop() { [ $running -eq 0 ] && exit 0 || running=0; }
stop_container() { [ -z "${DOCKER_ID}" ] || docker stop ${DOCKER_ID}; }

trap '' HUP
trap 'stop; stop_container' INT TERM

while true
do
  while true
  do
    SDK_REVISION=$(git ls-remote ${SDK_REPO} HEAD | awk '{ print substr($1,1,12) }')
    OUTPUT_DIR="daily-perf-${SDK_REVISION}"
    [ ! -d "${OUTPUT_DIR}" ] && break
    sleep 60
  done
  echo "processing ${SDK_REVISION}"
  mkdir "${OUTPUT_DIR}"
  running=1
  DOCKER_ID=$(docker create -v "$(pwd)/${OUTPUT_DIR}:/out" -e SDK_REVISION=${SDK_REVISION} --name "${OUTPUT_DIR}" loadgen-runner --no-reset) || exit $?
  docker start ${DOCKER_ID}
  docker wait ${DOCKER_ID} >"${OUTPUT_DIR}/exit_code"
  docker logs ${DOCKER_ID} >"${OUTPUT_DIR}/docker.log" 2>&1
  [ -d "/var/lib/docker" ] && sudo cat /var/lib/docker/containers/${DOCKER_ID}/${DOCKER_ID}-json.log >"${OUTPUT_DIR}/docker.json.log"
  docker rm ${DOCKER_ID}
  DOCKER_ID=
  stop
done
