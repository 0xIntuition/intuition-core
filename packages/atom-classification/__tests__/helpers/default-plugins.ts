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
