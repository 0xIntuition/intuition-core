import { describe, expect, test } from 'bun:test';
import { loadWorkerConfig } from './config';

describe('worker config', () => {
	test('defaults processing scope to full', () => {
		expect(loadWorkerConfig({}).processingScope).toBe('full');
	});

	test('accepts music and podcast processing scope presets', () => {
		expect(
			loadWorkerConfig({
				WORKERS_PROCESSING_SCOPE: 'music-and-podcasts',
			}).processingScope
		).toBe('music-and-podcasts');
	});

	test('rejects unknown processing scope values', () => {
		expect(() =>
			loadWorkerConfig({
				WORKERS_PROCESSING_SCOPE: 'movies',
			})
		).toThrow(/WORKERS_PROCESSING_SCOPE/);
	});
});
