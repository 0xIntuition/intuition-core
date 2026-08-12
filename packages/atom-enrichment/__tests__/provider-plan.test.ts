import { describe, expect, it } from 'bun:test';
import {
	createAppleMusicPlugin,
	createCoinGeckoPlugin,
	createCrossrefPlugin,
	createEtherscanPlugin,
	createGitHubPlugin,
	createMusicBrainzPlugin,
	createNpmPlugin,
	createOpenLibraryPlugin,
	createPodcastIndexPlugin,
	createSpotifyPlugin,
	createTmdbPlugin,
	createWikidataPlugin,
	createXProfilePlugin,
} from '../src/plugins/providers';
import {
	createIdentifierProviderPlan,
	IID_PROVIDER_CAPABILITIES,
	IID_PROVIDER_SLUGS,
} from '../src/provider-plan';

const REGISTRY_PROVIDER_SLUGS = [
	'apple-music',
	'coingecko',
	'crossref',
	'etherscan',
	'github',
	'musicbrainz',
	'npm',
	'openlibrary',
	'podcast-index',
	'spotify',
	'tmdb',
	'wikidata',
	'x-profile',
] as const;

describe('IID provider capability contract', () => {
	it('is total over the public iid-registry provider vocabulary', () => {
		expect(IID_PROVIDER_SLUGS).toEqual(REGISTRY_PROVIDER_SLUGS);
		expect(Object.keys(IID_PROVIDER_CAPABILITIES).sort()).toEqual(
			[...REGISTRY_PROVIDER_SLUGS].sort()
		);
	});

	it('backs every supported capability with a Core plugin implementation', () => {
		const implemented = new Set(
			[
				createAppleMusicPlugin(),
				createCoinGeckoPlugin(),
				createCrossrefPlugin(),
				createEtherscanPlugin(),
				createGitHubPlugin(),
				createMusicBrainzPlugin(),
				createNpmPlugin(),
				createOpenLibraryPlugin(),
				createPodcastIndexPlugin(),
				createSpotifyPlugin(),
				createTmdbPlugin(),
				createWikidataPlugin(),
				createXProfilePlugin(),
			].map((plugin) => plugin.id)
		);

		for (const capability of Object.values(IID_PROVIDER_CAPABILITIES)) {
			if (capability.status === 'supported') {
				expect(implemented.has(capability.pluginId), capability.pluginId).toBe(true);
			}
		}
	});

	it('preserves the open-first ISRC plan and canonical hint order', () => {
		const plan = createIdentifierProviderPlan({
			providers: ['musicbrainz', 'spotify', 'apple-music'],
			identifiers: { isrc: 'USUM71703861', secondary: 'keep-after-isrc' },
			registeredPluginIds: ['apple-music', 'musicbrainz', 'spotify'],
		});

		expect(plan.complete).toBe(true);
		expect(plan.plugins).toEqual(['musicbrainz', 'spotify', 'apple-music']);
		expect(plan.entries.map((entry) => entry.providerSlug)).toEqual([
			'musicbrainz',
			'spotify',
			'apple-music',
		]);
		expect(Object.keys(plan.identifiers)).toEqual(['isrc', 'secondary']);
		expect(plan.identifiers).toEqual({ isrc: 'USUM71703861', secondary: 'keep-after-isrc' });
	});

	it('marks deployment gaps retryable and unknown or duplicate slugs terminal', () => {
		const plan = createIdentifierProviderPlan({
			providers: ['openlibrary', 'future-books', 'openlibrary'],
			identifiers: { isbn: '9780684832722' },
			registeredPluginIds: [],
		});

		expect(plan.complete).toBe(false);
		expect(plan.plugins).toEqual([]);
		expect(plan.entries).toEqual([
			{
				providerSlug: 'openlibrary',
				pluginId: 'openlibrary',
				ordinal: 0,
				status: 'unavailable',
				disposition: 'retry',
				reason: 'plugin_not_registered',
			},
			{
				providerSlug: 'future-books',
				ordinal: 1,
				status: 'unsupported',
				disposition: 'terminal',
				reason: 'unknown_provider_slug',
			},
			{
				providerSlug: 'openlibrary',
				ordinal: 2,
				status: 'unsupported',
				disposition: 'terminal',
				reason: 'duplicate_provider_slug',
			},
		]);
	});
});
