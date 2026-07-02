import { describe, expect, it } from 'bun:test';
import { createClientEngine } from '../src/client';
import { createServerEngine } from '../src/server';
import { createDefaultTestPlugins } from './helpers/default-plugins';

describe('@0xintuition/atom-classification scaffold', () => {
	it('returns placeholder result for client runtime', async () => {
		const engine = createClientEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'https://example.com',
			mode: 'client-only',
			classificationSessionId: 'test-session-client',
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe('complete');
		expect(result.contractVersion).toBe('cpkg-02');
		expect(result.runtime).toBe('client');
		expect(result.mode).toBe('client-only');
		expect(result.classificationSessionId).toBe('test-session-client');
		expect(result.policy.runServerEnrichment).toBe(false);
		expect(result.policy.requestedServerTiers).toEqual([]);
		expect(result.classification?.type).toBe('url');
		expect(result.classification?.domain).toBe('web');
		expect(result.resolved?.resolverId).toBe('default-url-resolver');
	});

	it('returns placeholder result for server runtime', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'ethereum:0x1111111111111111111111111111111111111111',
			mode: 'server-only',
			classificationSessionId: 'test-session-server',
		});

		expect(result.ok).toBe(true);
		expect(result.status).toBe('complete');
		expect(result.contractVersion).toBe('cpkg-02');
		expect(result.runtime).toBe('server');
		expect(result.mode).toBe('server-only');
		expect(result.classificationSessionId).toBe('test-session-server');
		expect(result.policy.runClientClassification).toBe(false);
		expect(result.policy.requestedServerTiers).toEqual([2, 3]);
		expect(result.classification?.domain).toBe('ethereum');
		expect(result.resolved?.resolverId).toBe('etherscan-resolver');
	});

	it('maps spotify tracks to MusicRecording in client-only deterministic fallback', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C?si=21240713411d486b',
			mode: 'client-only',
			classificationSessionId: 'test-session-spotify-client-only',
		});

		expect(result.classification?.domain).toBe('spotify');
		expect(result.classification?.subtype).toBe('track');
		expect(result.resolved?.resolverId).toBe('spotify-resolver');
		const atom = result.resolved?.atoms[0];
		expect(atom).toMatchObject({
			schemaType: 'MusicRecording',
			category: 'song',
			canonicalId: 'spotify:track:0ojU4I7FDbtkvh4lnkPI1C',
			sameAs: ['https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C'],
			source: 'platform-v0:generic',
		});
		expect(atom?.data).toMatchObject({
			'@context': 'https://schema.org/',
			'@type': 'MusicRecording',
			name: 'Spotify Track 0ojU4I7FDbtkvh4lnkPI1C',
			sameAs: ['https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C'],
		});
		expect(result.resolved?.classifications[0]?.type).toBe('MusicRecording');
		expect(result.resolved?.classifications[0]?.meta.pluginId).toBe('spotify');
		expect(atom?.metadata).toMatchObject({
			platform: 'spotify',
			subtype: 'track',
			fallbackStage: 'generic',
			fallbackChain: ['oembed', 'opengraph', 'generic'],
		});
	});
});
