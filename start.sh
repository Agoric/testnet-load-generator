#!/bin/bash

set -o errexit

DEFAULT_NODE_VERSION="v18.20.4"
DIRECTORY_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
GITHUB_REST_API_HOST="https://api.github.com"
ORG_NAME=""
# shellcheck disable=SC2269
OUTPUT_DIR="$OUTPUT_DIR"
REPO_LINK_REGEX="https://github.com/([^/]+)/([^/]+)\.git"
REPO_NAME=""
SDK_BUILD=""
SDK_COMMIT_TIME=""
SDK_FULL_REVISION=""
SDK_REPO="${SDK_REPO:-"https://github.com/Agoric/agoric-sdk.git"}"
# shellcheck disable=SC2269
SDK_REVISION="$SDK_REVISION"
# shellcheck disable=SC2269
SDK_SRC="$SDK_SRC"

add_binary_to_path() {
    AGORIC_BIN_DIR="/tmp/agoric-sdk-bin-$SDK_REVISION"
    mkdir --parents "$AGORIC_BIN_DIR"
    export PATH="$AGORIC_BIN_DIR:$PATH"
    ln --force --symbolic \
        "$SDK_SRC/packages/cosmic-swingset/bin/ag-chain-cosmos" "$AGORIC_BIN_DIR/ag-chain-cosmos"
}

ensure_correct_revision_checkout_out() {
    SDK_FULL_REVISION=$(git -C "$SDK_SRC" rev-parse HEAD)

    # Check if SDK_FULL_REVISION doesn't start with SDK_REVISION
    if [ -n "$SDK_REVISION" ] && [ "$SDK_FULL_REVISION#$SDK_REVISION" = "$SDK_FULL_REVISION" ]; then
        echo "Error: SDK is currently checked out at revision $SDK_FULL_REVISION but revision $SDK_REVISION was specified"
        exit 2
    fi

    # Ensure we have the short sha
    SDK_REVISION=$(git -C "$SDK_SRC" rev-parse --short HEAD)
    SDK_COMMIT_TIME=$(git -C "$SDK_SRC" show --format="%ct" --no-patch "$SDK_REVISION")
}

ensure_correct_node_version() {
    local required_node_version

    OUTPUT_DIR="${OUTPUT_DIR:-"/tmp/agoric-sdk-out-$SDK_REVISION"}"

    if ! node --version >/dev/null 2>&1; then
        echo "$DEFAULT_NODE_VERSION" >"$OUTPUT_DIR/.nvmrc"
    fi

    if [ -f "$OUTPUT_DIR/.nvmrc" ]; then
        ensure_nvm_installed

        export NVM_SYMLINK_CURRENT=false
        required_node_version="$(cat "$OUTPUT_DIR/.nvmrc")"

        if [ "$(nvm version "$required_node_version")" = "N/A" ]; then
            nvm install "$required_node_version"
        fi

        nvm use "$required_node_version"
    fi
}

ensure_nvm_installed() {
    if ! nvm --help >/dev/null 2>&1; then
        echo "nvm not found, installing"
        curl --output "-" --silent \
            https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh |
            bash >/dev/null 2>&1

        if [ ! -f "$HOME/.nvm/nvm.sh" ]; then
            echo "Couldn't install nvm"
            exit 1
        fi

        # shellcheck source=/dev/null
        source "$HOME/.nvm/nvm.sh"
    fi
}

ensure_repo_folder_exists() {
    SDK_REVISION="${SDK_REVISION:-"$(get_head_commit_sha)"}"
    SDK_SRC="${SDK_SRC:-"/tmp/agoric-sdk-src-${SDK_REVISION}"}"

    mkdir --parents "$SDK_SRC"

    if [ ! -e "$SDK_SRC/.git" ]; then
        git clone "$SDK_REPO" "$SDK_SRC"
        if [ -n "$SDK_REVISION" ]; then
            git -C "$SDK_SRC" reset --hard "$SDK_REVISION"
        fi
        SDK_BUILD=1
    fi
}

extract_repo_and_org_name() {
    if [[ "$SDK_REPO" =~ $REPO_LINK_REGEX ]]; then
        ORG_NAME="${BASH_REMATCH[1]}"
        REPO_NAME="${BASH_REMATCH[2]}"
    else
        echo "$SDK_REPO is not a valid repository"
        exit 1
    fi
}

generate_build() {
    if [ "x$SDK_BUILD" != "x0" ]; then
        yarn --cwd "$SDK_SRC" install --frozen-lockfile
        yarn --cwd "$SDK_SRC" build
        make --directory "$SDK_SRC/packages/cosmic-swingset"
    fi
}

get_head_commit_sha() {
    curl "$GITHUB_REST_API_HOST/repos/$ORG_NAME/$REPO_NAME/git/refs/heads/master" \
        --location --silent |
        jq --raw-output '.object.sha'
}

install_dependencies() {
    if ! which curl >/dev/null || ! which git >/dev/null || ! which jq >/dev/null; then
        local install_packages="apt-get install curl git jq > /dev/null"
        local update_packages_info="apt-get update > /dev/null"

        if [ -z "$(which sudo)" ]; then
            eval "$update_packages_info"
            eval "$install_packages"
        else
            eval "sudo $update_packages_info"
            eval "sudo $install_packages"
        fi
    fi
}

start_runner() {
    yarn --cwd "$DIRECTORY_PATH" install
    exec "$DIRECTORY_PATH/runner/bin/loadgen-runner" \
        --output-dir "$OUTPUT_DIR" --test-data.sdk-commit-time "$SDK_COMMIT_TIME" \
        --test-data.sdk-revision "$SDK_REVISION" "$@" 2>&1
}

# install_dependencies
# extract_repo_and_org_name
# ensure_repo_folder_exists
# ensure_correct_revision_checkout_out
# ensure_correct_node_version
# generate_build
# add_binary_to_path
start_runner "$@"
