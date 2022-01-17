#!/bin/sh
set -x

# Runs a loadgen cycle on the current HEAD, until stopped. Polls for a new revision every minute.
# The arguments are passed to the loadgen-runner, e.g. to control the duration which by default is 24h
# Output is saved in folders under the current directory, named `daily-perf-{revision}`
# Requires a docker image named `loadgen-runner`

SDK_REPO="${SDK_REPO:-https://github.com/Agoric/agoric-sdk.git}"

next_revision() {
  git ls-remote ${SDK_REPO} HEAD | awk '{ print substr($1,1,12) }'
}

. $(dirname "$(readlink -f -- "$0")")/common-queue.sh

start "daily-perf" next_revision "$@"
