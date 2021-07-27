# Ceelab Economic Experiments

In one terminal:

```sh
agoric install
  # takes 20s
agoric start
  # leave that running
```

Then in a second terminal:

```sh
yarn workbench
```

That will launch the experimentation tools. Each will begin with a setup
phase if it has not been run before, using the ag-solo -side `scratch` table to
remember the initialized tools.

The workbench listens on ws://localhost:3353 for connections.  Send any
JSON-RPC-2.0 method calls to it and you should get replies.

See workbench/main.js for the implementation.
