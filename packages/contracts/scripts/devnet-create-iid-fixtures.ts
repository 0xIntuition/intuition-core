import {
	type Address,
	createPublicClient,
	createWalletClient,
	defineChain,
	http,
	parseEventLogs,
	toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { MultiVaultAbi } from '../src/multivault';

const ANVIL_CHAIN_ID = 31_337;
const ANVIL_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const rpcUrl = process.env.RPC_URL?.trim() || 'http://127.0.0.1:8545';
const stateFile = process.env.STATE_FILE?.trim() || '../../devnet/deployments-devnet.json';

const fixtures = [
	{
		iid: 'int:isrc:USUM71703861',
		uris: ['https://musicbrainz.org/search?query=isrc%3AUSUM71703861&type=recording'],
	},
	{
		iid: 'int:isbn:9780684832722',
		uris: ['https://openlibrary.org/isbn/9780684832722'],
	},
] as const;

type DeploymentState = {
	chainId: number;
	MultiVault: Address;
};

const state = (await Bun.file(stateFile).json()) as DeploymentState;
if (state.chainId !== ANVIL_CHAIN_ID) {
	throw new Error(
		`Refusing to create deterministic development fixtures on chain ${state.chainId}; expected Anvil ${ANVIL_CHAIN_ID}.`
	);
}

const chain = defineChain({
	id: ANVIL_CHAIN_ID,
	name: 'Anvil',
	nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
	rpcUrls: { default: { http: [rpcUrl] } },
});
const account = privateKeyToAccount(ANVIL_PRIVATE_KEY);
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const atomCost = await publicClient.readContract({
	address: state.MultiVault,
	abi: MultiVaultAbi,
	functionName: 'getAtomCost',
});
const [maxUriCount, maxUriLength] = await publicClient.readContract({
	address: state.MultiVault,
	abi: MultiVaultAbi,
	functionName: 'getAtomUriConfig',
});

const results: Array<Record<string, unknown>> = [];
for (const fixture of fixtures) {
	const atomData = toHex(fixture.iid);
	const uris = fixture.uris.map((uri) => toHex(uri));
	if (uris.length > maxUriCount || uris.some((uri) => (uri.length - 2) / 2 > maxUriLength)) {
		throw new Error(`Fixture URI context exceeds the on-chain configuration for ${fixture.iid}.`);
	}

	const termId = await publicClient.readContract({
		address: state.MultiVault,
		abi: MultiVaultAbi,
		functionName: 'calculateAtomId',
		args: [atomData],
	});
	const exists = await publicClient.readContract({
		address: state.MultiVault,
		abi: MultiVaultAbi,
		functionName: 'isTermCreated',
		args: [termId],
	});
	if (exists) {
		results.push({ iid: fixture.iid, termId, status: 'already-created' });
		continue;
	}

	const request = await publicClient.simulateContract({
		account,
		address: state.MultiVault,
		abi: MultiVaultAbi,
		functionName: 'createAtomsWithUris',
		args: [account.address, [atomData], [atomCost], [uris]],
		value: atomCost,
	});
	const transactionHash = await walletClient.writeContract(request.request);
	const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
	if (receipt.status !== 'success') {
		throw new Error(`Fixture creation reverted for ${fixture.iid}: ${transactionHash}`);
	}

	const atomEvent = parseEventLogs({
		abi: MultiVaultAbi,
		logs: receipt.logs,
		eventName: 'AtomCreated',
	}).find((event) => event.args.termId === termId);
	const contextEvent = parseEventLogs({
		abi: MultiVaultAbi,
		logs: receipt.logs,
		eventName: 'AtomContextRegistered',
	}).find((event) => event.args.termId === termId);
	if (!atomEvent || !contextEvent) {
		throw new Error(
			`Creation receipt did not contain joined atom/context events for ${fixture.iid}.`
		);
	}
	if (
		contextEvent.args.uris.length !== uris.length ||
		contextEvent.args.uris.some((uri, index) => uri !== uris[index])
	) {
		throw new Error(`Creation receipt did not preserve URI bytes for ${fixture.iid}.`);
	}

	results.push({
		iid: fixture.iid,
		termId,
		status: 'created',
		transactionHash,
		blockNumber: receipt.blockNumber.toString(),
		uris: fixture.uris,
	});
}

console.log(
	JSON.stringify(
		{
			chainId: state.chainId,
			multiVault: state.MultiVault,
			atomCost: atomCost.toString(),
			uriConfig: { maxUriCount, maxUriLength },
			fixtures: results,
		},
		null,
		2
	)
);
