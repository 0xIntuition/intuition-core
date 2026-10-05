import { describe, expect, test } from 'bun:test';
import { loadWorkerConfig } from './config';

describe('worker config', () => {
	test('defaults processing scope to full', () => {
		expect(loadWorkerConfig({}).processingScope).toBe('full');
	});

	test('keeps IID read and resolution paths disabled by default', () => {
		const config = loadWorkerConfig({});
		expect(config.iidReadEnabled).toBe(false);
		expect(config.iidResolutionEnabled).toBe(false);
	});

	test('allows IID read and resolution switches to be enabled independently', () => {
		expect(loadWorkerConfig({ WORKERS_IID_READ_ENABLED: 'true' }).iidReadEnabled).toBe(true);
		expect(loadWorkerConfig({ WORKERS_IID_RESOLUTION_ENABLED: 'true' }).iidResolutionEnabled).toBe(
			true
		);
	});

	test('rejects malformed IID switch values', () => {
		expect(() => loadWorkerConfig({ WORKERS_IID_READ_ENABLED: 'yes' })).toThrow(
			/WORKERS_IID_READ_ENABLED/
		);
		expect(() => loadWorkerConfig({ WORKERS_IID_RESOLUTION_ENABLED: '1' })).toThrow(
			/WORKERS_IID_RESOLUTION_ENABLED/
		);
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
