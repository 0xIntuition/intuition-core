import { describe, expect, test } from 'bun:test';

import { ensureNodeWithCreation } from './nodes';
import type { EnsureNodeInput, KgActionDb } from './types';

function captureNodeInsert() {
	let inserted: Record<string, unknown> | undefined;
	const db = {
		insert() {
			return {
				values(value: Record<string, unknown>) {
					inserted = value;
					return {
						onConflictDoNothing() {
							return {
								async returning() {
									return [{ id: value.id }];
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;

	return { db, getInserted: () => inserted };
}

function nodeInput(overrides: Partial<EnsureNodeInput> = {}): EnsureNodeInput {
	return {
		id: `0x${'44'.repeat(32)}`,
		rawType: 'string',
		classificationType: 'Unknown',
		data: 'opaque atom input',
		...overrides,
	};
}

describe('node search defaults', () => {
	test('does not use opaque input or a raw IID as implicit search text', async () => {
		for (const input of [nodeInput(), nodeInput({ rawType: 'iid', data: 'opaque IID value' })]) {
			const capture = captureNodeInsert();
			await ensureNodeWithCreation(capture.db, input);
			expect(capture.getInserted()?.searchText).toBe('');
		}
	});

	test('preserves an explicit search projection', async () => {
		const capture = captureNodeInsert();
		await ensureNodeWithCreation(capture.db, nodeInput({ searchText: 'Resolved display value' }));
		expect(capture.getInserted()?.searchText).toBe('Resolved display value');
	});
});
