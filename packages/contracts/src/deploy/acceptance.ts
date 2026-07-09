/**
 * Deployment acceptance test: creating an atom on the deployed MultiVault
 * must emit `AtomCreated`. Port of the check at the end of the legacy
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
};

/** Create a unique throwaway atom and assert the `AtomCreated` event fires. */
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

	// Unique per run so re-runs against persistent chain state never collide
	// with an already-created atom.
	const atomData = toHex(`devnet-atom-${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
	const hash = await walletClient.writeContract({
		address: options.multiVault,
		abi: MultiVaultAbi,
		functionName: 'createAtoms',
		args: [[atomData], [atomCost]],
		value: atomCost,
		account: options.account,
		chain,
	});
	const receipt = await publicClient.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') {
		throw new Error(`acceptance: createAtoms reverted (tx ${hash})`);
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

	log(`    ACCEPTANCE PASSED: AtomCreated emitted in tx ${hash} (block ${receipt.blockNumber})`);
	log(`      creator: ${event.args.creator}`);
	log(`      termId:  ${event.args.termId}`);
	return {
		transactionHash: hash,
		blockNumber: receipt.blockNumber,
		termId: event.args.termId,
		creator: event.args.creator,
		atomCost,
	};
}
