#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
	cat <<'USAGE'
Usage:
  scripts/dev-local.sh [standard|indexing] [flags] [-- process-compose args]

Profiles:
  standard   datastores, migrations, API, workers, and atom-services
  indexing   standard + native rindexer ingestion and projections

Flags:
  --devnet   also run a local anvil chain and deploy the Intuition contracts
             onto it (requires foundry's anvil + cast on PATH)
  --dry-run  validate the merged Process Compose config and exit
  --no-tui   run without the Process Compose TUI
  -h, --help show this help

Examples:
  bun run dev:local
  bun run dev:local -- standard --dry-run
  bun run dev:local -- indexing --no-tui
  bun run dev:local -- indexing --devnet   # fully self-contained chain-to-API loop
USAGE
}

profile="standard"
devnet=false
dry_run=false
no_tui=false
extra_args=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		standard | indexing)
			profile="$1"
			shift
			;;
		--devnet)
			devnet=true
			shift
			;;
		--dry-run)
			dry_run=true
			shift
			;;
		--no-tui)
			no_tui=true
			shift
			;;
		-h | --help)
			usage
			exit 0
			;;
		--)
			shift
			extra_args+=("$@")
			break
			;;
		*)
			printf 'error: unknown argument: %s\n' "$1" >&2
			usage >&2
			exit 2
			;;
	esac
done

if ! command -v process-compose >/dev/null 2>&1; then
	cat >&2 <<'EOF'
error: process-compose is required.

Install:
  brew install f1bonacc1/tap/process-compose

Other installers:
  https://f1bonacc1.github.io/process-compose/installation/
EOF
	exit 1
fi

mkdir -p "${ROOT_DIR}/.logs/process-compose"
cd "$ROOT_DIR"

config_args=(-f process-compose.yaml)
if [[ "$profile" == "indexing" ]]; then
	config_args+=(-f .process-compose/indexing.yaml)
fi
if [[ "$devnet" == "true" ]]; then
	if ! command -v anvil >/dev/null 2>&1 || ! command -v cast >/dev/null 2>&1; then
		cat >&2 <<'EOF'
error: --devnet requires foundry's anvil and cast.

Install:
  curl -L https://foundry.paradigm.xyz | bash && foundryup
EOF
		exit 1
	fi
	mkdir -p "${ROOT_DIR}/.logs/devnet"
	config_args+=(-f .process-compose/devnet.yaml)
fi

pc_args=(up --ordered-shutdown --logs-truncate)
if [[ "$dry_run" == "true" ]]; then
	pc_args+=(--dry-run)
fi
if [[ "$no_tui" == "true" ]]; then
	pc_args+=(-t=false)
fi

exec process-compose "${pc_args[@]}" "${config_args[@]}" "${extra_args[@]}"
