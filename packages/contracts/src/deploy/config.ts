/**
 * Deployment profiles for standing up a fresh Intuition protocol instance.
 *
 * Values mirror `script/SetupScript.s.sol` in intuition-contracts-v2 at the
 * commit `@0xintuition/contracts-v2` was built from (`94bddae`): the `anvil`
 * profile is the `NETWORK_ANVIL` branch; the `intuition-sepolia` profile is
 * the `NETWORK_INTUITION_SEPOLIA` branch. Chain-derived values
 * (`BONDING_START_TIMESTAMP = block.timestamp + offset`) are computed by the
 * deployer at run time — a fresh instance always starts its epochs "now".
 */
import type { Address } from 'viem';
import { parseEther, parseUnits } from 'viem';

const ONE_DAY = 86_400n;
const TWO_WEEKS = ONE_DAY * 14n;

/** 75M TRUST over the first emissions year (canonical testnet/mainnet value). */
const TRUST_TOKEN_ONE_YEAR_EMISSIONS = parseEther('75000000');

export type DeployConfig = {
	entryPoint: Address;
	timelockMinDelay: bigint;
	metalayerHubOrSpoke: Address;
	/** Recipient domain the BaseEmissionsController stand-in dispatches to. */
	satelliteMetalayerRecipientDomain: number;
	/** Recipient domain the SatelliteEmissionsController dispatches to. */
	baseMetalayerRecipientDomain: number;
	metalayerGasLimit: bigint;
	feeDenominator: bigint;
	minShare: bigint;
	minDeposit: bigint;
	atomDataMaxLength: bigint;
	feeThreshold: bigint;
	atomCreationProtocolFee: bigint;
	atomWalletDepositFee: bigint;
	tripleCreationProtocolFee: bigint;
	atomDepositFractionForTriple: bigint;
	entryFee: bigint;
	exitFee: bigint;
	protocolFee: bigint;
	bondingEpochLength: bigint;
	bondingSystemUtilizationLowerBound: bigint;
	bondingPersonalUtilizationLowerBound: bigint;
	bondingStartOffsetSeconds: bigint;
	emissionsLength: bigint;
	emissionsPerEpoch: bigint;
	emissionsReductionCliff: bigint;
	emissionsReductionBasisPoints: bigint;
};

/** Values shared by every network in SetupScript.s.sol. */
const NETWORK_AGNOSTIC = {
	/** Deterministic EntryPoint v0.8.0 address (same on all chains). */
	entryPoint: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as Address,
	timelockMinDelay: 3600n, // 60 minutes
	metalayerGasLimit: 125_000n,
	feeDenominator: 10_000n,
	minShare: parseUnits('1', 6), // ghost shares
	minDeposit: parseEther('0.01'),
	atomDataMaxLength: 1000n,
	feeThreshold: parseEther('1'),
	atomCreationProtocolFee: parseEther('0.1'),
	atomWalletDepositFee: 50n, // 0.5%
	tripleCreationProtocolFee: parseEther('0.1'),
	atomDepositFractionForTriple: 90n, // 0.9%
	entryFee: 50n, // 0.5%
	exitFee: 75n, // 0.75%
	protocolFee: 125n, // 1.25%
	bondingSystemUtilizationLowerBound: 5000n, // 50%
	bondingPersonalUtilizationLowerBound: 2500n, // 25%
	bondingStartOffsetSeconds: 100n, // block.timestamp + 100 for fresh instances
	emissionsReductionBasisPoints: 1000n, // 10%
} as const;

/** NETWORK_ANVIL branch: short epochs so local pipelines cycle fast. */
export const ANVIL_CONFIG: DeployConfig = {
	...NETWORK_AGNOSTIC,
	metalayerHubOrSpoke: '0x007700aa28A331B91219Ffa4A444711F0D9E57B5',
	satelliteMetalayerRecipientDomain: 0, // unset for anvil in SetupScript
	baseMetalayerRecipientDomain: 11_111,
	bondingEpochLength: TWO_WEEKS,
	emissionsLength: ONE_DAY,
	emissionsPerEpoch: parseEther('1000'),
	emissionsReductionCliff: 4n,
};

/** NETWORK_INTUITION_SEPOLIA branch: canonical testnet parameters. */
export const INTUITION_SEPOLIA_CONFIG: DeployConfig = {
	...NETWORK_AGNOSTIC,
	metalayerHubOrSpoke: '0x007700aa28A331B91219Ffa4A444711F0D9E57B5',
	satelliteMetalayerRecipientDomain: 13_579,
	baseMetalayerRecipientDomain: 84_532,
	bondingEpochLength: TWO_WEEKS,
	emissionsLength: TWO_WEEKS,
	emissionsPerEpoch: TRUST_TOKEN_ONE_YEAR_EMISSIONS / 26n,
	emissionsReductionCliff: 26n,
	// CoreEmissionsController reverts when startTimestamp < block.timestamp at
	// init. On a real network the ~40 sequential receipt waits can consume the
	// anvil-sized 100s buffer before the later proxies initialize — give the
	// epoch start a full hour of headroom.
	bondingStartOffsetSeconds: 3600n,
};

export type DeployTarget = {
	key: 'anvil' | 'intuition-sepolia';
	chainId: number;
	chainName: string;
	currencySymbol: string;
	defaultRpcUrl: string;
	config: DeployConfig;
	/**
	 * Existing WETH-like wrapped TRUST to reuse as the trust token (deployed
	 * once per chain, like WETH). Absent → the deployer deploys a fresh one.
	 */
	canonicalWrappedTrust?: Address;
	/**
	 * Chain enforces the EIP-170 24,576-byte runtime cap → the MultiVault
	 * implementation must be the size-fit build (the production
	 * optimizer_runs=10000 bytecode only deploys on raised-cap chains).
	 */
	eip170: boolean;
	/** State file name under devnet/. */
	stateFileName: string;
};

export const DEPLOY_TARGETS: Record<DeployTarget['key'], DeployTarget> = {
	anvil: {
		key: 'anvil',
		chainId: 31_337,
		chainName: 'Anvil',
		currencySymbol: 'ETH',
		defaultRpcUrl: 'http://127.0.0.1:8545',
		config: ANVIL_CONFIG,
		eip170: false, // anvil runs with --disable-code-size-limit
		stateFileName: 'deployments-devnet.json',
	},
	'intuition-sepolia': {
		key: 'intuition-sepolia',
		chainId: 13_579,
		chainName: 'Intuition Sepolia',
		currencySymbol: 'tTRUST',
		defaultRpcUrl: 'https://testnet.rpc.intuition.systems/http',
		config: INTUITION_SEPOLIA_CONFIG,
		// deployments.md / .env.example in intuition-contracts-v2: "Deployed once."
		canonicalWrappedTrust: '0xDE80b6EE63f7D809427CA350e30093F436A0fe35',
		// Verified live: the canonical MultiVault impl on 13579 is 23,926 B —
		// the chain enforces EIP-170.
		eip170: true,
		stateFileName: 'deployments-testnet.json',
	},
};

export const ANVIL_CHAIN_ID = DEPLOY_TARGETS.anvil.chainId;
