import { describe, expect, test } from 'bun:test';
import { statusTargets } from './service-status';

describe('service status targets', () => {
	test('probes the configured API and excludes the inactive indexing tier', () => {
		const targets = statusTargets({ apiUrl: 'http://localhost:3001' });
		expect(targets.find((target) => target.name === 'api')?.url).toBe(
			'http://localhost:3001/health'
		);
		expect(targets.map((target) => target.name)).not.toContain('indexer');
		expect(targets.map((target) => target.name)).toContain('worker-classification');
	});

	test('includes indexing probes only when enabled', () => {
		const targets = statusTargets({ apiUrl: 'http://localhost:3001', indexingEnabled: true });
		expect(targets.map((target) => target.name)).toContain('indexer');
		expect(targets.map((target) => target.name)).toContain('projections');
	});

	test('explicit overrides replace defaults and preserve equals signs in URLs', () => {
		expect(
			statusTargets({
				apiUrl: 'http://localhost:3001',
				override: ' api=https://node.example/health?probe=ready , , invalid, worker= ',
			})
		).toEqual([{ name: 'api', url: 'https://node.example/health?probe=ready' }]);
	});
});
