#! /bin/sh
set -e -x

AGORIC_SDK_GITHUB_REPO=https://github.com/Agoric/agoric-sdk
GIT_HEAD="$(git ls-remote $AGORIC_SDK_GITHUB_REPO.git HEAD | awk '{ print substr($1,1,10) }')"

LOADGEN_DIR=$(pwd)
WORK_DIR=/tmp/agoric-sdk-${GIT_HEAD}

mkdir -p $WORK_DIR/bin $WORK_DIR/src $WORK_DIR/out $WORK_DIR/go/bin
export GOPATH=$WORK_DIR/go
export PATH=$WORK_DIR/bin:$GOPATH/bin:$PATH

if [ ! -d $WORK_DIR/src/.git ]
then
    git clone $AGORIC_SDK_GITHUB_REPO.git $WORK_DIR/src
fi

cd $WORK_DIR/src
git fetch
git reset --hard $GIT_HEAD
yarn install
yarn build
make -C packages/cosmic-swingset
rm -f $WORK_DIR/bin/agoric
yarn link-cli $WORK_DIR/bin/agoric

cd $LOADGEN_DIR
agoric install
./runner/bin/loadgen-runner $WORK_DIR/out 2>&1 | tee $WORK_DIR/out/runner.log
