#!/bin/bash

set -o errexit

DEFAULT_NODE_VERSION="v18.20.4"
DIRECTORY_PATH="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
NVM_INSTALLATION_SCRIPT_URL="https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh"
# shellcheck disable=SC2269
OUTPUT_DIR="$OUTPUT_DIR"
SDK_BUILD=""
SDK_COMMIT_TIME=""
SDK_REPO="${SDK_REPO:-"https://github.com/Agoric/agoric-sdk.git"}"
# shellcheck disable=SC2269
SDK_REVISION="$SDK_REVISION"
# shellcheck disable=SC2269
SDK_SRC="$SDK_SRC"

add_binary_to_path() {
    if test -n "$SDK_REVISION"; then
        AGORIC_BIN_DIR="/tmp/agoric-sdk-bin-$SDK_REVISION"
        mkdir --parents "$AGORIC_BIN_DIR"
        export PATH="$AGORIC_BIN_DIR:$PATH"
        ln --force --symbolic \
            "$SDK_SRC/packages/cosmic-swingset/bin/ag-chain-cosmos" "$AGORIC_BIN_DIR/ag-chain-cosmos"
    fi
}

ensure_correct_node_version() {
    if test -n "$SDK_REVISION"; then
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
    fi
}

ensure_nvm_installed() {
    if ! nvm --help >/dev/null 2>&1; then
        echo "nvm not found, installing"
        curl --output "-" --silent "$NVM_INSTALLATION_SCRIPT_URL" |
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
    if test -n "$SDK_REVISION"; then
        SDK_SRC="${SDK_SRC:-"/tmp/agoric-sdk-src-${SDK_REVISION}"}"

        mkdir --parents "$SDK_SRC"

        if [ ! -e "$SDK_SRC/.git" ]; then
            git clone "$SDK_REPO" "$SDK_SRC"
            git -C "$SDK_SRC" reset --hard "$SDK_REVISION"
            SDK_BUILD=1
        fi

        SDK_COMMIT_TIME=$(git -C "$SDK_SRC" show --format="%ct" --no-patch "$SDK_REVISION")
    fi
}

generate_build() {
    if [ -n "$SDK_REVISION" ] && [ "x$SDK_BUILD" != "x0" ]; then
        yarn --cwd "$SDK_SRC" install --frozen-lockfile
        yarn --cwd "$SDK_SRC" build
        make --directory "$SDK_SRC/packages/cosmic-swingset"
    fi
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

install_dependencies
ensure_repo_folder_exists
ensure_correct_node_version
generate_build
add_binary_to_path
start_runner "$@"
