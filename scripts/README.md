This file contains scripts to automate running the loadgen on multiple revisions and generate stats.

## Daily and manual perf scripts

The `run-daily-perf.sh` and `run-manual.sh` both execute loadgen cycles on a "stream" of revisions, and save the resulting data in a new folder created in the current directory and named after the revision. In the former's case, the stream of revision is the latest HEAD of the github repository. In the latter's case, the stream of revision is a file provided as first argument.

Requires a docker image named `loadgen-runner`. Extra arguments are passed to the container.

### Daily perf service

`loadgen-daily-perf.service` is an example of systemd service file to automatically run the daily-perf loadgen testing.

### Manual perf example

```sh
cat << EOF | /path/to/testnet-load-generator/scripts/run-manual.sh - \
  --no-stage.save-storage \
  --stage.duration=30 \
  --monitor-interval=1 \
  --stage.loadgen.vault.interval=60 \
  --stage.loadgen.amm.interval=60 \
  --stage.loadgen.amm.wait=30
549c301
eba2fe2
79a450f
EOF
```

## Stats

Currently gathering stats from the loadgen is done manually. To generate a CSV file with some summarized stats, use the following command, e.g. from the directory where manual loadgen results are stored:

```sh
tail -q -n 1 manual-*/perf.jsonl | /path/to/testnet-load-generator/scripts/perf_to_stats_csv.jq > stats.csv
```
