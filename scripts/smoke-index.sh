#!/usr/bin/env sh
set -eu

usage() {
	cat <<'USAGE'
Usage: scripts/smoke-index.sh

Boots the Docker Compose indexing profile against a small public Intuition
testnet block window, waits for bounded ingestion to finish, verifies events,
projection checkpoints, and API-visible atoms, then tears the stack down.

Environment:
  SMOKE_INDEX_PROJECT_NAME      Compose project name (default: intuition-core-smoke-index)
  API_URL                       API base URL (default: http://localhost:3000)
  SMOKE_INDEX_TIMEOUT_SECONDS   Indexing/projection timeout (default: 240)
  SMOKE_BUILD=1                 Force Docker image rebuilds before starting
  KEEP_SMOKE_STACK=1            Leave containers and volumes running after the test
USAGE
}

case "${1:-}" in
	-h | --help)
		usage
		exit 0
		;;
	"") ;;
	*)
		usage >&2
		exit 2
		;;
esac

PROJECT_NAME=${SMOKE_INDEX_PROJECT_NAME:-intuition-core-smoke-index}
API_URL=${API_URL:-http://localhost:3000}
TIMEOUT_SECONDS=${SMOKE_INDEX_TIMEOUT_SECONDS:-240}

# Public, keyless Intuition testnet window used for deterministic smoke runs.
INTUITION_RPC_URL=${INTUITION_RPC_URL:-https://testnet.rpc.intuition.systems/http}
CHAIN_ID=${CHAIN_ID:-13579}
MULTIVAULT_CONTRACT_ADDRESS=${MULTIVAULT_CONTRACT_ADDRESS:-0xeBc49d356B7f64D888130D85CC6D17114a6843ec}
MULTIVAULT_START_BLOCK=${MULTIVAULT_START_BLOCK:-9030416}
MULTIVAULT_END_BLOCK=${MULTIVAULT_END_BLOCK:-9030916}

WORK_DIR=$(mktemp -d)

compose() {
	docker compose -p "$PROJECT_NAME" "$@"
}

cleanup() {
	status=$?
	trap - EXIT INT TERM
	rm -rf "$WORK_DIR"
	if [ "${KEEP_SMOKE_STACK:-0}" != "1" ]; then
		compose --profile indexing down -v --remove-orphans >/dev/null 2>&1 || true
	fi
	exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

fail() {
	printf 'smoke-index: %s\n' "$*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

json_get() {
	path=$1
	bun -e '
const path = process.argv[1].split(".");
const json = JSON.parse(await Bun.stdin.text());
let value = json;
for (const key of path) {
	value = value?.[key];
}
if (value === undefined || value === null) {
	process.exit(2);
}
console.log(typeof value === "object" ? JSON.stringify(value) : String(value));
' "$path"
}

json_file_get() {
	file=$1
	path=$2
	json_get "$path" < "$file"
}

api_get() {
	path=$1
	output=$2
	status=$(curl -sS -o "$output" -w "%{http_code}" "$API_URL$path") ||
		fail "GET $path failed"
	case "$status" in
		2*) ;;
		*) fail "GET $path returned HTTP $status: $(cat "$output")" ;;
	esac
}

timescale_sql() {
	sql=$1
	compose exec -T timescale psql -U intuition -d intuition_timescale -Atq -c "$sql" |
		tr -d '[:space:]'
}

wait_for_api() {
	printf 'Waiting for API health at %s' "$API_URL"
	elapsed=0
	while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
		if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
			printf '\n'
			return 0
		fi
		printf '.'
		sleep 2
		elapsed=$((elapsed + 2))
	done
	printf '\n'
	fail "API did not become healthy within ${TIMEOUT_SECONDS}s"
}

wait_for_indexer_exit() {
	printf 'Waiting for bounded indexer to finish'
	elapsed=0
	while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
		container_id=$(compose ps -a -q indexer)
		[ -n "$container_id" ] || fail "indexer container was not created"
		state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$container_id")
		status=${state%% *}
		exit_code=${state##* }
		case "$status" in
			exited)
				printf '\n'
				[ "$exit_code" -eq 0 ] || fail "indexer exited with code $exit_code"
				return 0
				;;
		esac
		printf '.'
		sleep 5
		elapsed=$((elapsed + 5))
	done
	printf '\n'
	fail "indexer did not finish within ${TIMEOUT_SECONDS}s"
}

wait_for_projection_outputs() {
	stats_body=$WORK_DIR/stats.json
	printf 'Waiting for projection outputs'
	elapsed=0
	while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
		event_count=$(timescale_sql "SELECT count(*) FROM event_store WHERE is_canonical = true;" 2>/dev/null || printf '0')
		checkpoint_count=$(timescale_sql "SELECT count(*) FROM projection_checkpoints WHERE last_sequence_number > 0;" 2>/dev/null || printf '0')
		if api_get /api/stats "$stats_body" 2>/dev/null; then
			atom_count=$(json_file_get "$stats_body" data.atoms)
		else
			atom_count=0
		fi
		if [ "$event_count" -gt 0 ] && [ "$checkpoint_count" -gt 0 ] && [ "$atom_count" -gt 0 ]; then
			printf '\n'
			return 0
		fi
		printf '.'
		sleep 5
		elapsed=$((elapsed + 5))
	done
	printf '\n'
	fail "expected events, checkpoints, and atoms; got events=$event_count checkpoints=$checkpoint_count atoms=$atom_count"
}

need bun
need curl
need docker

printf 'Starting Docker Compose project %s with indexing profile\n' "$PROJECT_NAME"
compose --profile indexing down -v --remove-orphans >/dev/null 2>&1 || true
if [ "${SMOKE_BUILD:-0}" = "1" ]; then
	INTUITION_RPC_URL=$INTUITION_RPC_URL \
		CHAIN_ID=$CHAIN_ID \
		MULTIVAULT_CONTRACT_ADDRESS=$MULTIVAULT_CONTRACT_ADDRESS \
		MULTIVAULT_START_BLOCK=$MULTIVAULT_START_BLOCK \
		MULTIVAULT_END_BLOCK=$MULTIVAULT_END_BLOCK \
		compose --profile indexing up -d --build
else
	INTUITION_RPC_URL=$INTUITION_RPC_URL \
		CHAIN_ID=$CHAIN_ID \
		MULTIVAULT_CONTRACT_ADDRESS=$MULTIVAULT_CONTRACT_ADDRESS \
		MULTIVAULT_START_BLOCK=$MULTIVAULT_START_BLOCK \
		MULTIVAULT_END_BLOCK=$MULTIVAULT_END_BLOCK \
		compose --profile indexing up -d
fi

wait_for_api
wait_for_indexer_exit
wait_for_projection_outputs

event_count=$(timescale_sql "SELECT count(*) FROM event_store WHERE is_canonical = true;")
checkpoint_count=$(timescale_sql "SELECT count(*) FROM projection_checkpoints WHERE last_sequence_number > 0;")
stats_body=$WORK_DIR/stats.json
api_get /api/stats "$stats_body"
atom_count=$(json_file_get "$stats_body" data.atoms)

printf 'Index smoke test passed: events=%s checkpoints=%s atoms=%s window=%s-%s\n' \
	"$event_count" "$checkpoint_count" "$atom_count" "$MULTIVAULT_START_BLOCK" "$MULTIVAULT_END_BLOCK"
