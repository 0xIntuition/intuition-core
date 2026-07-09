/**
 * Typed access to the vendored artifacts in `../vendored/` — contracts the
 * devnet deployer needs but `@0xintuition/contracts-v2` does not export.
 * Provenance and regeneration: `../vendored/README.md`.
 */
import type { Abi, Hex } from 'viem';

import atomWarden from '../vendored/AtomWarden.json';
import multiVaultSizeFit from '../vendored/MultiVaultSizeFit.json';
import timelockController from '../vendored/TimelockController.json';
import transparentUpgradeableProxy from '../vendored/TransparentUpgradeableProxy.json';
import upgradeableBeacon from '../vendored/UpgradeableBeacon.json';
import wrappedTrust from '../vendored/WrappedTrust.json';

export type VendoredArtifact = {
	contractName: string;
	abi: Abi;
	bytecode: Hex;
};

function artifact(raw: { contractName: string; abi: unknown; bytecode: string }): VendoredArtifact {
	return {
		contractName: raw.contractName,
		abi: raw.abi as Abi,
		bytecode: raw.bytecode as Hex,
	};
}

export const TransparentUpgradeableProxyArtifact = artifact(transparentUpgradeableProxy);
export const TimelockControllerArtifact = artifact(timelockController);
export const UpgradeableBeaconArtifact = artifact(upgradeableBeacon);
export const AtomWardenArtifact = artifact(atomWarden);
export const WrappedTrustArtifact = artifact(wrappedTrust);
/** optimizer_runs=200 build whose runtime fits EIP-170 chains (see the JSON's note). */
export const MultiVaultSizeFitArtifact = artifact(multiVaultSizeFit);

export const AtomWardenAbi = AtomWardenArtifact.abi;
export const WrappedTrustAbi = WrappedTrustArtifact.abi;
