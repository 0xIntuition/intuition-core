/**
 * Intuition instance deploy CLI — stand up a complete, self-owned protocol
 * deployment on a local anvil devnet or on Intuition Sepolia.
 *
 *   bun run devnet:deploy     # anvil (31337); anvil must run with
 *                             #   --disable-code-size-limit
 *   bun run testnet:deploy    # Intuition Sepolia (13579); requires a funded
 *                             #   PRIVATE_KEY (tTRUST gas — see the faucet at
 *                             #   https://testnet.hub.intuition.systems)
 *
 * Idempotent: when the state file's MultiVault still has code on the target
 * chain, deployment is skipped and only the acceptance test re-runs.
 *
 * Environment:
 *   DEPLOY_TARGET  anvil | intuition-sepolia   (set by the package scripts)
 *   RPC_URL        override the target's default RPC
 *   PRIVATE_KEY    deployer/admin key (required for testnet; defaults to the
 *                  anvil dev key locally)
 *   TRUST_TOKEN    wrapped-TRUST address to reuse ("fresh" forces a new
 *                  deploy; testnet defaults to the canonical WTRUST)
 *   STATE_FILE     deployment state path (default <repo>/devnet/<per-target>)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Address, createPublicClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { parseDeploymentState } from '../addresses';
import { runCreateAtomAcceptance } from './acceptance';
import { DEPLOY_TARGETS, type DeployTarget } from './config';
import { deployIntuitionSystem, targetChain } from './system';

// Anvil dev account #0 — the universal Foundry dev key, safe only for local chains.
const ANVIL_DEV_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const targetKey = (process.env.DEPLOY_TARGET ?? 'anvil') as DeployTarget['key'];
const target = DEPLOY_TARGETS[targetKey];
if (!target) {
	console.error(`error: unknown DEPLOY_TARGET "${targetKey}" (anvil | intuition-sepolia)`);
	process.exit(1);
}

const isLocal = target.key === 'anvil';
const rpcUrl = process.env.RPC_URL ?? target.defaultRpcUrl;

const privateKey = process.env.PRIVATE_KEY ?? (isLocal ? ANVIL_DEV_KEY : undefined);
if (!privateKey) {
	console.error(
		`error: PRIVATE_KEY is required for ${target.chainName} — the deployer/admin needs ` +
			`${target.currencySymbol} for gas (~40 transactions).`
	);
	process.exit(1);
}
const account = privateKeyToAccount(privateKey as `0x${string}`);

// Trust token: "fresh" forces a new WrappedTrust; an address reuses it;
// unset falls back to the target's canonical WTRUST when one exists.
const trustTokenEnv = process.env.TRUST_TOKEN?.trim();
const trustToken: Address | undefined =
	trustTokenEnv === 'fresh'
		? undefined
		: ((trustTokenEnv as Address | undefined) ?? target.canonicalWrappedTrust);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const stateFile = process.env.STATE_FILE ?? resolve(repoRoot, 'devnet', target.stateFileName);

console.log(`==> Target:   ${target.chainName} (chain ${target.chainId})`);
console.log(`==> RPC:      ${rpcUrl}`);
console.log(`==> Deployer: ${account.address}`);
console.log(`==> State:    ${stateFile}`);

const publicClient = createPublicClient({
	chain: targetChain(target, rpcUrl),
	transport: http(rpcUrl),
});

// Preflight: right chain, funded deployer.
const liveChainId = await publicClient.getChainId();
if (liveChainId !== target.chainId) {
	console.error(`error: RPC reports chain ${liveChainId}, expected ${target.chainId}`);
	process.exit(1);
}
const balance = await publicClient.getBalance({ address: account.address });
console.log(`==> Balance:  ${formatEther(balance)} ${target.currencySymbol}`);
if (!isLocal && balance === 0n) {
	console.error(
		`error: deployer has no ${target.currencySymbol} on ${target.chainName}. ` +
			'Fund it (testnet faucet: https://testnet.hub.intuition.systems) and re-run.'
	);
	process.exit(1);
}

async function existingDeployment() {
	if (!existsSync(stateFile)) {
		return null;
	}
	try {
		const state = parseDeploymentState(readFileSync(stateFile, 'utf8'), target.chainId);
		const code = await publicClient.getCode({ address: state.MultiVault });
		return code && code !== '0x' ? state : null;
	} catch {
		return null;
	}
}

let state = await existingDeployment();
if (state) {
	console.log(
		`==> Existing deployment found at ${state.MultiVault} (state: ${stateFile}); skipping deploy.`
	);
} else {
	state = await deployIntuitionSystem({ rpcUrl, account, target, trustToken });
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
	console.log(`==> State written to ${stateFile}`);
}

console.log(`==> MultiVault proxy: ${state.MultiVault}`);
console.log(`==> Acceptance: createAtoms on ${state.MultiVault}`);
await runCreateAtomAcceptance({ rpcUrl, account, multiVault: state.MultiVault, target });

console.log('==> DONE');
console.log('');
console.log('Point the Core indexer at this instance (.env):');
console.log(`  INTUITION_RPC_URL=${isLocal ? 'http://anvil:8545' : rpcUrl}`);
console.log(`  CHAIN_ID=${target.chainId}`);
console.log(`  MULTIVAULT_CONTRACT_ADDRESS=${state.MultiVault}`);
console.log(`  MULTIVAULT_START_BLOCK=${state.deployBlock}`);
console.log('  MULTIVAULT_END_BLOCK=');
