#!/bin/sh
set -o errexit

ORGANIZATION_NAME="Agoric"
REPOSITORY_NAME="agoric-sdk"

SDK_REPO="${SDK_REPO:-"https://github.com/$ORGANIZATION_NAME/$REPOSITORY_NAME.git"}"

SDK_REVISION=${SDK_REVISION:-"$(git ls-remote "$SDK_REPO" HEAD | awk '{ print substr($1,1,12) }')"}

OUTPUT_DIR="${OUTPUT_DIR:-"/tmp/$REPOSITORY_NAME-out-$SDK_REVISION"}"
SDK_COMMIT_TIME=$(
    date --date "$(
        curl "https://api.github.com/repos/$ORGANIZATION_NAME/$REPOSITORY_NAME/commits/$SDK_REVISION" --silent |
        jq '.commit.committer.date' --raw-output
    )" +"%s"
)

mkdir --parents "$OUTPUT_DIR"

exec ./runner/bin/loadgen-runner \
 --output-dir="$OUTPUT_DIR" --test-data.sdk-commit-time="$SDK_COMMIT_TIME" \
 --test-data.sdk-revision="$SDK_REVISION" "$@" 2>&1
