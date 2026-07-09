import { describe, expect, test } from 'bun:test';
import { aggregatePipelineStats } from '../src/app';

describe('aggregatePipelineStats', () => {
	test('folds grouped rows into per-stage status counts', () => {
		const stages = aggregatePipelineStats([
			{ parse: 'completed', classification: 'completed', enrichment: 'completed', count: 10 },
			{ parse: 'completed', classification: 'completed', enrichment: 'pending', count: 3 },
			{ parse: 'completed', classification: 'failed', enrichment: 'skipped', count: 2 },
			{ parse: 'pending', classification: 'pending', enrichment: 'pending', count: 5 },
		]);

		expect(stages.parse).toEqual({ completed: 15, pending: 5 });
		expect(stages.classification).toEqual({ completed: 13, failed: 2, pending: 5 });
		expect(stages.enrichment).toEqual({ completed: 10, pending: 8, skipped: 2 });
	});

	test('empty input yields empty stage maps', () => {
		expect(aggregatePipelineStats([])).toEqual({
			parse: {},
			classification: {},
			enrichment: {},
		});
	});
});
