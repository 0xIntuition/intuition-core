import type { AtomClassificationPlugin } from '../../src/plugins';
import {
	type DefaultClassificationPresetOptions,
	defaultClassificationPreset,
} from '../../src/presets';

export function createDefaultTestPlugins(
	options: DefaultClassificationPresetOptions = {}
): AtomClassificationPlugin[] {
	return defaultClassificationPreset({
		...options,
		imdbPluginOptions: {
			credentials: { tmdb: { apiKey: 'fixture-key' } },
			fetch: async () => ({
				ok: true,
				status: 200,
				text: async () =>
					JSON.stringify({
						movie_results: [{ id: 603, title: 'The Matrix', release_date: '1999-03-30' }],
						tv_results: [],
					}),
			}),
			...(options.imdbPluginOptions ?? {}),
		},
		githubPluginOptions: {
			useDefaultDomainApiAdapter: false,
			...(options.githubPluginOptions ?? {}),
		},
		xPluginOptions: {
			useDefaultDomainApiAdapter: false,
			useDefaultPublicMetadataAdapter: false,
			useDefaultOpenGraphAdapter: false,
			...(options.xPluginOptions ?? {}),
		},
		youtubePluginOptions: {
			useDefaultOEmbedAdapter: false,
			...(options.youtubePluginOptions ?? {}),
		},
	});
}
