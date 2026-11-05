/**
 * Typed access to the vendored artifacts in `../vendored/` — contracts the
 * devnet deployer needs but `@0xintuition/contracts-v2` does not export.
 * Provenance and regeneration: `../vendored/README.md`.
 */
import type { Abi, Hex } from 'viem';

import multiVaultSizeFit from '../vendored/MultiVaultSizeFit.json';
import transparentUpgradeableProxy from '../vendored/TransparentUpgradeableProxy.json';
import upgradeableBeacon from '../vendored/UpgradeableBeacon.json';

export type VendoredArtifact = {
	contractName: string;
	abi: Abi;
	bytecode: Hex;
};

export type LinkableVendoredArtifact = {
	contractName: string;
	abi: Abi;
	/** Solidity library placeholders must be linked before deployment. */
	bytecode: string;
};

function artifact(raw: { contractName: string; abi: unknown; bytecode: string }): VendoredArtifact {
	return {
		contractName: raw.contractName,
		abi: raw.abi as Abi,
		bytecode: raw.bytecode as Hex,
	};
}

export const TransparentUpgradeableProxyArtifact = artifact(transparentUpgradeableProxy);
export const UpgradeableBeaconArtifact = artifact(upgradeableBeacon);
/** optimizer_runs=200 build whose runtime fits EIP-170 chains (see the JSON's note). */
export const MultiVaultSizeFitArtifact: LinkableVendoredArtifact = {
	contractName: multiVaultSizeFit.contractName,
	abi: multiVaultSizeFit.abi as Abi,
	bytecode: multiVaultSizeFit.bytecode,
};
