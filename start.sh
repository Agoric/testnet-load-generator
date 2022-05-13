#!/bin/sh
set -e -x

LOADGEN_DIR="$(dirname "$(readlink -f -- "$0")")"

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
SDK_COMMIT_TIME=$(git -C "${SDK_SRC}" show -s --format=%ct ${SDK_REVISION})

AGORIC_BIN_DIR=/tmp/agoric-sdk-bin-${SDK_REVISION}
mkdir -p ${AGORIC_BIN_DIR}

OUTPUT_DIR="${OUTPUT_DIR:-/tmp/agoric-sdk-out-${SDK_REVISION}}"
mkdir -p "${OUTPUT_DIR}"

export PATH="$AGORIC_BIN_DIR:$PATH"

if [ ! -f "${OUTPUT_DIR}/.nvmrc" ] ; then
    SDK_NODE16_REVISION=475d7ff1eb2371aa9e0c0dc7a50644089db351f6
    if git -C "${SDK_SRC}" cat-file -e $SDK_NODE16_REVISION^{commit} && \
      ! git -C "${SDK_SRC}" merge-base --is-ancestor $SDK_NODE16_REVISION $SDK_FULL_REVISION
    then
        echo "lts/fermium" > "${OUTPUT_DIR}/.nvmrc"
    fi
    if [ -n "$NVM_RC_VERSION" ]; then 
        echo "$NVM_RC_VERSION" > "${OUTPUT_DIR}/.nvmrc"
    fi
fi

if [ -f "${OUTPUT_DIR}/.nvmrc" ] ; then
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    export NVM_SYMLINK_CURRENT=false
    cd "${OUTPUT_DIR}"
    if [ "$(nvm version "$(cat ".nvmrc")")" = "N/A" ]; then
        nvm install
    fi
    nvm use
    cd -
fi

cd "$SDK_SRC"
if [ "x$SDK_BUILD" != "x0" ]; then
    npm_config_debug="true" yarn install --frozen-lockfile
    yarn build
    make -C packages/cosmic-swingset
fi

rm -f "${AGORIC_BIN_DIR}/agoric"
yarn link-cli "${AGORIC_BIN_DIR}/agoric"
ln -sf "$SDK_SRC/packages/cosmic-swingset/bin/ag-chain-cosmos" "${AGORIC_BIN_DIR}/ag-chain-cosmos"

cd "$LOADGEN_DIR"
agoric install

exec ./runner/bin/loadgen-runner --output-dir="${OUTPUT_DIR}" --test-data.sdk-revision=${SDK_REVISION} --test-data.sdk-commit-time=${SDK_COMMIT_TIME} --trace rr "$@" 2>&1 
