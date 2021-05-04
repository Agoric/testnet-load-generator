# This Makefile is a sort of crib sheet for running the load generator.

reset-chain:
	rm -rf _agstate/agoric-servers
	git checkout -- _agstate/agoric-servers
	agoric install

run-chain:
	SLOGFILE=$(PWD)/chain.slog agoric start local-chain
run-client:
	agoric start local-solo 8000
run-loadgen:
	yarn loadgen

check:
	curl -s http://127.0.0.1:3352/config
light:
	curl -s -X PUT --data '{"faucet":60}' http://127.0.0.1:3352/config
moderate:
	curl -s -X PUT --data '{"faucet":5}' http://127.0.0.1:3352/config
heavy:
	curl -s -X PUT --data '{"faucet":0.1}' http://127.0.0.1:3352/config
none:
	curl -s -X PUT --data '{}' http://127.0.0.1:3352/config
amm-moderate:
	curl -s -X PUT --data '{"amm":5}' http://127.0.0.1:3352/config
vault-moderate:
	curl -s -X PUT --data '{"vault":5}' http://127.0.0.1:3352/config

# recommended sequence:
# shell 1:
#   cd agoric-sdk && yarn && yarn build && make -C packages/cosmic-swingset
#   cd testnet-load-generator
#   make reset-chain
#   make run-chain
#   (wait ~60s until "block-manager: block 1 commit")
# shell 2:
#   tail -F chain.slog
# shell 3:
#   make run-client
#   (wait ~120s until "Deployed Wallet!" and the ~4 "gas estimate" lines stop appearing)
# shell 4:
#   make run-loadgen
#   (wait ~30s until "faucet ready for cycles" appears)
# shell 5:
#   make check, or light|moderate|heavy|none to control rate
