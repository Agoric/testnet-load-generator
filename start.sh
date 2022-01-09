#!/bin/sh
set -e -x


LOADGEN_DIR="$(pwd)"

SDK_REPO="${SDK_REPO:-https://github.com/Agoric/agoric-sdk.git}"

# Create temporary directory for SDK source if none provided
if [ -z "${SDK_SRC}" ]
then
    SDK_REVISION=${SDK_REVISION:-$(git ls-remote ${SDK_REPO} HEAD | awk '{ print substr($1,1,12) }')}
    SDK_SRC=/tmp/agoric-sdk-src-${SDK_REVISION}
fi
mkdir -p "${SDK_SRC}"

# Clone the repo if needed
if [ ! -d "${SDK_SRC}/.git" ]
then
    git clone "${SDK_REPO}" "${SDK_SRC}"
    if [ ! -z "${SDK_REVISION}" ]
    then
        git -C "${SDK_SRC}" reset --hard ${SDK_REVISION}
    fi
    SDK_BUILD=1
fi

SDK_FULL_REVISION=$(git -C "${SDK_SRC}" rev-parse HEAD)

if [ ! -z "${SDK_REVISION}" -a "${SDK_FULL_REVISION#${SDK_REVISION}}" = "${SDK_FULL_REVISION}" ]
then
    echo "Error: SDK is currently checked out at revision ${SDK_FULL_REVISION} but revision ${SDK_REVISION} was specified"
    exit 2
fi

SDK_REVISION=$(git -C "${SDK_SRC}" rev-parse --short HEAD)

AGORIC_BIN_DIR=/tmp/agoric-sdk-bin-${SDK_REVISION}
mkdir -p ${AGORIC_BIN_DIR}

OUTPUT_DIR="${OUTPUT_DIR:-/tmp/agoric-sdk-out-${SDK_REVISION}}"
mkdir -p "${OUTPUT_DIR}"

export PATH="$AGORIC_BIN_DIR:$PATH"

cd "$SDK_SRC"
if [ "x$SDK_BUILD" != "x0" ]; then
    yarn install
    yarn build
    make -C packages/cosmic-swingset
fi

rm -f "${AGORIC_BIN_DIR}/agoric"
yarn link-cli "${AGORIC_BIN_DIR}/agoric"
ln -sf "$SDK_SRC/packages/cosmic-swingset/bin/ag-chain-cosmos" "${AGORIC_BIN_DIR}/ag-chain-cosmos"

cd "$LOADGEN_DIR"
agoric install
exec ./runner/bin/loadgen-runner --output-dir="${OUTPUT_DIR}" "$@" 2>&1 
