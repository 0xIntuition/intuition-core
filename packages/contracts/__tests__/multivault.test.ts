import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMultiVaultAbiJson, MULTIVAULT_RINDEXER_EVENTS, MultiVaultAbi } from '../src/multivault';

const repoRoot = resolve(import.meta.dir, '../../..');
const rindexerAbiPath = resolve(repoRoot, 'crates/rindexer-ingestion/abi/MultiVault.json');

const isNamedAbiItem = (
	item: (typeof MultiVaultAbi)[number]
): item is Extract<(typeof MultiVaultAbi)[number], { name: string; type: string }> =>
	'name' in item && typeof item.name === 'string';

describe('MultiVault contract artifacts', () => {
	it('exports the functions and events consumed by the backend', () => {
		const namesByType = MultiVaultAbi.reduce<Record<string, Set<string>>>((acc, item) => {
			if (!isNamedAbiItem(item)) {
				return acc;
			}

			acc[item.type] ??= new Set<string>();
			acc[item.type]?.add(item.name);
			return acc;
		}, {});

		expect(namesByType.function?.has('createAtoms')).toBe(true);
		expect(namesByType.function?.has('createTriples')).toBe(true);
		expect(namesByType.event?.has('AtomCreated')).toBe(true);
		expect(namesByType.event?.has('TripleCreated')).toBe(true);

		for (const eventName of MULTIVAULT_RINDEXER_EVENTS) {
			expect(namesByType.event?.has(eventName)).toBe(true);
		}
	});

	it('keeps the rindexer ABI generated from the NPM package', () => {
		const generatedAbi = `${getMultiVaultAbiJson()}\n`;
		const checkedInAbi = readFileSync(rindexerAbiPath, 'utf8');

		expect(checkedInAbi).toBe(generatedAbi);
	});
});
