/**
 * Network address book for the Intuition protocol.
 *
 * Canonical (verifiable) deployments only — the devnet entry is loaded from
 * the state file the deployer writes (`devnet/deployments-devnet.json`), never
 * hardcoded, because devnet addresses change whenever the deploy sequence or
 * contracts version changes.
 */
import type { Address } from 'viem';

export const CHAIN_IDS = {
	/** Local anvil devnet. */
	anvil: 31_337,
	/** Intuition Sepolia testnet (Caldera). */
	intuitionSepolia: 13_579,
	/** Intuition mainnet (Caldera). */
	intuition: 1155,
} as const;

export type IntuitionChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

/** Contract addresses for one deployment of the protocol. */
export type DeploymentAddresses = {
	chainId: number;
	MultiVault: Address;
	/** Block the MultiVault proxy was deployed at (indexer start block). */
	deployBlock: number;
	WrappedTrust?: Address;
	AtomWalletFactory?: Address;
	AtomWarden?: Address;
	BondingCurveRegistry?: Address;
	LinearCurve?: Address;
	SatelliteEmissionsController?: Address;
	TrustBonding?: Address;
	BaseEmissionsController?: Address;
	MultiVaultImplementation?: Address;
	deployer?: Address;
};

/**
 * Intuition Sepolia (13579) — source: docs/run-your-own-node.md, the public
 * testnet the indexer defaults document.
 */
export const INTUITION_SEPOLIA: DeploymentAddresses = {
	chainId: CHAIN_IDS.intuitionSepolia,
	MultiVault: '0xeBc49d356B7f64D888130D85CC6D17114a6843ec',
	deployBlock: 9_030_416,
};

/**
 * Devnet state-file shape written by the deployer (`deploy/cli.ts`) and by the
 * legacy forge pipeline before it — kept identical so downstream tooling and
 * docs never notice the switch.
 */
export type DevnetState = DeploymentAddresses & { chainId: 31_337 };

/**
 * Parse a deployment state file (`devnet/deployments-*.json`). Throws when
 * the payload is not a deployment for the expected chain with a MultiVault.
 */
export function parseDeploymentState(json: string, expectedChainId: number): DeploymentAddresses {
	const state = JSON.parse(json) as Partial<DeploymentAddresses>;
	if (state.chainId !== expectedChainId) {
		throw new Error(`deployment state: expected chainId ${expectedChainId}, got ${state.chainId}`);
	}
	if (!state.MultiVault) {
		throw new Error('deployment state: missing MultiVault address');
	}
	return state as DeploymentAddresses;
}

/** Back-compat wrapper for the local anvil devnet state file. */
export function parseDevnetState(json: string): DevnetState {
	return parseDeploymentState(json, CHAIN_IDS.anvil) as DevnetState;
}
