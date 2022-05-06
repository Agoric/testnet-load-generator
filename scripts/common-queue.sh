#!/bin/sh

set -m

DOCKER_IMAGE="${DOCKER_IMAGE:-loadgen-runner}"
DOCKER_ID=
SLEEP_PID=

stop_sleep() { [ -z "$SLEEP_PID" ] && return; kill -TERM $SLEEP_PID; exit 0; }
stop_container() { [ -z "${DOCKER_ID}" ] && return; docker kill --signal=SIGTERM ${DOCKER_ID}; }

start() {
  TEST_TYPE=$1
  NEXT_REVISION_CMD=$2
  shift 2

  running=1
  trap '' HUP
  trap 'running=0; stop_sleep; stop_container' INT TERM

  while [ $running -eq 1 ]
  do
    while true
    do
      PREV_SDK_REVISION=${SDK_REVISION}
      SDK_REVISION=$(${NEXT_REVISION_CMD})
      [ -z "$SDK_REVISION" ] && exit 1
      OUTPUT_DIR="${TEST_TYPE}-${SDK_REVISION}"
      [ ! -d "${OUTPUT_DIR}" ] && break
      [ "x$SDK_REVISION" != "x$PREV_SDK_REVISION" ] && continue
      sleep 60 &
      SLEEP_PID=$!
      wait $SLEEP_PID
      SLEEP_PID=
    done
    echo "processing ${SDK_REVISION}"
    mkdir "${OUTPUT_DIR}"
    mkdir "${OUTPUT_DIR}/src"
    mkdir "${OUTPUT_DIR}/tmp"
    DOCKER_ID=$(docker create \
      -v loadgen-go-pkg-mod:/go/pkg/mod \
      -v loadgen-yarn-cache:/home/node/.cache/yarn \
      -v "$(pwd)/${OUTPUT_DIR}:/out" \
      -v "$(pwd)/${OUTPUT_DIR}/src:/src" \
      -v "$(pwd)/${OUTPUT_DIR}/tmp:/tmp" \
      --ulimit core=-1 \
      -e SDK_REVISION=${SDK_REVISION} \
      -e SDK_REPO=${SDK_REPO} \
      --name "${OUTPUT_DIR}" \
      "${DOCKER_IMAGE}" \
      --test-data.test-type=${TEST_TYPE} "$@" \
    ) || exit $?
    docker start ${DOCKER_ID}
    docker wait ${DOCKER_ID} >"${OUTPUT_DIR}/exit_code" &
    DOCKER_WAIT_PID=$!
    while kill -0 $DOCKER_WAIT_PID 2>/dev/null; do wait $DOCKER_WAIT_PID; done
    docker logs ${DOCKER_ID} >"${OUTPUT_DIR}/docker.log" 2>&1
    [ -d "/var/lib/docker" ] && sudo -n cat /var/lib/docker/containers/${DOCKER_ID}/${DOCKER_ID}-json.log >"${OUTPUT_DIR}/docker.json.log"
    docker rm ${DOCKER_ID}
    DOCKER_ID=
  done
}