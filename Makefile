# This Makefile is a sort of crib sheet for running the load generator.

reset-chain:
	rm -rf _agstate/agoric-servers
	git checkout -- _agstate/agoric-servers
	agoric install

# the 'agoric start local-chain' setup code does not currently provide the
# BLD/RUN necessary to run our loadgen tasks, so we can't use these yet:

run-chain-not-working-yet:
	SLOGFILE=$(PWD)/chain.slog agoric start local-chain --verbose
run-client-not-working-yet:
	CLIENTSLOGFILE=$(PWD)/client.slog agoric start local-solo 8000

# instead, we must use the Makefile in packages/cosmic-swingset, and the
# "scenario2" rules, which *do* provide the necessary tokens during
# provisioning

CSDIR=/missing/replace/me/packages/cosmic-swingset

run-chain-setup:
	$(MAKE) -C $(CSDIR) scenario2-setup
run-chain:
	SLOGFILE=$(PWD)/chain.slog $(MAKE) -C $(CSDIR) scenario2-run-chain
run-client:
	$(MAKE) -C $(CSDIR) scenario2-run-client


run-loadgen:
	yarn loadgen

check:
	curl -s http://127.0.0.1:3352/config
light:
	curl -s -X PUT --data '{"faucet": { "interval": 60 }}' http://127.0.0.1:3352/config
moderate:
	curl -s -X PUT --data '{"faucet": { "interval": 5, "limit": 8}}' http://127.0.0.1:3352/config
heavy:
	curl -s -X PUT --data '{"faucet": { "interval": 0.1, "limit": 10}}' http://127.0.0.1:3352/config
none:
	curl -s -X PUT --data '{}' http://127.0.0.1:3352/config
amm-moderate:
	curl -s -X PUT --data '{"amm": { "interval": 30}}' http://127.0.0.1:3352/config
vault-moderate:
	curl -s -X PUT --data '{"vault": { "interval": 30}}' http://127.0.0.1:3352/config
alternating:
	curl -s -X PUT --data '{"vault": { "interval": 120}, "amm": { "wait": 60, "interval": 120 }}' http://127.0.0.1:3352/config

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
