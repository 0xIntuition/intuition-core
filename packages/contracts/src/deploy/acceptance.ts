/**
 * Deployment acceptance test: creating an atom with URI context on the
 * deployed MultiVault must emit `AtomCreated` and `AtomContextRegistered`.
 * Port of the check at the end of the legacy
 * `devnet/devnet-deploy.sh`, generalized to any deploy target.
 */

import { MultiVaultAbi } from '@0xintuition/contracts-v2/abis';
import {
	type Address,
	createPublicClient,
	createWalletClient,
	http,
	parseEventLogs,
	toHex,
} from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import type { DeployTarget } from './config';
import { targetChain } from './system';

export type AcceptanceResult = {
	transactionHash: `0x${string}`;
	blockNumber: bigint;
	termId: `0x${string}`;
	creator: Address;
	atomCost: bigint;
	uris: readonly `0x${string}`[];
	maxUriCount: number;
	maxUriLength: number;
};

/** Create a unique URI-backed atom and assert both creation events fire. */
export async function runCreateAtomAcceptance(options: {
	rpcUrl: string;
	account: PrivateKeyAccount;
	multiVault: Address;
	target: DeployTarget;
	log?: (message: string) => void;
}): Promise<AcceptanceResult> {
	const log = options.log ?? console.log;
	const chain = targetChain(options.target, options.rpcUrl);
	const publicClient = createPublicClient({ chain, transport: http(options.rpcUrl) });
	const walletClient = createWalletClient({ chain, transport: http(options.rpcUrl) });

	const atomCost = await publicClient.readContract({
		address: options.multiVault,
		abi: MultiVaultAbi,
		functionName: 'getAtomCost',
	});
	log(`    getAtomCost() = ${atomCost} wei`);
	const [maxUriCount, maxUriLength] = await publicClient.readContract({
		address: options.multiVault,
		abi: MultiVaultAbi,
		functionName: 'getAtomUriConfig',
	});
	if (maxUriCount < 1 || maxUriLength < 1) {
		throw new Error(
			`acceptance: invalid atom URI config (maxUriCount=${maxUriCount}, maxUriLength=${maxUriLength})`
		);
	}
	log(`    getAtomUriConfig() = ${maxUriCount} URIs × ${maxUriLength} bytes`);

	// Unique per run so re-runs against persistent chain state never collide
	// with an already-created atom.
	const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
	// This probe validates the protocol's URI-aware creation path, not IID
	// semantics. Keep its throwaway payload visibly outside the `int:` namespace
	// so test data cannot be mistaken for a registered Intuition Identifier.
	const atomData = toHex(`devnet-uri-atom-${nonce}`);
	const uris = [toHex(`https://example.test/atoms/${nonce}`)] as const;
	const expectedTermId = await publicClient.readContract({
		address: options.multiVault,
		abi: MultiVaultAbi,
		functionName: 'calculateAtomId',
		args: [atomData],
	});
	const hash = await walletClient.writeContract({
		address: options.multiVault,
		abi: MultiVaultAbi,
		functionName: 'createAtomsWithUris',
		args: [options.account.address, [atomData], [atomCost], [uris]],
		value: atomCost,
		account: options.account,
		chain,
	});
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') {
		throw new Error(`acceptance: createAtomsWithUris reverted (tx ${hash})`);
	}

	const events = parseEventLogs({
		abi: MultiVaultAbi,
		logs: receipt.logs,
		eventName: 'AtomCreated',
	});
	const event = events.find((e) => e.address.toLowerCase() === options.multiVault.toLowerCase());
	if (!event) {
		throw new Error(`acceptance: AtomCreated event NOT found in receipt logs (tx ${hash})`);
	}
	const contextEvents = parseEventLogs({
		abi: MultiVaultAbi,
		logs: receipt.logs,
		eventName: 'AtomContextRegistered',
	});
	const contextEvent = contextEvents.find(
		(e) =>
			e.address.toLowerCase() === options.multiVault.toLowerCase() &&
			e.args.termId === event.args.termId
	);
	if (!contextEvent) {
		throw new Error(
			`acceptance: AtomContextRegistered event NOT found in receipt logs (tx ${hash})`
		);
	}
	if (event.args.termId !== expectedTermId) {
		throw new Error(
			`acceptance: AtomCreated term ID does not match calculateAtomId(atomData) (tx ${hash})`
		);
	}
	if (contextEvent.args.uris.length !== 1 || contextEvent.args.uris[0] !== uris[0]) {
		throw new Error(
			`acceptance: AtomContextRegistered contained unexpected URI context (tx ${hash})`
		);
	}

	log(
		`    ACCEPTANCE PASSED: AtomCreated + AtomContextRegistered emitted in tx ${hash} (block ${receipt.blockNumber})`
	);
	log(`      creator: ${event.args.creator}`);
	log(`      termId:  ${event.args.termId}`);
	return {
		transactionHash: hash,
		blockNumber: receipt.blockNumber,
		termId: event.args.termId,
		creator: event.args.creator,
		atomCost,
		uris,
		maxUriCount,
		maxUriLength,
	};
}
