#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${ROOT_DIR}/.logs/process-compose/rindexer"
MANIFEST_TEMPLATE="${ROOT_DIR}/crates/rindexer-ingestion/rindexer.yaml"
MANIFEST="${WORK_DIR}/rindexer.yaml"

fail() {
	printf 'rindexer-local-run: %s\n' "$*" >&2
	exit 1
}

require_env() {
	name="$1"
	value="${!name:-}"
	[ -n "$value" ] || fail "$name is required for the indexing profile"
}

require_env CHAIN_ID
require_env INTUITION_RPC_URL
require_env MULTIVAULT_CONTRACT_ADDRESS
require_env MULTIVAULT_START_BLOCK

if ! command -v cargo >/dev/null 2>&1; then
	fail "cargo is required for the indexing profile"
fi

if ! command -v envsubst >/dev/null 2>&1; then
	fail "envsubst is required. On macOS: brew install gettext"
fi

mkdir -p "$WORK_DIR"

if [ -n "${MULTIVAULT_END_BLOCK:-}" ]; then
	MULTIVAULT_END_BLOCK_LINE="        end_block: ${MULTIVAULT_END_BLOCK}"
else
	MULTIVAULT_END_BLOCK_LINE=""
fi
export CHAIN_ID INTUITION_RPC_URL MULTIVAULT_CONTRACT_ADDRESS MULTIVAULT_START_BLOCK
export MULTIVAULT_END_BLOCK_LINE
export RINDEXER_HEALTH_PORT="${RINDEXER_HEALTH_PORT:-8080}"

envsubst '${CHAIN_ID} ${INTUITION_RPC_URL} ${MULTIVAULT_CONTRACT_ADDRESS} ${MULTIVAULT_START_BLOCK} ${MULTIVAULT_END_BLOCK_LINE} ${RINDEXER_HEALTH_PORT}' \
	< "$MANIFEST_TEMPLATE" > "$MANIFEST"

cd "$ROOT_DIR"
RINDEXER_MANIFEST_PATH="$MANIFEST" cargo run -p rindexer-ingestion
