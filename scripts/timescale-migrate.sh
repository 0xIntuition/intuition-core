#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DATABASE_URL=${DATABASE_TIMESCALE_URL:-${DATABASE_URL:-postgresql://intuition:intuition@localhost:5433/intuition_timescale}}
MIGRATIONS_DIR=${TIMESCALE_MIGRATIONS_DIR:-"$ROOT_DIR/migrations/timescale"}
STATUS_TABLE=schema_migration_status

fail() {
	printf 'timescale-migrate: %s\n' "$*" >&2
	exit 1
}

database_host() {
	DATABASE_URL_INPUT=$DATABASE_URL bun -e '
const input = process.env.DATABASE_URL_INPUT;
try {
	const url = new URL(input);
	console.log(url.hostname);
} catch {
	process.exit(1);
}
'
}

assert_local_database() {
	host=$(database_host) || fail "DATABASE_URL must be a valid Postgres URL"
	case "$host" in
		localhost | 127.0.0.1 | ::1)
			return 0
			;;
	esac

	if [ "${ALLOW_REMOTE_TIMESCALE_MIGRATIONS:-0}" = "1" ]; then
		printf 'ALLOW_REMOTE_TIMESCALE_MIGRATIONS=1 set; allowing Timescale host %s\n' "$host" >&2
		return 0
	fi

	fail "refusing to run Timescale migrations against non-local host '$host'. Set ALLOW_REMOTE_TIMESCALE_MIGRATIONS=1 to override."
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

command -v bun >/dev/null 2>&1 || fail "bun is required to validate DATABASE_URL"
assert_local_database

printf 'Running Timescale migrations\n'
run_psql_file "$MIGRATIONS_DIR/000_create_schema_migrations.sql"
run_psql "CREATE TABLE IF NOT EXISTS $STATUS_TABLE (filename TEXT PRIMARY KEY, status TEXT NOT NULL CHECK (status IN ('running', 'completed')), started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ);" >/dev/null

for file in "$MIGRATIONS_DIR"/*.sql; do
	name=$(basename "$file")
	[ "$name" = "000_create_schema_migrations.sql" ] && continue

	escaped_name=$(escape_sql_literal "$name")
	already=$(run_psql "SELECT 1 FROM schema_migrations WHERE filename = '$escaped_name';" 2>/dev/null || true)
	if [ "$already" = "1" ]; then
		printf 'Skipping %s\n' "$name"
		continue
	fi

	status=$(run_psql "SELECT status FROM $STATUS_TABLE WHERE filename = '$escaped_name';" 2>/dev/null || true)
	if [ "$status" = "running" ]; then
		fail "$name has an incomplete previous run. Inspect the database before re-running, then mark or remove the $STATUS_TABLE row manually."
	fi

	printf 'Applying %s\n' "$name"
	run_psql "INSERT INTO $STATUS_TABLE (filename, status, started_at, finished_at) VALUES ('$escaped_name', 'running', NOW(), NULL) ON CONFLICT (filename) DO UPDATE SET status = 'running', started_at = NOW(), finished_at = NULL;" >/dev/null
	run_psql_file "$file"
	run_psql "INSERT INTO schema_migrations (filename) VALUES ('$escaped_name');" >/dev/null
	run_psql "UPDATE $STATUS_TABLE SET status = 'completed', finished_at = NOW() WHERE filename = '$escaped_name';" >/dev/null
done

printf 'Timescale migrations complete\n'
