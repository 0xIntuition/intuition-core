#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_TEMPLATE="${ROOT_DIR}/crates/rindexer-ingestion/rindexer.yaml"

fail() {
	printf 'rindexer-local-run: %s\n' "$*" >&2
	exit 1
}

load_dotenv() {
	env_file="${ROOT_DIR}/.env"
	[ -f "$env_file" ] || return 0

	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in
			"" | \#*) continue ;;
		esac

		line="${line#export }"
		key="${line%%=*}"
		value="${line#*=}"
		[ "$key" != "$line" ] || continue

		case "$key" in
			"" | *[!A-Za-z0-9_]*)
				continue
				;;
		esac

		[ -z "${!key:-}" ] || continue

		case "$value" in
			\"*\")
				value="${value#\"}"
				value="${value%\"}"
				;;
			\'*\')
				value="${value#\'}"
				value="${value%\'}"
				;;
		esac

		export "$key=$value"
	done < "$env_file"
}

require_env() {
	name="$1"
	value="${!name:-}"
	[ -n "$value" ] || fail "$name is required for the indexing profile"
}

load_dotenv

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

umask 077
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/intuition-core-rindexer.XXXXXX") ||
	fail "failed to create temporary rindexer work directory"
MANIFEST="${WORK_DIR}/rindexer.yaml"
cleanup() {
	rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

mkdir -p "$WORK_DIR"
ln -s "${ROOT_DIR}/crates/rindexer-ingestion/abi" "$WORK_DIR/abi"

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

cd "$WORK_DIR"
RINDEXER_MANIFEST_PATH="$MANIFEST" cargo run --manifest-path "$ROOT_DIR/Cargo.toml" -p rindexer-ingestion
