#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATABASE_URL=${DATABASE_TIMESCALE_URL:-${DATABASE_URL:-postgresql://intuition:intuition@localhost:5433/intuition_timescale}}
MIGRATIONS_DIR=${TIMESCALE_MIGRATIONS_DIR:-"$ROOT_DIR/migrations/timescale"}

fail() {
	printf 'timescale-migrate: %s\n' "$*" >&2
	exit 1
}

run_psql() {
	sql=$1
	if command -v psql >/dev/null 2>&1; then
		psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq -c "$sql"
		return
	fi

	docker compose -f "$ROOT_DIR/docker-compose.datastores.yml" exec -T timescale \
		psql -U intuition -d intuition_timescale -v ON_ERROR_STOP=1 -Atq -c "$sql"
}

run_psql_file() {
	file=$1
	if command -v psql >/dev/null 2>&1; then
		psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$file"
		return
	fi

	docker compose -f "$ROOT_DIR/docker-compose.datastores.yml" exec -T timescale \
		psql -U intuition -d intuition_timescale -v ON_ERROR_STOP=1 < "$file"
}

escape_sql_literal() {
	printf "%s" "$1" | sed "s/'/''/g"
}

[ -d "$MIGRATIONS_DIR" ] || fail "missing migrations directory: $MIGRATIONS_DIR"

if ! command -v psql >/dev/null 2>&1 && ! command -v docker >/dev/null 2>&1; then
	fail "psql or docker is required"
fi

printf 'Running Timescale migrations\n'
run_psql_file "$MIGRATIONS_DIR/000_create_schema_migrations.sql"

for file in "$MIGRATIONS_DIR"/*.sql; do
	name=$(basename "$file")
	[ "$name" = "000_create_schema_migrations.sql" ] && continue

	escaped_name=$(escape_sql_literal "$name")
	already=$(run_psql "SELECT 1 FROM schema_migrations WHERE filename = '$escaped_name';" 2>/dev/null || true)
	if [ "$already" = "1" ]; then
		printf 'Skipping %s\n' "$name"
		continue
	fi

	printf 'Applying %s\n' "$name"
	run_psql_file "$file"
	run_psql "INSERT INTO schema_migrations (filename) VALUES ('$escaped_name');" >/dev/null
done

printf 'Timescale migrations complete\n'
