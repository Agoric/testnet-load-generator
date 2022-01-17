#!/bin/sh
set -x

# Runs a loadgen cycle for each revision from the list in the input file passed as first argument.
# The rest of the arguments are passed to the loadgen-runner, e.g. to control the duration
# Output is saved in folders under the current directory, named `manual-{revision}`
# Requires a docker image named `loadgen-runner`

next_revision() {
  read -r REPLY <&3
  echo $REPLY
}

. $(dirname "$(readlink -f -- "$0")")/common-queue.sh

INPUT=$1
shift

if [ "x$INPUT" != "x-" ]; then
  start "manual" next_revision "$@" 3<$INPUT
else
  start "manual" next_revision "$@" 3<&0
fi
