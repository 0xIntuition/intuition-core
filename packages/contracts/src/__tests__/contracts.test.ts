import { describe, expect, test } from 'bun:test';
import {
	MultiVaultBytecode,
	MultiVaultLinkReferences,
	MultiVaultMigrationModeBytecode,
	MultiVaultMigrationModeLinkReferences,
} from '@0xintuition/contracts-v2/bytecodes';
import { isHex, keccak256, zeroAddress } from 'viem';

import { AtomWardenAbi, MultiVaultAbi, WrappedTrustAbi } from '../abis';
import { CHAIN_IDS, INTUITION_SEPOLIA, parseDevnetState } from '../addresses';
import { linkMultiVaultLibraryBytecode } from '../deploy/system';
import {
	MultiVaultSizeFitArtifact,
	TransparentUpgradeableProxyArtifact,
	UpgradeableBeaconArtifact,
} from '../vendored';

describe('abis', () => {
	test('MultiVault ABI carries the seven indexer-critical events', () => {
		const events = new Set<string>(
			MultiVaultAbi.filter((item) => item.type === 'event').map((item) => item.name)
		);
		for (const required of [
			'AtomCreated',
			'AtomContextRegistered',
			'TripleCreated',
			'Deposited',
			'Redeemed',
			'SharePriceChanged',
			'ProtocolFeeAccrued',
		]) {
			expect(events).toContain(required);
		}
	});

	test('MultiVault ABI carries URI-aware atom APIs', () => {
		const functions = new Set<string>(
			MultiVaultAbi.filter((item) => item.type === 'function').map((item) => item.name)
		);

		expect(functions).toContain('createAtomsWithUris');
		expect(functions).toContain('getAtomUriConfig');
	});

	test('published protocol ABIs are surfaced', () => {
		const atomWardenInitialize = AtomWardenAbi.find(
			(i) => i.type === 'function' && i.name === 'initialize'
		);
		expect(
			atomWardenInitialize && 'inputs' in atomWardenInitialize ? atomWardenInitialize.inputs : []
		).toHaveLength(9);
		expect(WrappedTrustAbi.some((i) => i.type === 'function' && i.name === 'deposit')).toBe(true);
	});
});

describe('vendored artifacts', () => {
	const artifacts = [TransparentUpgradeableProxyArtifact, UpgradeableBeaconArtifact];

	test('every artifact has creation bytecode and a non-empty ABI', () => {
		for (const artifact of artifacts) {
			expect(isHex(artifact.bytecode)).toBe(true);
			expect(artifact.bytecode.length).toBeGreaterThan(100);
			expect(artifact.abi.length).toBeGreaterThan(0);
		}
	});

	test('size-fit MultiVault creation code fits under the EIP-170 ballpark', () => {
		const linked = linkMultiVaultLibraryBytecode(
			MultiVaultSizeFitArtifact.bytecode,
			MultiVaultLinkReferences,
			zeroAddress
		);
		expect(isHex(linked)).toBe(true);
		// Creation is slightly larger than runtime; the exact 20,913 B runtime is
		// asserted by the regeneration script before it writes the artifact.
		expect((linked.length - 2) / 2).toBeLessThan(24_576);
	});

	test('deployer links every MultiVault implementation path', () => {
		const cases = [
			[MultiVaultBytecode, MultiVaultLinkReferences],
			[MultiVaultMigrationModeBytecode, MultiVaultMigrationModeLinkReferences],
			[MultiVaultSizeFitArtifact.bytecode, MultiVaultLinkReferences],
		] as const;

		for (const [bytecode, references] of cases) {
			const linked = linkMultiVaultLibraryBytecode(bytecode, references, zeroAddress);
			expect(isHex(linked)).toBe(true);
			expect(linked).not.toContain('__$');
		}
	});

	test('bytecode is stable (guards accidental vendored edits)', () => {
		// Regenerate deliberately with scripts/regen-vendored.sh, then update
		// these pins (compiled from @0xintuition/contracts-v2@1.1.0-alpha.1 + OZ 5.4.0).
		const hashes = Object.fromEntries(
			artifacts.map((artifact) => [artifact.contractName, keccak256(artifact.bytecode)])
		);
		hashes.MultiVault = keccak256(
			linkMultiVaultLibraryBytecode(
				MultiVaultSizeFitArtifact.bytecode,
				MultiVaultLinkReferences,
				zeroAddress
			)
		);
		expect(hashes).toEqual({
			TransparentUpgradeableProxy:
				'0x24a1dc4b18e0740872e78682f81be920c06d8625cd543aefc3d65150ae7c9203',
			UpgradeableBeacon: '0xd294f3707414f1a846cac6ca25db062b4dd427de5f5eabe04398182bd8f587bd',
			MultiVault: '0x0a3d88148c3d643984b26d0f4dc03273bad3c8f16e99e0ddde326ee22a1bce16',
		});
	});
});

describe('addresses', () => {
	test('testnet entry matches the documented deployment', () => {
		expect(INTUITION_SEPOLIA.chainId).toBe(CHAIN_IDS.intuitionSepolia);
		expect(INTUITION_SEPOLIA.MultiVault).toBe('0xeBc49d356B7f64D888130D85CC6D17114a6843ec');
	});

	test('parseDevnetState accepts a valid state file and rejects junk', () => {
		const valid = JSON.stringify({
			chainId: 31337,
			MultiVault: '0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f',
			deployBlock: 25,
		});
		expect(parseDevnetState(valid).MultiVault).toBe('0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f');
		expect(() => parseDevnetState(JSON.stringify({ chainId: 1 }))).toThrow(
			'expected chainId 31337'
		);
		expect(() => parseDevnetState(JSON.stringify({ chainId: 31337 }))).toThrow(
			'missing MultiVault'
		);
	});
});
