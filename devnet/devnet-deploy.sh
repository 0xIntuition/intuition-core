#!/usr/bin/env bash
# =============================================================================
# Intuition contracts-v2 local devnet deployment (anvil, chain-id 31337)
#
# Assumes: anvil is ALREADY RUNNING (default: http://127.0.0.1:8545, default
# accounts/mnemonic), and this repo's deps are installable (git submodules +
# bun/npm for @openzeppelinV4 remapping).
#
# Usage:
#   RPC_URL=http://127.0.0.1:8545 \
#   PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
#   ./devnet-deploy.sh
#
# Idempotent: deployment state is written to $STATE_FILE. On re-run, if the
# recorded MultiVault proxy still has code on the target chain, deployment is
# skipped and only the acceptance test (createAtoms -> AtomCreated) runs
# again with fresh atom data.
#
# Deployment sequence (all non-interactive):
#   1. WrappedTrustDeploy            -> ANVIL_TRUST_TOKEN (WTRUST, WETH-like)
#   2. BaseEmissionsControllerDeploy -> ANVIL_BASE_EMISSIONS_CONTROLLER (proxy)
#   3. MultiVaultDeploy              -> plain MultiVault implementation, used
#      as ANVIL_MULTIVAULT_MIGRATION_MODE_IMPLEMENTATION (MigrationMode impl
#      is >24576 bytes without --via-ir; plain MultiVault is a strict subset
#      and is what the proxy would be upgraded to anyway).
#   4. IntuitionDeployAndSetup       -> full system + MultiVault proxy
#
# IMPORTANT: FOUNDRY_OPTIMIZER_RUNS=200 is required. At the repo default
# (10000 runs) MultiVault's runtime bytecode is 27666 bytes > EIP-170 limit.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------
export RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
# anvil default account #0
export PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
STATE_FILE="${STATE_FILE:-$SCRIPT_DIR/deployments-devnet.json}"

DEPLOYER_ADDRESS="$(cast wallet address --private-key "$PRIVATE_KEY")"
CHAIN_ID="$(cast chain-id --rpc-url "$RPC_URL")"
if [ "$CHAIN_ID" != "31337" ]; then
  echo "ERROR: expected chain-id 31337 (anvil), got $CHAIN_ID" >&2
  exit 1
fi

echo "==> RPC:      $RPC_URL (chain $CHAIN_ID)"
echo "==> Deployer: $DEPLOYER_ADDRESS"

# ---------------------------------------------------------------------------
# Environment consumed by script/SetupScript.s.sol (anvil branch)
# ---------------------------------------------------------------------------
export FOUNDRY_PROFILE=default
export FOUNDRY_OPTIMIZER_RUNS=200            # REQUIRED: contract size (see header)
export DEPLOYER_LOCAL="$PRIVATE_KEY"         # broadcaster key
export ANVIL_ADMIN_ADDRESS="$DEPLOYER_ADDRESS"     # must equal broadcaster: the
                                                   # deploy script makes admin-only
                                                   # calls (addBondingCurve,
                                                   # setTrustBonding, grantRole...)
export ANVIL_PROTOCOL_MULTISIG="$DEPLOYER_ADDRESS"
export ANVIL_MULTI_VAULT_ROLE_MIGRATOR="$DEPLOYER_ADDRESS"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
# Extract a deployed contract address from a forge broadcast run-latest.json.
#   broadcast_addr <script-file-name> <contractName> [first|last]
broadcast_addr() {
  python3 - "$SCRIPT_DIR/broadcast/$1/31337/run-latest.json" "$2" "${3:-last}" <<'PY'
import json, sys
path, name, which = sys.argv[1], sys.argv[2], sys.argv[3]
txs = [t for t in json.load(open(path))["transactions"]
       if t.get("transactionType") == "CREATE" and t.get("contractName") == name]
if not txs:
    sys.exit(f"no CREATE tx for {name} in {path}")
tx = txs[0] if which == "first" else txs[-1]
print(tx["contractAddress"])
PY
}

run_forge_script() { # run_forge_script <path:Contract>
  forge script "$1" --rpc-url "$RPC_URL" --broadcast --non-interactive -vv
}

has_code() { # has_code <address> -> 0 if contract code present
  local code
  code="$(cast code "$1" --rpc-url "$RPC_URL" 2>/dev/null || echo 0x)"
  [ "$code" != "0x" ] && [ -n "$code" ]
}

# ---------------------------------------------------------------------------
# Deploy (skipped if state file matches live chain)
# ---------------------------------------------------------------------------
MULTIVAULT=""
if [ -f "$STATE_FILE" ]; then
  MULTIVAULT="$(python3 -c "import json;print(json.load(open('$STATE_FILE')).get('MultiVault',''))" 2>/dev/null || true)"
fi

if [ -n "$MULTIVAULT" ] && has_code "$MULTIVAULT"; then
  echo "==> Existing deployment found at $MULTIVAULT (state: $STATE_FILE); skipping deploy."
  TRUST_TOKEN="$(python3 -c "import json;print(json.load(open('$STATE_FILE'))['WrappedTrust'])")"
else
  echo "==> Building (optimizer_runs=200)..."
  forge build > /dev/null

  echo "==> [1/4] WrappedTrust (WTRUST token)"
  run_forge_script script/intuition/WrappedTrustDeploy.s.sol:WrappedTrustDeploy | tail -2
  TRUST_TOKEN="$(broadcast_addr WrappedTrustDeploy.s.sol WrappedTrust)"
  export ANVIL_TRUST_TOKEN="$TRUST_TOKEN"
  echo "    WTRUST: $TRUST_TOKEN"

  echo "==> [2/4] BaseEmissionsController"
  run_forge_script script/base/BaseEmissionsControllerDeploy.s.sol:BaseEmissionsControllerDeploy | tail -2
  BASE_EMISSIONS_CONTROLLER="$(broadcast_addr BaseEmissionsControllerDeploy.s.sol TransparentUpgradeableProxy)"
  export ANVIL_BASE_EMISSIONS_CONTROLLER="$BASE_EMISSIONS_CONTROLLER"
  echo "    BaseEmissionsController proxy: $BASE_EMISSIONS_CONTROLLER"

  echo "==> [3/4] MultiVault implementation"
  run_forge_script script/intuition/MultiVaultDeploy.s.sol:MultiVaultDeploy | tail -2
  MULTIVAULT_IMPL="$(broadcast_addr MultiVaultDeploy.s.sol MultiVault)"
  export ANVIL_MULTIVAULT_MIGRATION_MODE_IMPLEMENTATION="$MULTIVAULT_IMPL"
  echo "    MultiVault impl: $MULTIVAULT_IMPL"

  echo "==> [4/4] IntuitionDeployAndSetup (full system)"
  run_forge_script script/intuition/IntuitionDeployAndSetup.s.sol:IntuitionDeployAndSetup | tail -12
  MULTIVAULT="$(broadcast_addr IntuitionDeployAndSetup.s.sol TransparentUpgradeableProxy last)"

  DEPLOY_BLOCK="$(python3 -c "
import json
r = json.load(open('$SCRIPT_DIR/broadcast/IntuitionDeployAndSetup.s.sol/31337/run-latest.json'))['receipts']
print(max(int(x['blockNumber'],16) for x in r))
")"

  python3 - "$STATE_FILE" <<PY
import json, sys
state = {
  "chainId": 31337,
  "WrappedTrust": "$TRUST_TOKEN",
  "BaseEmissionsController": "$BASE_EMISSIONS_CONTROLLER",
  "MultiVaultImplementation": "$MULTIVAULT_IMPL",
  "MultiVault": "$MULTIVAULT",
  "deployBlock": int("$DEPLOY_BLOCK"),
  "deployer": "$DEPLOYER_ADDRESS",
}
# Pull the rest of the system out of the final broadcast
txs = json.load(open("$SCRIPT_DIR/broadcast/IntuitionDeployAndSetup.s.sol/31337/run-latest.json"))["transactions"]
proxies = [t["contractAddress"] for t in txs if t.get("transactionType")=="CREATE" and t.get("contractName")=="TransparentUpgradeableProxy"]
names = ["AtomWalletFactory","AtomWarden","BondingCurveRegistry","LinearCurve","SatelliteEmissionsController","TrustBonding","MultiVault"]
if len(proxies) == len(names):
    state.update(dict(zip(names, proxies)))
json.dump(state, open(sys.argv[1], "w"), indent=2)
PY
  echo "==> State written to $STATE_FILE"
fi

echo "==> MultiVault proxy: $MULTIVAULT"

# ---------------------------------------------------------------------------
# Acceptance test: createAtoms must emit AtomCreated
# ---------------------------------------------------------------------------
echo "==> Acceptance: createAtoms on $MULTIVAULT"
ATOM_COST="$(cast call "$MULTIVAULT" "getAtomCost()(uint256)" --rpc-url "$RPC_URL" | awk '{print $1}')"
echo "    getAtomCost() = $ATOM_COST wei ( = atomCreationProtocolFee 1e17 + minShare 1e6 )"

ATOM_DATA_HEX="$(cast from-utf8 "devnet-atom-$(date +%s)-$RANDOM")"
TX_JSON="$(cast send "$MULTIVAULT" \
  "createAtoms(bytes[],uint256[])" \
  "[$ATOM_DATA_HEX]" "[$ATOM_COST]" \
  --value "$ATOM_COST" \
  --private-key "$PRIVATE_KEY" --rpc-url "$RPC_URL" --json)"

ATOM_CREATED_TOPIC="$(cast keccak "AtomCreated(address,bytes32,bytes,address)")"
TX_JSON="$TX_JSON" python3 - "$ATOM_CREATED_TOPIC" "$MULTIVAULT" <<'PY'
import json, os, sys
topic, mv = sys.argv[1].lower(), sys.argv[2].lower()
r = json.loads(os.environ["TX_JSON"])
assert int(r["status"], 16) == 1, f"createAtoms tx reverted: {r}"
hits = [l for l in r["logs"] if l["address"].lower() == mv and l["topics"][0].lower() == topic]
assert hits, "AtomCreated event NOT found in receipt logs"
l = hits[0]
print(f"    ACCEPTANCE PASSED: AtomCreated emitted in tx {r['transactionHash']} (block {int(r['blockNumber'],16)})")
print(f"      creator: 0x{l['topics'][1][-40:]}")
print(f"      termId:  {l['topics'][2]}")
PY

echo "==> DONE"
