import { describe, expect, it } from 'bun:test';
import { createServerEngine } from '../src/server';
import { createDefaultTestPlugins } from './helpers/default-plugins';

const SPOTIFY_TRACK_URL = 'https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C';

describe('pluginIds filtering', () => {
	it('uses the selected plugin stack when pluginIds are provided', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});

		const spotifyResult = await engine.classify({
			input: SPOTIFY_TRACK_URL,
			mode: 'progressive',
			pluginIds: ['type-profiles', 'spotify'],
			classificationSessionId: 'plugin-filter-spotify',
		});
		const defaultUrlResult = await engine.classify({
			input: SPOTIFY_TRACK_URL,
			mode: 'progressive',
			pluginIds: ['type-profiles', 'default-url'],
			classificationSessionId: 'plugin-filter-default-url',
		});

		expect(spotifyResult.classification?.domain).toBe('spotify');
		expect(spotifyResult.resolved?.resolverId).toBe('spotify-resolver');
		expect(spotifyResult.debug.requestedPluginIds).toEqual(['spotify', 'type-profiles']);

		expect(defaultUrlResult.classification?.domain).toBe('web');
		expect(defaultUrlResult.resolved?.resolverId).toBe('default-url-resolver');
		expect(defaultUrlResult.debug.requestedPluginIds).toEqual(['default-url', 'type-profiles']);
	});
});
