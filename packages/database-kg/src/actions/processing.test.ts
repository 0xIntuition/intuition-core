import { describe, expect, test } from 'bun:test';

import {
	completeNodeEnrichmentStageWithArtifacts,
	completeNodeProcessingStage,
} from './processing';
import type { KgActionDb } from './types';

type CapturedPatch = Record<string, unknown>;

function capturingDb() {
	let patch: CapturedPatch | undefined;
	const db = {
		update() {
			return {
				set(value: CapturedPatch) {
					patch = value;
					return {
						where() {
							return {
								async returning() {
									return [{ id: `0x${'11'.repeat(32)}` }];
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;

	return { db, getPatch: () => patch };
}

describe('node processing IID promotion', () => {
	test('writes raw type and canonical IID in the guarded parse completion patch', async () => {
		const capture = capturingDb();
		const iid = 'int:isrc:USQX91300108';

		await completeNodeProcessingStage(capture.db, {
			stage: 'parse',
			nodeId: `0x${'11'.repeat(32)}`,
			runId: 'parse-run',
			data: { kind: 'iid' },
			promotedFields: { rawType: 'iid', iid },
		});

		expect(capture.getPatch()).toMatchObject({
			parseStatus: 'completed',
			parseResult: { kind: 'iid' },
			rawType: 'iid',
			iid,
		});
	});

	test('does not clear IID fields when a legacy parse omits promotions', async () => {
		const capture = capturingDb();

		await completeNodeProcessingStage(capture.db, {
			stage: 'parse',
			nodeId: `0x${'22'.repeat(32)}`,
			runId: 'legacy-parse-run',
			data: { kind: 'plain_string' },
		});

		const patch = capture.getPatch();
		expect(patch).toBeDefined();
		expect(Object.hasOwn(patch ?? {}, 'rawType')).toBe(false);
		expect(Object.hasOwn(patch ?? {}, 'iid')).toBe(false);
	});
});

describe('enrichment completion transaction', () => {
	test('persists artifacts, diagnostics, and promoted fields in one guarded transaction', async () => {
		const nodeId = `0x${'33'.repeat(32)}`;
		const events: Array<{ kind: string; value?: unknown }> = [];
		let updateCount = 0;
		const tx = {
			update() {
				updateCount += 1;
				return {
					set(value: CapturedPatch) {
						events.push({ kind: updateCount === 1 ? 'lock' : 'complete', value });
						return {
							where() {
								return {
									async returning() {
										return [{ id: nodeId }];
									},
								};
							},
						};
					},
				};
			},
			select() {
				return {
					from() {
						return {
							where() {
								return {
									async limit() {
										return [];
									},
								};
							},
						};
					},
				};
			},
			insert() {
				return {
					values(value: unknown) {
						events.push({ kind: 'artifact', value });
						return {
							async onConflictDoUpdate() {},
						};
					},
				};
			},
		} as unknown as KgActionDb;
		const db = {
			async transaction<T>(run: (transaction: KgActionDb) => Promise<T>): Promise<T> {
				events.push({ kind: 'begin' });
				const result = await run(tx);
				events.push({ kind: 'commit' });
				return result;
			},
		} as unknown as KgActionDb;
		const errors = [
			{
				pluginId: 'secondary-provider',
				code: 'upstream_error',
				message: 'partial failure',
				retriable: true,
			},
		];
		const skipped = [{ pluginId: 'unused-provider', reason: 'not applicable' }];

		await completeNodeEnrichmentStageWithArtifacts(db, {
			nodeId,
			runId: 'enrichment-run',
			artifactVersion: 'v1',
			artifacts: [
				{
					artifactKind: 'opengraph',
					data: { title: 'Resolved title' },
					meta: { provider: 'fixture' },
				},
			],
			errors,
			skipped,
			promotedFields: {
				dataResolved: { name: 'Resolved title' },
				searchText: 'Resolved title',
			},
		});

		expect(events.map((event) => event.kind)).toEqual([
			'begin',
			'lock',
			'artifact',
			'complete',
			'commit',
		]);
		const artifact = events.find((event) => event.kind === 'artifact')?.value as {
			data?: { errors?: unknown; skipped?: unknown };
		};
		expect(artifact.data?.errors).toEqual(errors);
		expect(artifact.data?.skipped).toEqual(skipped);
		expect(events.find((event) => event.kind === 'complete')?.value).toMatchObject({
			enrichmentStatus: 'completed',
			dataResolved: { name: 'Resolved title' },
			searchText: 'Resolved title',
		});
	});
});

describe('classification identity completion transaction', () => {
	test('uses returned primary, guards failed claims and propagates alias failure for rollback', async () => {
		const { completeNodeClassificationWithIdentity } = await import('./processing');
		const nodeId = `0x${'44'.repeat(32)}`;
		const events: string[] = [];
		let claimed = true;
		let failAlias = false;
		const tx = {
			update() {
				return {
					set() {
						return {
							where() {
								return {
									async returning() {
										events.push('update');
										return claimed ? [{ id: nodeId, iid: 'int:isbn:current' }] : [];
									},
								};
							},
						};
					},
				};
			},
			delete() {
				return {
					async where() {
						events.push('delete');
						if (failAlias) throw new Error('alias failure');
					},
				};
			},
			insert() {
				throw new Error('same-scheme rows must not be inserted');
			},
		} as unknown as KgActionDb;
		const db = {
			async transaction<T>(run: (tx: KgActionDb) => Promise<T>) {
				events.push('begin');
				try {
					const result = await run(tx);
					events.push('commit');
					return result;
				} catch (error) {
					events.push('rollback');
					throw error;
				}
			},
		} as unknown as KgActionDb;
		const input = {
			stage: 'classification' as const,
			nodeId,
			runId: 'run',
			identityRungs: {
				rungs: [{ rung: 'isbn', value: 'other', iid: 'int:isbn:other', aliasOnly: false }],
				provenance: { producer: 'fixture', version: '1' },
			},
		};
		await completeNodeClassificationWithIdentity(db, input);
		expect(events).toEqual(['begin', 'update', 'delete', 'commit']);
		events.length = 0;
		claimed = false;
		await expect(completeNodeClassificationWithIdentity(db, input)).rejects.toThrow('not claimed');
		expect(events).toEqual(['begin', 'update', 'rollback']);
		events.length = 0;
		claimed = true;
		failAlias = true;
		await expect(completeNodeClassificationWithIdentity(db, input)).rejects.toThrow(
			'alias failure'
		);
		expect(events).toEqual(['begin', 'update', 'delete', 'rollback']);
	});
});

test.each([
	{ rungs: {} },
	{ rungs: [{ rung: 'isbn', iid: 42 }] },
	undefined,
	{
		rungs: [{ rung: 'isbn', value: 'X', iid: 42, aliasOnly: false }],
		provenance: { producer: 'fixture', version: '1' },
	},
])('malformed or absent projection %j completes without touching seeded aliases', async (identityRungs) => {
	const { completeNodeClassificationWithIdentity } = await import('./processing');
	const nodeId = `0x${'55'.repeat(32)}`;
	const events: string[] = [];
	const aliases = ['int:gtin:existing'];
	const tx = {
		update() {
			const query = {
				set: () => query,
				where: () => query,
				async returning() {
					events.push('update');
					return [{ id: nodeId, iid: null }];
				},
			};
			return query;
		},
		delete() {
			return {
				async where() {
					events.push('delete');
					aliases.length = 0;
				},
			};
		},
	} as unknown as KgActionDb;
	const db = {
		async transaction<T>(run: (tx: KgActionDb) => Promise<T>) {
			events.push('begin');
			const result = await run(tx);
			events.push('commit');
			return result;
		},
	} as unknown as KgActionDb;
	await completeNodeClassificationWithIdentity(db, {
		stage: 'classification',
		nodeId,
		runId: 'run',
		identityRungs,
	});
	expect(events).toEqual(['begin', 'update', 'commit']);
	expect(aliases).toEqual(['int:gtin:existing']);
	events.length = 0;
	await completeNodeClassificationWithIdentity(db, {
		stage: 'classification',
		nodeId,
		runId: 'run',
		identityRungs: { rungs: [], provenance: { producer: 'fixture', version: '1' } },
	});
	expect(events).toEqual(['begin', 'update', 'delete', 'commit']);
	expect(aliases).toEqual([]);
});
