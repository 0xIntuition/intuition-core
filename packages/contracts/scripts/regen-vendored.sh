#!/usr/bin/env bash
# =============================================================================
# Regenerate packages/contracts/vendored/*.json
#
# The devnet deployer needs five artifacts that @0xintuition/contracts-v2 does
# not export: the OpenZeppelin proxy infrastructure (TransparentUpgradeableProxy,
# TimelockController, UpgradeableBeacon) and two protocol contracts whose
# ABIs/bytecodes are missing from the package exports (AtomWarden, WrappedTrust
# — their *source* ships in the package's ./src/* export, so we compile from
# that, never from a git clone).
#
# Compiler settings mirror intuition-contracts-v2 foundry.toml exactly
# (solc 0.8.29, optimizer_runs 10000, evm cancun, bytecode_hash "none" — the
# metadata hash is excluded, so output is deterministic for a given source).
#
# Requires: forge (https://getfoundry.sh), bun. Dev-only — runtime consumers
# read the committed JSON.
#
# Usage: packages/contracts/scripts/regen-vendored.sh
# =============================================================================
set -euo pipefail

PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACTS_V2="$PKG_DIR/node_modules/@0xintuition/contracts-v2"
BUILD_DIR="$PKG_DIR/.vendor-build"

if [ ! -d "$CONTRACTS_V2/src" ]; then
	echo "ERROR: @0xintuition/contracts-v2 not installed (run bun install first)" >&2
	exit 1
fi

OZ_VERSION="5.4.0" # must match intuition-contracts-v2 lib/openzeppelin-contracts
SOLC="0.8.29"      # must match intuition-contracts-v2 foundry.toml

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/src/interfaces" "$BUILD_DIR/src/protocol/wallet"
cd "$BUILD_DIR"

echo '{ "name": "vendor-build", "private": true }' > package.json
bun add --exact "@openzeppelin/contracts@$OZ_VERSION" "@openzeppelin/contracts-upgradeable@$OZ_VERSION" --silent

cat > foundry.toml <<EOF
[profile.default]
  auto_detect_solc = false
  bytecode_hash = "none"
  evm_version = "cancun"
  optimizer = true
  optimizer_runs = 10_000
  out = "out"
  solc = "$SOLC"
  src = "src"
  libs = ["node_modules"]
  remappings = [
    "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/",
    "@openzeppelin/contracts-upgradeable/=node_modules/@openzeppelin/contracts-upgradeable/",
  ]
EOF

# Transitive import closure of AtomWarden.sol + WrappedTrust.sol (verify with
# the import walker in the header of vendored/README.md when bumping versions).
cp "$CONTRACTS_V2/src/WrappedTrust.sol" src/
cp "$CONTRACTS_V2/src/protocol/wallet/AtomWarden.sol" src/protocol/wallet/
for f in IAtomWallet IAtomWarden IMultiVault IMultiVaultCore; do
	cp "$CONTRACTS_V2/src/interfaces/$f.sol" src/interfaces/
done

cat > src/VendoredInfra.sol <<'EOF'
// SPDX-License-Identifier: MIT
pragma solidity 0.8.29;

// Force compilation of OpenZeppelin infrastructure contracts whose artifacts
// the deployer needs but @0xintuition/contracts-v2 does not export.
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { TimelockController } from "@openzeppelin/contracts/governance/TimelockController.sol";
import { UpgradeableBeacon } from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
EOF

forge build

CONTRACTS_V2_VERSION="$(bun -e "console.log(require('$CONTRACTS_V2/package.json').version)")"

node - "$PKG_DIR/vendored" "$OZ_VERSION" "$CONTRACTS_V2_VERSION" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const [outDir, ozVersion, pkgVersion] = process.argv.slice(2);
const contracts = {
	TransparentUpgradeableProxy: `@openzeppelin/contracts@${ozVersion}`,
	TimelockController: `@openzeppelin/contracts@${ozVersion}`,
	UpgradeableBeacon: `@openzeppelin/contracts@${ozVersion}`,
	AtomWarden: `@0xintuition/contracts-v2@${pkgVersion} src/protocol/wallet/AtomWarden.sol`,
	WrappedTrust: `@0xintuition/contracts-v2@${pkgVersion} src/WrappedTrust.sol`,
};
for (const [name, source] of Object.entries(contracts)) {
	const artifact = JSON.parse(fs.readFileSync(`out/${name}.sol/${name}.json`, "utf8"));
	const lean = {
		contractName: name,
		source,
		compiler: { solc: "0.8.29", optimizerRuns: 10_000, evmVersion: "cancun", bytecodeHash: "none" },
		abi: artifact.abi,
		bytecode: artifact.bytecode.object,
	};
	fs.writeFileSync(path.join(outDir, `${name}.json`), `${JSON.stringify(lean, null, "\t")}\n`);
	console.log(`wrote vendored/${name}.json`);
}
JS

# ── Stage 2: size-fit MultiVault (optimizer_runs=200) ───────────────────────
# EIP-170 chains (Intuition Sepolia enforces the 24,576-byte runtime cap; the
# canonical impl there is 23,926 B) cannot take the package's production
# optimizer_runs=10000 bytecode. Recompile plain MultiVault at 200 runs — the
# proxy's steady-state implementation; MultiVaultMigrationMode does not fit
# even at 200 runs.
SIZEFIT_DIR="$PKG_DIR/.vendor-build-sizefit"
rm -rf "$SIZEFIT_DIR"
mkdir -p "$SIZEFIT_DIR/src/interfaces" "$SIZEFIT_DIR/src/protocol"
cd "$SIZEFIT_DIR"

echo '{ "name": "sizefit-build", "private": true }' > package.json
bun add --exact "@openzeppelin/contracts@$OZ_VERSION" "@openzeppelin/contracts-upgradeable@$OZ_VERSION" solady@0.1.26 --silent

cat > foundry.toml <<EOF
[profile.default]
  auto_detect_solc = false
  bytecode_hash = "none"
  evm_version = "cancun"
  optimizer = true
  optimizer_runs = 200
  out = "out"
  solc = "$SOLC"
  src = "src"
  libs = ["node_modules"]
  remappings = [
    "@openzeppelin/contracts/=node_modules/@openzeppelin/contracts/",
    "@openzeppelin/contracts-upgradeable/=node_modules/@openzeppelin/contracts-upgradeable/",
    "solady/=node_modules/solady/",
  ]
EOF

# Transitive import closure of MultiVault.sol.
for f in interfaces/IAtomWallet interfaces/IAtomWalletFactory interfaces/IBondingCurveRegistry \
	interfaces/IMultiVault interfaces/IMultiVaultCore interfaces/ITrustBonding \
	protocol/MultiVault protocol/MultiVaultCore; do
	cp "$CONTRACTS_V2/src/$f.sol" "src/$f.sol"
done

forge build

node - "$PKG_DIR/vendored" "$CONTRACTS_V2_VERSION" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const [outDir, pkgVersion] = process.argv.slice(2);
const artifact = JSON.parse(fs.readFileSync("out/MultiVault.sol/MultiVault.json", "utf8"));
const runtimeBytes = (artifact.deployedBytecode.object.length - 2) / 2;
if (runtimeBytes > 24_576) {
	throw new Error(`size-fit MultiVault runtime ${runtimeBytes} B exceeds EIP-170`);
}
const lean = {
	contractName: "MultiVault",
	source: `@0xintuition/contracts-v2@${pkgVersion} src/protocol/MultiVault.sol (size-fit build)`,
	compiler: { solc: "0.8.29", optimizerRuns: 200, evmVersion: "cancun", bytecodeHash: "none" },
	note: `optimizer_runs=200 so the runtime (${runtimeBytes} B) fits EIP-170 chains like Intuition Sepolia; the package-published production build (optimizer_runs=10000, 27,666 B runtime) only deploys on chains with a raised code-size cap.`,
	abi: artifact.abi,
	bytecode: artifact.bytecode.object,
};
fs.writeFileSync(path.join(outDir, "MultiVaultSizeFit.json"), `${JSON.stringify(lean, null, "\t")}\n`);
console.log(`wrote vendored/MultiVaultSizeFit.json (runtime ${runtimeBytes} B)`);
JS

cd "$PKG_DIR"
rm -rf "$BUILD_DIR" "$SIZEFIT_DIR"
echo "==> Done. Review git diff of packages/contracts/vendored/."
