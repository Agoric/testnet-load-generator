# Load Generator

The loadgen is implemented as a dapp deploy script which runs forever and listens for config updates. It can perform 3 different type of load generating tasks at any given interval (cycle): `faucet`, `amm`, `vault`. Each task is deployed to a vat on the solo client. Additionally the `faucet` task installs a faucet app on the chain. When the loadgen server starts a task's cycle, it invokes the task's agent running on the solo client, which performs its load generation on the chain.

The loadgen accepts config updates from a local http port.

For alternative usages of the loadgen, see the [Extended Readme](./README-extended.md).

## Setup

Since the loadgen is a dapp, it requires a local `agoric-sdk` to execute, and a running solo client provisioned and connected to a chain.

### Prerequisite

Make sure you have the `agoric-sdk` with the correct revision built, with the `agoric` cli available in your PATH. Follow the steps in the guide to [Install the SDK](https://github.com/Agoric/agoric-sdk/wiki/Validator-Guide-for-Incentivized-Testnet#install-agoric-sdk).

### Running client

To interact with the chain, a client must be running. With a local agoric-sdk available, the easiest to run a client for the testnet chain is directly using the following command:

```sh
agoric start testnet
```

The above command stores the client's state in the current directory's `_agstate/agoric-servers/testnet-8000`. If for any reason you need to reset your client, you can delete that directory.

More information can be found in the [agoric CLI reference](https://agoric.com/documentation/guides/agoric-cli/commands.html#agoric-start).

Alternatively, you can run the [client as a docker image](https://github.com/Agoric/agoric-sdk/wiki/Setting-up-an-Agoric-Dapp-Client-with-docker-compose).

#### Optional: Make client use a private RPC node

To avoid having the solo client, and by extension the loadgen, be impacted by load on public RPC nodes, it's preferable to initially configure the client to connect to a private RPC chain node. When running the solo client directly, the easiest is to start the client specifying a modified network-config.

```sh
wget https://testnet.agoric.net/network-config
vi network-config # add/replace rpcAddrs with the address of the local chain node
agoric start testnet 8000 $(pwd)/network-config
```

### Start the loadgen

After the client is started (`Deployed Wallet!` shown in the output), the loadgen can be started as well.

```sh
yarn loadgen
```

or directly using the `agoric` cli

```sh
agoric deploy loadgen/loop.js
```

See the [deploy CLI reference](https://agoric.com/documentation/guides/agoric-cli/commands.html#agoric-deploy) for options like configuring the host/port of the client.

## Loadgen types

The load generators defined so far:

- `faucet`: initialize by creating a `dapp-fungible-faucet` -style mint on the chain, then each cycle requests an invitation and completes it, adding 1000 Tokens to Bob's Purse. Takes 4 round-trips to complete.
- `amm`: initialize by selling some (currently 33%) of the initial RUN to get BLD, then record the balances. Each cycle sells 1% of the recorded BLD to get RUN, then sells 1% of the recorded RUN to get BLD. Because of fees, the total available will drop slowly over time.
- `vault`: initialize by recording our BLD balance and the BLD/RUN price. Each cycle deposits 1% of the recorded BLD balance and borrows half its value in RUN, then pays back the loan and recovers the BLD (less fees).
