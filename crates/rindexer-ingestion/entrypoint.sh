#!/usr/bin/env sh
set -e

# Optional bounded indexing: when MULTIVAULT_END_BLOCK is set, render an
# end_block line into the manifest so rindexer stops at that block instead of
# syncing to head. Unset -> blank line (valid YAML), unbounded sync.
if [ -n "${MULTIVAULT_END_BLOCK}" ]; then
	MULTIVAULT_END_BLOCK_LINE="        end_block: ${MULTIVAULT_END_BLOCK}"
else
	MULTIVAULT_END_BLOCK_LINE=""
fi
export MULTIVAULT_END_BLOCK_LINE

# Expand environment variables in the rindexer.yaml template. Only the listed
# variables are substituted so any other dollar sign in the file survives.
envsubst '${CHAIN_ID} ${INTUITION_RPC_URL} ${MULTIVAULT_CONTRACT_ADDRESS} ${MULTIVAULT_START_BLOCK} ${MULTIVAULT_END_BLOCK_LINE} ${RINDEXER_HEALTH_PORT}' \
	< /rindexer/rindexer.yaml.tpl > /rindexer/rindexer.yaml

exec rindexer-ingestion "$@"
