#!/usr/bin/env sh
set -eu

MODE="docker"
WITH_INDEXING="0"
SKIP_INSTALL="0"
START_STACK="1"
API_URL="${API_URL:-http://localhost:3000}"
MIN_FREE_KB="${BOOTSTRAP_MIN_FREE_KB:-5242880}"

if [ -t 1 ]; then
	BLUE="$(printf '\033[34m')"
	GREEN="$(printf '\033[32m')"
	YELLOW="$(printf '\033[33m')"
	RED="$(printf '\033[31m')"
	BOLD="$(printf '\033[1m')"
	RESET="$(printf '\033[0m')"
else
	BLUE=""
	GREEN=""
	YELLOW=""
	RED=""
	BOLD=""
	RESET=""
fi

usage() {
	cat <<'USAGE'
Usage: scripts/bootstrap.sh [options]

Options:
  --indexing       Start the indexing profile too.
  --mode docker    Run Docker Compose mode. This is the default.
  --mode native    Reserved for the future process-compose flow.
  --skip-install   Do not run bun install --frozen-lockfile.
  --no-start       Run preflight/setup only; do not start Docker Compose.
  -h, --help       Show this help.
USAGE
}

info() {
	printf '%s==>%s %s\n' "$BLUE" "$RESET" "$1"
}

ok() {
	printf '%sOK%s %s\n' "$GREEN" "$RESET" "$1"
}

warn() {
	printf '%sWARN%s %s\n' "$YELLOW" "$RESET" "$1"
}

fail() {
	printf '%sERROR%s %s\n' "$RED" "$RESET" "$1" >&2
	exit 1
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--indexing)
			WITH_INDEXING="1"
			;;
		--mode)
			shift
			[ "$#" -gt 0 ] || fail "--mode requires a value"
			MODE="$1"
			;;
		--mode=*)
			MODE="${1#*=}"
			;;
		--skip-install)
			SKIP_INSTALL="1"
			;;
		--no-start)
			START_STACK="0"
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			fail "Unknown option: $1"
			;;
	esac
	shift
done

[ "$MODE" = "docker" ] || fail "Only --mode docker is implemented. Native/process-compose support is tracked separately."

command_exists() {
	command -v "$1" >/dev/null 2>&1
}

compose() {
	docker compose "$@"
}

check_command() {
	command_exists "$1" || fail "$1 is required. Install it, then rerun scripts/bootstrap.sh."
}

check_docker() {
	check_command docker
	docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required. Install Docker Desktop or the compose plugin."
	docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not running."
	ok "Docker and Docker Compose are available"
}

check_disk_space() {
	available_kb="$(df -Pk . | awk 'NR == 2 { print $4 }')"
	if [ -n "$available_kb" ] && [ "$available_kb" -lt "$MIN_FREE_KB" ]; then
		fail "Less than 5 GiB is free in this filesystem. Free disk space before bootstrapping."
	fi
	ok "Disk space check passed"
}

check_port() {
	port="$1"
	if command_exists lsof && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
		warn "Port $port is already listening. If Compose startup fails, stop the conflicting process or change the mapped port."
	fi
}

ensure_env_file() {
	if [ -f .env ]; then
		ok ".env already exists"
		return
	fi

	cp example.env .env
	ok "Created .env from example.env"
}

env_has_value() {
	name="$1"
	eval "runtime_value=\${$name:-}"
	if [ -n "$runtime_value" ]; then
		return 0
	fi

	if [ ! -f .env ]; then
		return 1
	fi

	awk -F= -v key="$name" '
		$1 == key {
			value = $0
			sub(/^[^=]*=/, "", value)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			if (value != "") {
				found = 1
			}
		}
		END { exit found ? 0 : 1 }
	' .env
}

check_indexing_env() {
	if [ "$WITH_INDEXING" != "1" ]; then
		return
	fi

	missing=""
	for name in INTUITION_RPC_URL CHAIN_ID MULTIVAULT_CONTRACT_ADDRESS MULTIVAULT_START_BLOCK; do
		if ! env_has_value "$name"; then
			missing="$missing $name"
		fi
	done

	if [ -n "$missing" ]; then
		fail "Indexing mode requires non-empty values for:$missing. Set them in .env or the shell, then rerun with --indexing."
	fi

	ok "Indexing environment check passed"
}

install_dependencies() {
	if [ "$SKIP_INSTALL" = "1" ]; then
		warn "Skipping bun install"
		return
	fi

	check_command bun
	info "Installing workspace dependencies"
	bun install --frozen-lockfile
	ok "Dependencies installed"
}

start_compose() {
	if [ "$START_STACK" = "0" ]; then
		warn "Skipping Docker Compose startup"
		return
	fi

	if [ "$WITH_INDEXING" = "1" ]; then
		info "Starting Docker Compose with the indexing profile"
		compose --profile indexing up -d
	else
		info "Starting Docker Compose"
		compose up -d
	fi
}

wait_for_api() {
	if [ "$START_STACK" = "0" ]; then
		return
	fi

	check_command curl
	info "Waiting for API health at $API_URL/health"

	attempt=1
	while [ "$attempt" -le 60 ]; do
		if curl -fsS "$API_URL/health" >/dev/null 2>&1; then
			ok "API is healthy"
			return
		fi

		sleep 2
		attempt=$((attempt + 1))
	done

	compose ps
	fail "API did not become healthy within 120 seconds. Run 'docker compose logs api migrate postgres-kg' for details."
}

print_next_steps() {
	if [ "$START_STACK" = "0" ]; then
		cat <<EOF

${BOLD}Setup checks complete.${RESET}
Start the stack when ready:
  scripts/bootstrap.sh
  make up

EOF
		return
	fi

	cat <<EOF

${BOLD}Try the API:${RESET}
  curl $API_URL/health
  curl $API_URL/api/stats
  curl $API_URL/api/predicates

${BOLD}Create an API key for writes:${RESET}
  DATABASE_KG_URL=postgresql://intuition:intuition@localhost:5432/intuition_kg \\
    bun --filter @0xintuition/api run keys:create -- --name me --account 0xYourWallet

${BOLD}Create an atom with that key:${RESET}
  curl -X POST $API_URL/api/atoms \\
    -H "Authorization: Bearer ik_..." \\
    -H 'Content-Type: application/json' \\
    -d '{"input":"https://github.com/oven-sh/bun"}'

${BOLD}Useful commands:${RESET}
  make status
  make logs
  make down
EOF
}

info "Bootstrapping Intuition Core ($MODE mode)"
check_docker
check_command bun
check_disk_space
check_port 3000
check_port 4010
check_port 5432
check_port 5433
check_port 6379
ensure_env_file
check_indexing_env
install_dependencies
start_compose
wait_for_api
print_next_steps
