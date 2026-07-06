#!/usr/bin/env sh
set -eu

usage() {
	cat <<'USAGE'
Usage: scripts/smoke-test.sh

Boots an isolated Docker Compose stack, mints a local API key, creates atoms,
waits for worker processing, creates a triple, verifies query endpoints, and
tears the stack down.

Environment:
  SMOKE_PROJECT_NAME        Compose project name (default: intuition-core-smoke)
  API_URL                   API base URL (default: discovered from Compose)
  SMOKE_TIMEOUT_SECONDS     Health/worker timeout (default: 180)
  SMOKE_BUILD=0             Reuse existing Docker images instead of rebuilding
  KEEP_SMOKE_STACK=1        Leave containers and volumes running after the test
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

PROJECT_NAME=${SMOKE_PROJECT_NAME:-intuition-core-smoke}
API_URL=${API_URL:-}
TIMEOUT_SECONDS=${SMOKE_TIMEOUT_SECONDS:-180}
PREDICATE_ID=0x0840db4575bf6bdb49b66c21dc40cb4cbb5e1b26bd239d7f56b126c14e452c07
SMOKE_ACCOUNT=0x0000000000000000000000000000000000000001
AUTH_HEADER_FILE=

WORK_DIR=$(mktemp -d)

compose() {
	API_HOST_PORT=${API_HOST_PORT:-0} \
		ATOM_SERVICES_HOST_PORT=${ATOM_SERVICES_HOST_PORT:-0} \
		POSTGRES_KG_HOST_PORT=${POSTGRES_KG_HOST_PORT:-0} \
		TIMESCALE_HOST_PORT=${TIMESCALE_HOST_PORT:-0} \
		REDIS_HOST_PORT=${REDIS_HOST_PORT:-0} \
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
	printf 'smoke-test: %s\n' "$*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

validate_positive_integer() {
	name=$1
	value=$2
	case "$value" in
		"" | *[!0-9]*) fail "$name must be a positive integer" ;;
	esac
	[ "$value" -gt 0 ] || fail "$name must be greater than 0"
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

api_post() {
	path=$1
	body=$2
	output=$3
	status=$(curl -sS -o "$output" -w "%{http_code}" \
		-X POST "$API_URL$path" \
		-H "@$AUTH_HEADER_FILE" \
		-H 'Content-Type: application/json' \
		--data "$body") ||
		fail "POST $path failed"
	case "$status" in
		2*) ;;
		*) fail "POST $path returned HTTP $status: $(cat "$output")" ;;
	esac
}

set_api_url_from_compose() {
	[ -z "$API_URL" ] || return 0
	address=$(compose port api 3000 | tail -n 1)
	[ -n "$address" ] || fail "could not discover API host port from Docker Compose"
	port=${address##*:}
	[ -n "$port" ] || fail "could not parse API host port from: $address"
	API_URL="http://127.0.0.1:$port"
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

wait_for_atom_processing() {
	atom_id=$1
	output=$2
	printf 'Waiting for atom processing'
	elapsed=0
	while [ "$elapsed" -lt "$TIMEOUT_SECONDS" ]; do
		api_get "/api/atoms/$atom_id" "$output"
		classification_type=$(json_file_get "$output" data.classificationType)
		parse_status=$(json_file_get "$output" data.parseStatus)
		classification_status=$(json_file_get "$output" data.classificationStatus)
		enrichment_status=$(json_file_get "$output" data.enrichmentStatus)
		if [ "$classification_type" != "Unknown" ] &&
			[ "$parse_status" = "completed" ] &&
			[ "$classification_status" = "completed" ] &&
			[ "$enrichment_status" = "completed" ]; then
			printf '\n'
			return 0
		fi
		printf '.'
		sleep 2
		elapsed=$((elapsed + 2))
	done
	printf '\n'
	fail "atom $atom_id did not finish processing: classificationType=$classification_type parse=$parse_status classification=$classification_status enrichment=$enrichment_status"
}

need bun
need curl
need docker
validate_positive_integer SMOKE_TIMEOUT_SECONDS "$TIMEOUT_SECONDS"

printf 'Starting Docker Compose project %s\n' "$PROJECT_NAME"
compose --profile indexing down -v --remove-orphans >/dev/null 2>&1 || true
if [ "${SMOKE_BUILD:-1}" = "0" ]; then
	compose up -d
else
	compose up -d --build
fi

set_api_url_from_compose
wait_for_api

printf 'Minting local API key\n'
key_output=$(compose exec -T api bun scripts/keys.ts create \
	--name smoke-test \
	--account "$SMOKE_ACCOUNT") ||
	fail "could not mint local API key"
API_KEY=$(printf '%s\n' "$key_output" | awk '/ik_/ { for (i = 1; i <= NF; i++) if ($i ~ /^ik_/) { print $i; exit } }')
[ -n "$API_KEY" ] || fail "could not parse minted API key"
AUTH_HEADER_FILE=$WORK_DIR/auth-header
(umask 077 && printf 'Authorization: Bearer %s\n' "$API_KEY" > "$AUTH_HEADER_FILE")

subject_body=$WORK_DIR/subject.json
object_body=$WORK_DIR/object.json
atom_body=$WORK_DIR/atom.json
triple_body=$WORK_DIR/triple.json
triple_read_body=$WORK_DIR/triple-read.json
triples_body=$WORK_DIR/triples.json
stats_body=$WORK_DIR/stats.json

printf 'Creating subject atom\n'
api_post /api/atoms '{"input":"https://en.wikipedia.org/wiki/Knowledge_graph"}' "$subject_body"
subject_id=$(json_file_get "$subject_body" data.id)

printf 'Creating object atom\n'
api_post /api/atoms '{"input":"Intuition Core smoke test object"}' "$object_body"
object_id=$(json_file_get "$object_body" data.id)

wait_for_atom_processing "$subject_id" "$atom_body"

printf 'Creating triple\n'
api_post /api/triples \
	"{\"subject_id\":\"$subject_id\",\"predicate_id\":\"$PREDICATE_ID\",\"object_id\":\"$object_id\"}" \
	"$triple_body"
triple_id=$(json_file_get "$triple_body" data.id)

printf 'Verifying atom triples query\n'
api_get "/api/atoms/$subject_id/triples" "$triples_body"
touching_count=$(json_file_get "$triples_body" pagination.count)
[ "$touching_count" -gt 0 ] || fail "expected at least one triple touching $subject_id"

printf 'Verifying created triple\n'
api_get "/api/triples/$triple_id" "$triple_read_body"
read_triple_id=$(json_file_get "$triple_read_body" data.id)
read_subject_id=$(json_file_get "$triple_read_body" data.subjectId)
read_predicate_id=$(json_file_get "$triple_read_body" data.predicateId)
read_object_id=$(json_file_get "$triple_read_body" data.objectId)
[ "$read_triple_id" = "$triple_id" ] || fail "expected triple id $triple_id, got $read_triple_id"
[ "$read_subject_id" = "$subject_id" ] || fail "expected triple subject $subject_id, got $read_subject_id"
[ "$read_predicate_id" = "$PREDICATE_ID" ] || fail "expected triple predicate $PREDICATE_ID, got $read_predicate_id"
[ "$read_object_id" = "$object_id" ] || fail "expected triple object $object_id, got $read_object_id"

printf 'Verifying API stats\n'
api_get /api/stats "$stats_body"
atoms_count=$(json_file_get "$stats_body" data.atoms)
triples_count=$(json_file_get "$stats_body" data.triples)
predicates_count=$(json_file_get "$stats_body" data.predicates)
[ "$atoms_count" -gt 0 ] || fail "expected stats atoms to be non-zero"
[ "$triples_count" -gt 0 ] || fail "expected stats triples to be non-zero"
[ "$predicates_count" -gt 0 ] || fail "expected stats predicates to be non-zero"

printf 'Smoke test passed: atom=%s triple=%s stats atoms=%s triples=%s predicates=%s\n' \
	"$subject_id" "$triple_id" "$atoms_count" "$triples_count" "$predicates_count"
