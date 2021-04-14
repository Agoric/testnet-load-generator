# Load Generator

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
curl -X PUT --data '{"faucet":60}' http://127.0.0.1:3352/config
```

To disable the 'faucet' generator:
```sh
curl -X PUT --data '{"faucet":null}' http://127.0.0.1:3352/config
```

The (one) load generator defined so far:

* `faucet`: initialize by creating a `dapp-fungible-faucet` -style mint, then each cycle requests an invitation and completes it, adding 1000 Tokens to Bob's Purse. Takes 4 round-trips to complete.
