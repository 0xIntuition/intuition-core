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
