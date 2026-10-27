/**
 * Network address book for the Intuition protocol.
 *
 * Canonical deployment tables and chain IDs are re-exported from
 * `@0xintuition/deployments`. The local devnet entry is loaded from the state
 * file the deployer writes (`devnet/deployments-devnet.json`), never hardcoded,
 * because devnet addresses change whenever the deploy sequence or contracts
 * version changes.
 */
import {
	getContractAddressFromChainId,
	getMultiVaultAddressFromChainId,
	getTrustAddressFromChainId,
	INTUITION_MAINNET_CHAIN_ID,
	INTUITION_TESTNET_CHAIN_ID,
	intuitionDeployments,
	intuitionMainnet,
	intuitionTestnet,
	mergeAddressOverrides,
	parseAddressOverrides,
	resolveContractAddressSet,
} from '@0xintuition/deployments';
import type { Address } from 'viem';

export {
	getContractAddressFromChainId,
	getMultiVaultAddressFromChainId,
	getTrustAddressFromChainId,
	INTUITION_MAINNET_CHAIN_ID,
	INTUITION_TESTNET_CHAIN_ID,
	intuitionDeployments,
	intuitionMainnet,
	intuitionTestnet,
	mergeAddressOverrides,
	parseAddressOverrides,
	resolveContractAddressSet,
};

export const CHAIN_IDS = {
	/** Local anvil devnet. */
	anvil: 31_337,
	/** Intuition Sepolia testnet (Caldera). */
	intuitionSepolia: INTUITION_TESTNET_CHAIN_ID,
	/** Intuition mainnet (Caldera). */
	intuition: INTUITION_MAINNET_CHAIN_ID,
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
	/** Library address linked into the 1.1+ MultiVault implementation. */
	MultiVaultLib?: Address;
	MultiVaultImplementation?: Address;
	deployer?: Address;
};

/**
 * Canonical Intuition Testnet (13579) MultiVault address from `@0xintuition/deployments`.
 */
export const CANONICAL_INTUITION_SEPOLIA_MULTIVAULT: Address = getMultiVaultAddressFromChainId(
	INTUITION_TESTNET_CHAIN_ID
);

/**
 * Intuition Sepolia (13579) smoke-indexing window deployment — source:
 * `docs/run-your-own-node.md` and `scripts/smoke-index.sh` (blocks 9,030,416–9,030,916,
 * 201 canonical events / 50 atoms). Kept alongside `CANONICAL_INTUITION_SEPOLIA_MULTIVAULT`
 * so deterministic smoke-index runs continue targeting the historical window.
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
