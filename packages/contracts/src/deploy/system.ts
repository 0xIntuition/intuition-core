/**
 * Full-system deployment of the Intuition protocol, driven entirely by the
 * pinned `@0xintuition/contracts-v2` npm package (plus the vendored OZ
 * infrastructure artifacts — see `../../vendored/README.md`).
 *
 * Replicates the canonical forge pipeline at the package's build commit
 * (`94bddae`): `WrappedTrustDeploy` → `BaseEmissionsControllerDeploy` →
 * MultiVault implementation → `IntuitionDeployAndSetup`. Chain-agnostic:
 * profiles in `config.ts` cover the local anvil devnet (31337) and fresh
 * self-owned instances on Intuition Sepolia (13579).
 *
 * The published bytecode is the production build (optimizer_runs=10000) and
 * must be linked to a separately deployed MultiVaultLib. The default local
 * deployment uses MultiVaultMigrationMode, so Anvil must run with
 * `--disable-code-size-limit`.
 */

import {
	AtomWalletFactoryAbi,
	BaseEmissionsControllerAbi,
	BondingCurveRegistryAbi,
	LinearCurveAbi,
	MultiVaultLibAbi,
	MultiVaultMigrationModeAbi,
	SatelliteEmissionsControllerAbi,
	TrustBondingAbi,
} from '@0xintuition/contracts-v2/abis';
import {
	AtomWalletBytecode,
	AtomWalletFactoryBytecode,
	BaseEmissionsControllerBytecode,
	BondingCurveRegistryBytecode,
	LinearCurveBytecode,
	MultiVaultBytecode,
	MultiVaultLibBytecode,
	MultiVaultLinkReferences,
	MultiVaultMigrationModeBytecode,
	MultiVaultMigrationModeLinkReferences,
	SatelliteEmissionsControllerBytecode,
	TrustBondingBytecode,
} from '@0xintuition/contracts-v2/bytecodes';
import {
	type Address,
	type Chain,
	createPublicClient,
	createWalletClient,
	defineChain,
	encodeFunctionData,
	getAddress,
	type Hex,
	http,
	isHex,
	keccak256,
	type PublicClient,
	stringToBytes,
	type WalletClient,
	zeroAddress,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';

import type { DeploymentAddresses } from '../addresses';
import {
	AtomWardenArtifact,
	MultiVaultSizeFitArtifact,
	TimelockControllerArtifact,
	TransparentUpgradeableProxyArtifact,
	UpgradeableBeaconArtifact,
	WrappedTrustArtifact,
} from '../vendored';
import type { DeployTarget } from './config';

const MIGRATOR_ROLE = keccak256(stringToBytes('MIGRATOR_ROLE'));
const MULTIVAULT_LIB_FQN = 'src/libraries/MultiVaultLib.sol:MultiVaultLib';

/** Link a package-generated MultiVault bytecode artifact to its deployed library. */
export function linkMultiVaultLibraryBytecode(
	bytecode: string,
	linkReferences: Readonly<Record<string, string>>,
	libraryAddress: Address
): Hex {
	const placeholder = linkReferences[MULTIVAULT_LIB_FQN];
	if (!placeholder) {
		throw new Error(`missing link reference for ${MULTIVAULT_LIB_FQN}`);
	}
	if (!bytecode.includes(placeholder)) {
		throw new Error(`MultiVault bytecode does not contain link placeholder ${placeholder}`);
	}

	const linked = bytecode.replaceAll(placeholder, libraryAddress.slice(2).toLowerCase());
	if (!isHex(linked) || linked.includes('__$')) {
		throw new Error('MultiVault bytecode remains invalid after library linking');
	}
	return linked;
}

/** Minimal viem chain for any deploy target. */
export function targetChain(target: DeployTarget, rpcUrl: string): Chain {
	return defineChain({
		id: target.chainId,
		name: target.chainName,
		nativeCurrency: { name: target.currencySymbol, symbol: target.currencySymbol, decimals: 18 },
		rpcUrls: { default: { http: [rpcUrl] } },
	});
}

export type DeploySystemOptions = {
	rpcUrl: string;
	account: PrivateKeyAccount;
	target: DeployTarget;
	/**
	 * Reuse an existing WETH-like wrapped TRUST as the trust token instead of
	 * deploying a fresh one (the canonical testnet instance shares WTRUST the
	 * way chains share WETH).
	 */
	trustToken?: Address;
	/**
	 * Use the plain MultiVault bytecode as the proxy implementation instead of
	 * the production-faithful MultiVaultMigrationMode (escape hatch; both pass
	 * the URI-backed atom acceptance test).
	 */
	plainMultiVaultImplementation?: boolean;
	log?: (message: string) => void;
};

type Clients = {
	publicClient: PublicClient;
	walletClient: WalletClient;
	account: PrivateKeyAccount;
	chain: Chain;
	log: (message: string) => void;
	/** Block number of the most recent deployment receipt. */
	lastDeployBlock: bigint;
};

async function deployContract(
	clients: Clients,
	label: string,
	abi: readonly unknown[],
	bytecode: Hex,
	args: readonly unknown[] = []
): Promise<Address> {
	const hash = await clients.walletClient.deployContract({
		// viem's Abi type is narrower than the const-asserted package ABIs
		abi: abi as never,
		bytecode,
		args: args as unknown[],
		account: clients.account,
		chain: clients.chain,
	});
	const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success' || !receipt.contractAddress) {
		throw new Error(`${label}: deployment reverted (tx ${hash})`);
	}
	clients.lastDeployBlock = receipt.blockNumber;
	const address = getAddress(receipt.contractAddress);
	clients.log(`    ${label}: ${address}`);
	return address;
}

/** Deploy a TransparentUpgradeableProxy(implementation, initialOwner, initData). */
async function deployProxy(
	clients: Clients,
	label: string,
	implementation: Address,
	initialOwner: Address,
	initData: Hex = '0x'
): Promise<Address> {
	return deployContract(
		clients,
		label,
		TransparentUpgradeableProxyArtifact.abi,
		TransparentUpgradeableProxyArtifact.bytecode,
		[implementation, initialOwner, initData]
	);
}

async function write(
	clients: Clients,
	label: string,
	address: Address,
	abi: readonly unknown[],
	functionName: string,
	args: readonly unknown[]
): Promise<void> {
	const hash = await clients.walletClient.writeContract({
		address,
		// viem's Abi type is narrower than the const-asserted package ABIs
		abi: abi as never,
		functionName,
		args: args as unknown[],
		account: clients.account,
		chain: clients.chain,
	});
	const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') {
		throw new Error(`${label}: reverted (tx ${hash})`);
	}
	clients.log(`    ${label}: ok`);
}

/**
 * Deploy a complete, self-owned Intuition system to the target chain.
 * Mirrors `IntuitionDeployAndSetup.s.sol`; see file header.
 */
export async function deployIntuitionSystem(
	options: DeploySystemOptions
): Promise<DeploymentAddresses> {
	const log = options.log ?? console.log;
	const chain = targetChain(options.target, options.rpcUrl);
	const publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
	const walletClient = createWalletClient({ chain, transport: http(options.rpcUrl) });
	const clients: Clients = {
		publicClient,
		walletClient,
		account: options.account,
		chain,
		log,
		lastDeployBlock: 0n,
	};

	const chainId = await publicClient.getChainId();
	if (chainId !== options.target.chainId) {
		throw new Error(
			`expected chain-id ${options.target.chainId} (${options.target.chainName}), got ${chainId}`
		);
	}

	const admin = options.account.address;
	const cfg = options.target.config;

	// SetupScript: a fresh instance's bonding/emissions epochs start "now".
	const latestBlock = await publicClient.getBlock();
	const startTimestamp = latestBlock.timestamp + cfg.bondingStartOffsetSeconds;
	const coreEmissionsInit = {
		startTimestamp,
		emissionsLength: cfg.emissionsLength,
		emissionsPerEpoch: cfg.emissionsPerEpoch,
		emissionsReductionCliff: cfg.emissionsReductionCliff,
		emissionsReductionBasisPoints: cfg.emissionsReductionBasisPoints,
	};

	log('==> [1/4] WrappedTrust (WTRUST token)');
	let wrappedTrust: Address;
	if (options.trustToken) {
		wrappedTrust = getAddress(options.trustToken);
		const code = await publicClient.getCode({ address: wrappedTrust });
		if (!code || code === '0x') {
			throw new Error(`trust token ${wrappedTrust} has no code on ${options.target.chainName}`);
		}
		log(`    WrappedTrust: ${wrappedTrust} (reused)`);
	} else {
		wrappedTrust = await deployContract(
			clients,
			'WrappedTrust',
			WrappedTrustArtifact.abi,
			WrappedTrustArtifact.bytecode
		);
	}

	log('==> [2/4] BaseEmissionsController');
	const baseTimelock = await deployContract(
		clients,
		'BaseEmissionsController upgrades TimelockController',
		TimelockControllerArtifact.abi,
		TimelockControllerArtifact.bytecode,
		[cfg.timelockMinDelay, [admin], [admin], zeroAddress]
	);
	const baseEmissionsImpl = await deployContract(
		clients,
		'BaseEmissionsController implementation',
		BaseEmissionsControllerAbi,
		BaseEmissionsControllerBytecode
	);
	const baseEmissionsController = await deployProxy(
		clients,
		'BaseEmissionsController proxy',
		baseEmissionsImpl,
		baseTimelock,
		encodeFunctionData({
			abi: BaseEmissionsControllerAbi,
			functionName: 'initialize',
			args: [
				admin,
				admin,
				wrappedTrust,
				{
					hubOrSpoke: cfg.metalayerHubOrSpoke,
					recipientDomain: cfg.satelliteMetalayerRecipientDomain,
					gasLimit: cfg.metalayerGasLimit,
					finalityState: 0, // FinalityState.INSTANT
				},
				coreEmissionsInit,
			],
		})
	);

	log('==> [3/4] MultiVault library + proxy implementation');
	const multiVaultLib = await deployContract(
		clients,
		'MultiVaultLib',
		MultiVaultLibAbi,
		MultiVaultLibBytecode
	);
	// EIP-170 targets use the verified size-fit plain-MultiVault build.
	// MultiVaultMigrationMode does not fit under the cap, and plain MultiVault
	// is the steady-state implementation the migration proxy upgrades to.
	const useMigrationMode = !(options.target.eip170 || options.plainMultiVaultImplementation);
	const multiVaultImplementation = options.target.eip170
		? await deployContract(
				clients,
				'MultiVault implementation (size-fit, optimizer_runs=200)',
				MultiVaultSizeFitArtifact.abi,
				linkMultiVaultLibraryBytecode(
					MultiVaultSizeFitArtifact.bytecode,
					MultiVaultLinkReferences,
					multiVaultLib
				)
			)
		: await deployContract(
				clients,
				useMigrationMode ? 'MultiVaultMigrationMode implementation' : 'MultiVault implementation',
				MultiVaultMigrationModeAbi,
				linkMultiVaultLibraryBytecode(
					useMigrationMode ? MultiVaultMigrationModeBytecode : MultiVaultBytecode,
					useMigrationMode ? MultiVaultMigrationModeLinkReferences : MultiVaultLinkReferences,
					multiVaultLib
				)
			);

	log('==> [4/4] IntuitionDeployAndSetup (full system)');
	const upgradesTimelock = await deployContract(
		clients,
		'Upgrades TimelockController',
		TimelockControllerArtifact.abi,
		TimelockControllerArtifact.bytecode,
		[cfg.timelockMinDelay, [admin], [admin], zeroAddress]
	);
	const parametersTimelock = await deployContract(
		clients,
		'Parameters TimelockController',
		TimelockControllerArtifact.abi,
		TimelockControllerArtifact.bytecode,
		[cfg.timelockMinDelay, [admin], [admin], zeroAddress]
	);

	const atomWalletImpl = await deployContract(
		clients,
		'AtomWallet implementation',
		[],
		AtomWalletBytecode
	);
	const atomWalletBeacon = await deployContract(
		clients,
		'AtomWallet UpgradeableBeacon',
		UpgradeableBeaconArtifact.abi,
		UpgradeableBeaconArtifact.bytecode,
		[atomWalletImpl, upgradesTimelock]
	);

	const atomWalletFactoryImpl = await deployContract(
		clients,
		'AtomWalletFactory implementation',
		AtomWalletFactoryAbi,
		AtomWalletFactoryBytecode
	);
	const atomWalletFactory = await deployProxy(
		clients,
		'AtomWalletFactory proxy',
		atomWalletFactoryImpl,
		upgradesTimelock
	);

	const atomWardenImpl = await deployContract(
		clients,
		'AtomWarden implementation',
		AtomWardenArtifact.abi,
		AtomWardenArtifact.bytecode
	);
	const atomWarden = await deployProxy(
		clients,
		'AtomWarden proxy',
		atomWardenImpl,
		upgradesTimelock
	);

	const bondingCurveRegistryImpl = await deployContract(
		clients,
		'BondingCurveRegistry implementation',
		BondingCurveRegistryAbi,
		BondingCurveRegistryBytecode
	);
	const bondingCurveRegistry = await deployProxy(
		clients,
		'BondingCurveRegistry proxy',
		bondingCurveRegistryImpl,
		upgradesTimelock,
		encodeFunctionData({ abi: BondingCurveRegistryAbi, functionName: 'initialize', args: [admin] })
	);

	const linearCurveImpl = await deployContract(
		clients,
		'LinearCurve implementation',
		LinearCurveAbi,
		LinearCurveBytecode
	);
	const linearCurve = await deployProxy(
		clients,
		'LinearCurve proxy',
		linearCurveImpl,
		upgradesTimelock,
		encodeFunctionData({ abi: LinearCurveAbi, functionName: 'initialize', args: ['Linear Curve'] })
	);
	await write(
		clients,
		'BondingCurveRegistry.addBondingCurve(LinearCurve)',
		bondingCurveRegistry,
		BondingCurveRegistryAbi,
		'addBondingCurve',
		[linearCurve]
	);

	const satelliteImpl = await deployContract(
		clients,
		'SatelliteEmissionsController implementation',
		SatelliteEmissionsControllerAbi,
		SatelliteEmissionsControllerBytecode
	);
	const satelliteEmissionsController = await deployProxy(
		clients,
		'SatelliteEmissionsController proxy',
		satelliteImpl,
		upgradesTimelock,
		encodeFunctionData({
			abi: SatelliteEmissionsControllerAbi,
			functionName: 'initialize',
			args: [
				admin,
				baseEmissionsController,
				{
					hubOrSpoke: cfg.metalayerHubOrSpoke,
					recipientDomain: cfg.baseMetalayerRecipientDomain,
					gasLimit: cfg.metalayerGasLimit,
					finalityState: 0, // FinalityState.INSTANT
				},
				coreEmissionsInit,
			],
		})
	);

	const trustBondingImpl = await deployContract(
		clients,
		'TrustBonding implementation',
		TrustBondingAbi,
		TrustBondingBytecode
	);
	const trustBonding = await deployProxy(
		clients,
		'TrustBonding proxy',
		trustBondingImpl,
		upgradesTimelock,
		encodeFunctionData({
			abi: TrustBondingAbi,
			functionName: 'initialize',
			args: [
				admin,
				// Temporarily the admin, so initial setMultiVault/setTimelock below
				// skip the timelock delay (mirrors the forge script).
				admin,
				wrappedTrust,
				cfg.bondingEpochLength,
				satelliteEmissionsController,
				cfg.bondingSystemUtilizationLowerBound,
				cfg.bondingPersonalUtilizationLowerBound,
			],
		})
	);

	await write(
		clients,
		'SatelliteEmissionsController.setTrustBonding',
		satelliteEmissionsController,
		SatelliteEmissionsControllerAbi,
		'setTrustBonding',
		[trustBonding]
	);
	const controllerRole = await publicClient.readContract({
		address: satelliteEmissionsController,
		abi: SatelliteEmissionsControllerAbi,
		functionName: 'CONTROLLER_ROLE',
	});
	await write(
		clients,
		'SatelliteEmissionsController.grantRole(CONTROLLER_ROLE, TrustBonding)',
		satelliteEmissionsController,
		SatelliteEmissionsControllerAbi,
		'grantRole',
		[controllerRole, trustBonding]
	);

	const multiVaultInitData = encodeFunctionData({
		abi: MultiVaultMigrationModeAbi,
		functionName: 'initialize',
		args: [
			{
				admin,
				protocolMultisig: admin,
				feeDenominator: cfg.feeDenominator,
				trustBonding,
				minDeposit: cfg.minDeposit,
				minShare: cfg.minShare,
				atomDataMaxLength: cfg.atomDataMaxLength,
				feeThreshold: cfg.feeThreshold,
			},
			{
				atomCreationProtocolFee: cfg.atomCreationProtocolFee,
				atomWalletDepositFee: cfg.atomWalletDepositFee,
			},
			{
				tripleCreationProtocolFee: cfg.tripleCreationProtocolFee,
				atomDepositFractionForTriple: cfg.atomDepositFractionForTriple,
			},
			{
				entryPoint: cfg.entryPoint,
				atomWarden,
				atomWalletBeacon,
				atomWalletFactory,
			},
			{ entryFee: cfg.entryFee, exitFee: cfg.exitFee, protocolFee: cfg.protocolFee },
			{ registry: bondingCurveRegistry, defaultCurveId: 1n },
		],
	});
	const multiVault = await deployProxy(
		clients,
		'MultiVault proxy',
		multiVaultImplementation,
		upgradesTimelock,
		multiVaultInitData
	);
	const multiVaultDeployBlock = clients.lastDeployBlock;

	await write(
		clients,
		'AtomWalletFactory.initialize(MultiVault)',
		atomWalletFactory,
		AtomWalletFactoryAbi,
		'initialize',
		[multiVault]
	);
	await write(
		clients,
		'AtomWarden.initialize(admin, MultiVault, claim policy)',
		atomWarden,
		AtomWardenArtifact.abi,
		'initialize',
		[
			admin,
			multiVault,
			cfg.atomWardenClaimWindow,
			cfg.atomWardenMinFeeThreshold,
			cfg.atomWardenSignatureThreshold,
			cfg.atomWardenMaxValidAfter,
			cfg.atomWardenMaxValidUntil,
			cfg.atomWardenMaxClaimsPerWindow,
			cfg.atomWardenClaimCapWindow,
		]
	);
	await write(
		clients,
		'TrustBonding.setMultiVault',
		trustBonding,
		TrustBondingAbi,
		'setMultiVault',
		[multiVault]
	);
	await write(clients, 'TrustBonding.setTimelock', trustBonding, TrustBondingAbi, 'setTimelock', [
		parametersTimelock,
	]);
	await write(
		clients,
		'MultiVault.grantRole(MIGRATOR_ROLE, admin)',
		multiVault,
		MultiVaultMigrationModeAbi,
		'grantRole',
		[MIGRATOR_ROLE, admin]
	);

	return {
		chainId: options.target.chainId,
		WrappedTrust: wrappedTrust,
		BaseEmissionsController: baseEmissionsController,
		MultiVaultLib: multiVaultLib,
		MultiVaultImplementation: multiVaultImplementation,
		MultiVault: multiVault,
		AtomWalletFactory: atomWalletFactory,
		AtomWarden: atomWarden,
		BondingCurveRegistry: bondingCurveRegistry,
		LinearCurve: linearCurve,
		SatelliteEmissionsController: satelliteEmissionsController,
		TrustBonding: trustBonding,
		deployBlock: Number(multiVaultDeployBlock),
		deployer: admin,
	};
}
