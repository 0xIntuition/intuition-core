#!/usr/bin/env bash
# =============================================================================
# Intuition Core local devnet: fetch contracts + deploy to a running anvil.
#
#   RPC_URL=http://127.0.0.1:8545 ./devnet/setup.sh
#
# Clones 0xIntuition/intuition-contracts-v2 at a PINNED commit into
# devnet/contracts-v2 (gitignored), prepares its dependencies, then runs the
# vendored devnet-deploy.sh inside it. Idempotent end to end: re-runs reuse
# the clone and skip deployment when the recorded MultiVault already has code
# on the target chain.
#
# Requires: git, bun, foundry (forge/cast), python3. In docker these come from
# docker/Dockerfile.devnet; natively install foundry via https://getfoundry.sh.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CONTRACTS_REPO="${CONTRACTS_REPO:-https://github.com/0xIntuition/intuition-contracts-v2}"
# Pinned for reproducible devnets — bump deliberately and re-verify the
# event signatures against crates/rindexer-ingestion/abi/MultiVault.json.
CONTRACTS_REF="${CONTRACTS_REF:-4b4ee8e182a1c9aa2e9262d310f3819d2e30ec69}"
CONTRACTS_DIR="${CONTRACTS_DIR:-$SCRIPT_DIR/contracts-v2}"

if [ ! -d "$CONTRACTS_DIR/.git" ]; then
	echo "==> Cloning intuition-contracts-v2 @ ${CONTRACTS_REF:0:12}…"
	git clone "$CONTRACTS_REPO" "$CONTRACTS_DIR"
fi
git -C "$CONTRACTS_DIR" fetch --quiet origin "$CONTRACTS_REF" 2>/dev/null || true
git -C "$CONTRACTS_DIR" checkout --quiet "$CONTRACTS_REF"

echo "==> Preparing dependencies (submodules + bun install)…"
git -C "$CONTRACTS_DIR" submodule update --init --recursive --quiet
(cd "$CONTRACTS_DIR" && bun install --silent)

cp "$SCRIPT_DIR/devnet-deploy.sh" "$CONTRACTS_DIR/devnet-deploy.sh"
chmod +x "$CONTRACTS_DIR/devnet-deploy.sh"

echo "==> Deploying to ${RPC_URL:-http://127.0.0.1:8545}…"
(cd "$CONTRACTS_DIR" && ./devnet-deploy.sh)

# Surface the deployment state where the operator (and docs) expect it.
cp "$CONTRACTS_DIR/deployments-devnet.json" "$SCRIPT_DIR/deployments-devnet.json"
echo "==> Deployment state: devnet/deployments-devnet.json"
