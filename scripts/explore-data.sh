#!/usr/bin/env sh
set -eu

usage() {
	cat <<'USAGE'
Usage: scripts/explore-data.sh

Prints a guided snapshot of the local knowledge graph database: table counts,
recent atoms, pipeline status, predicate registry, and recent artifacts.

Connection:
  - If DATABASE_KG_URL is set and psql is installed, the script uses host psql.
  - Otherwise it runs psql inside the Docker Compose postgres-kg service.

Environment:
  COMPOSE_PROJECT_NAME   Compose project name (default: intuition-core)
  DATABASE_KG_URL        Optional host psql connection string
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

PROJECT_NAME=${COMPOSE_PROJECT_NAME:-intuition-core}
PSQL_MODE=compose

fail() {
	printf 'explore-data: %s\n' "$*" >&2
	exit 1
}

need() {
	command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

compose() {
	docker compose -p "$PROJECT_NAME" "$@"
}

select_psql_mode() {
	if [ -n "${DATABASE_KG_URL:-}" ] && command -v psql >/dev/null 2>&1; then
		PSQL_MODE=host
		return 0
	fi

	need docker
	container_id=$(compose ps -q postgres-kg)
	[ -n "$container_id" ] || fail "postgres-kg is not running. Start the stack with: make bootstrap"

	status=$(docker inspect -f '{{.State.Status}}' "$container_id")
	[ "$status" = "running" ] || fail "postgres-kg is $status. Start the stack with: make bootstrap"
}

run_sql() {
	sql=$1
	if [ "$PSQL_MODE" = "host" ]; then
		psql "$DATABASE_KG_URL" -v ON_ERROR_STOP=1 -P pager=off -c "$sql"
	else
		compose exec -T postgres-kg psql -U intuition -d intuition_kg \
			-v ON_ERROR_STOP=1 -P pager=off -c "$sql"
	fi
}

section() {
	printf '\n== %s ==\n' "$1"
}

select_psql_mode

printf 'Intuition Core data snapshot (%s)\n' "$PSQL_MODE"

section "Table counts"
run_sql "
SELECT *
FROM (
	SELECT 'nodes' AS table_name, count(*)::int AS rows FROM kg.nodes
	UNION ALL SELECT 'triples', count(*)::int FROM kg.triples
	UNION ALL SELECT 'predicates', count(*)::int FROM kg.predicates
	UNION ALL SELECT 'artifacts', count(*)::int FROM kg.artifacts
	UNION ALL SELECT 'node_urls', count(*)::int FROM kg.node_urls
	UNION ALL SELECT 'events', count(*)::int FROM kg.events
) counts
ORDER BY table_name;
"

section "Recent atoms"
run_sql "
SELECT
	created_at,
	left(id, 18) || '...' AS id,
	raw_type,
	classification_type,
	parse_status || '/' || classification_status || '/' || enrichment_status AS pipeline,
	left(coalesce(nullif(data, ''), data_hex, ''), 80) AS data
FROM kg.nodes
ORDER BY created_at DESC
LIMIT 5;
"

section "Pipeline status"
run_sql "
SELECT stage, status, count(*)::int AS atoms
FROM (
	SELECT 'parse' AS stage, parse_status AS status FROM kg.nodes
	UNION ALL SELECT 'classification', classification_status FROM kg.nodes
	UNION ALL SELECT 'enrichment', enrichment_status FROM kg.nodes
) statuses
GROUP BY stage, status
ORDER BY stage, status;
"

section "Predicate registry"
run_sql "
SELECT
	slug,
	label,
	is_transitive,
	is_symmetric,
	is_hierarchical,
	is_social,
	is_market
FROM kg.predicates
ORDER BY slug;
"

section "Artifact status by kind"
run_sql "
SELECT artifact_kind, status, count(*)::int AS artifacts
FROM kg.artifacts
GROUP BY artifact_kind, status
ORDER BY artifact_kind, status;
"

section "Recent artifacts"
run_sql "
SELECT
	updated_at,
	left(node_id, 18) || '...' AS node_id,
	artifact_kind,
	status,
	left(coalesce(source_uri, ''), 80) AS source_uri
FROM kg.artifacts
ORDER BY updated_at DESC
LIMIT 10;
"
