# Load Generator (Extended)

## Runner

The loadgen runner automates running any number of load generation cycles on a local or testnet chain, monitoring the local chain node and vats processes. Depending on the use case, it can be ran using a local Agoric SDK repo, or checkout and setup any given revision, with multiple layers of helpers to automate the execution:

- `loadgen-runner` executable: core tool automating loadgen cycles against an installed agoric SDK (available on PATH)
- `start.sh` script: helper to automate checking out any agoric-sdk revision, compile and install it in a temporary location, and run the load generator with it. Can also be used an existing agoric-sdk repo.
- docker image: A Linux Debian environment setup with all dependencies to allow compiling the agoric-sdk. The entrypoint executes the start script, and has mount points for output directory and optionally an SDK repo.
- `run-daily-perf.sh` script: service entrypoint to continuously execute a `loadgen-runner` docker image against the latest revision with the default options.

### `loadgen-runner` executable

At the core, the loadgen-runner can be configured to run multiple stages of load generation, either on a local solo chain, or against an existing chain, automatically spawning a ag-solo client and deploying the loadgen tool. It captures the slog file of the local chain node, the state storage of the chain at the end of each stage, and process and disk usage information.

#### Command

Assuming the agoric-sdk and cosmic-swingset are built and installed, and the agoric cli is available in `PATH`.

```sh
mkdir -p $HOME/loadgen-output
./runner/bin/loadgen-runner --output-dir=$HOME/loadgen-output
```

#### Options

The runner uses `yargs-parser` to parse the string command line arguments, and handles dynamically creating a complex `argv` object from them. It automatically converts unary arguments into boolean (with support for `no-` negation prefix), number conversion, nested objects with dot (`.`) notation, and does kebab to camel case conversion.

Currently the following options are available:

- `--output-dir`: the directory location where to put the results from the loadgen cycles (`perf.jsonl`, chain node slogs, chain node storage). Defaults to `results/run-{posixtime}` in the working directory.
- `--profile`: (experimental) the chain target, either `local` (default), `testnet` or `stage`.
- `--no-monitor`: allows disabling running a chain monitor node (for non `local` profiles).
- `--monitor-interval`: a number in minutes for the interval at which to capture process stats for the chain.
- `--no-reset`: a boolean option to control whether the local chain state directory should be checked out clean before starting.
- `--stages`: the total number of stages to run. Default to 6
- `--stage.loadgen.*`: the object to use as default loadgen config for the stages. Created from multiple arguments and passed as-is to the loadgen tool.
- `--stage.duration`: the time in minutes to use as default duration for each loadgen stage (non chain-only, see below). Defaults to 360 minutes (6 hours).
- `--stage.n.*`: Override config for a given stage 0 <= n < `--stages`
- `--stage.n.loadgen.*`: the object to use as loadgen config for the given stage. If specified and `chain-only` is missing Created from multiple arguments and passed as-is to the loadgen tool.
- `--stage.n.
- `--stage.n.chain-only`: boolean flag specifying if the stage should only run the chain node and not start a client or loadgen. Defaults to `true` for first and last stage. Defaults to `false` for other stages, or if `--stage.n.loadgen.*` is specified.
- `--stage.n.save-storage`: boolean indicating if the storage of the chain node should be saved at the end of the stage. Defaults to `true` for non stage-only stages (where the loadgen runs), as well as for stage 0 (to capture local bootstrap).
- `--stage.n.duration`: the time in minutes for the stage duration. Defaults to the shared duration above for non chain-only stages, or 0 (immediate stop after start) otherwise. Use a negative value to run until interrupted.

### `start.sh` script

The start script automates checking out and setting up any revision of the Agoric SDK before launching the loadgen-runner. It does so without interfering with an existing sdk installation by default, but can also be pointed to run the setup steps on an existing checked out repository.

All command line arguments are passed through to `loadgen-runner`.

#### Environment

- `OUTPUT_DIR`: directory containing output artifacts. Creates temporary folder derived from revision if not set (`/tmp/agoric-sdk-out-{SDK_REVISION}`)
- `SDK_SRC`: directory containing `agoric-sdk` repo. Creates temporary folder if not set (`/tmp/agoric-sdk-src-{SDK_REVISION}`)
- `SDK_REVISION`: The agoric-sdk git revision to checkout for the test, if no existing repo found. Remote head if not set

#### Examples

```sh
SDK_REVISION=fa7ff5e55e OUTPUT_DIR=$HOME/loadgen-output ./start.sh
```

```sh
SDK_SRC=../agoric-sdk ./start.sh --stage.duration=10
```

### Docker image

The Docker image provides a Linux Debian environment setup with all dependencies to allow compiling the agoric-sdk. The entrypoint executes the start script, and has mount points for output directory and optionally an SDK repo.

#### Mount points

- `/out`: directory containing output artifacts
- `/src`: directory containing `agoric-sdk` repo. Automatically checked out if not a git repo (empty)

#### Environment

- `SDK_REVISION`: The agoric-sdk git revision to checkout for the test

#### Examples

First build the image:

```sh
docker build . -t loadgen-runner
```

To perform a loadgen cycle on a given revision:

```sh
OUTPUT_DIR=$HOME/loadgen-output
mkdir -p $OUTPUT_DIR
docker run --rm -v $OUTPUT_DIR:/out -e SDK_REVISION=fa7ff5e55e loadgen-runner --no-reset
```

To use an existing agoric-sdk copy

```sh
OUTPUT_DIR=$HOME/loadgen-output
mkdir -p $OUTPUT_DIR
docker run --rm -v $OUTPUT_DIR:/out -v ../agoric-sdk:/src loadgen-runner  --no-reset --stage.duration=10
```

### `run-daily-perf.sh` script

The script is used as a service entrypoint to continuously execute a `loadgen-runner` docker image against the latest SDK revision with the default options. It creates output folders in the current working directory based on the latest revision. The script waits for a new revision to be available if results already exist.

## Manual

The loadgen is implemented as a dapp deploy script which runs forever, and opens an HTTP server on a local port to receive config updates.

### Example

In one terminal:

```sh
agoric install
  # takes 20s
agoric start local-chain
  # wait for "finalizing commit..", takes ~4min
  # leave that running
```

In a second terminal:

```sh
agoric start local-solo 8000
  # wait for (???), maybe 1min
```

Then in a third terminal:

```sh
yarn loadgen
```

That will launch several (currently just one) load generation tools. Each
will begin with a setup phase if it has not been run before, using the
ag-solo -side `scratch` table to remember the initialized tools.

The load generator listens on localhost port 3352 for generation-rate
instructions. The config object maps gnerator name to rate (seconds between
cycles). To read the current config:

```sh
curl http://127.0.0.1:3352/config
```

To set the 'faucet' generator to run once per minute:

```sh
curl -X PUT --data '{"faucet":{"interval":60}}' http://127.0.0.1:3352/config
```

To disable all generators:

```sh
curl -X PUT --data '{}' http://127.0.0.1:3352/config
```

### Loadgen types

The load generators defined so far:

- `faucet`: initialize by creating a `dapp-fungible-faucet` -style mint, then each cycle requests an invitation and completes it, adding 1000 Tokens to Bob's Purse. Takes 4 round-trips to complete.
- `amm`: initialize by selling some (currently 33%) of the initial RUN to get BLD, then record the balances. Each cycle sells 1% of the recorded BLD to get RUN, then sells 1% of the recorded RUN to get BLD. Because of fees, the total available will drop slowly over time.
- `vault`: initialize by recording our BLD balance and the BLD/RUN price. Each cycle deposits 1% of the recorded BLD balance and borrows half its value in RUN, then pays back the loan and recovers the BLD (less fees).
