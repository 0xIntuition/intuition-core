import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { getDomainFromUrl, getRequestUrl } from '../__shared__/request';

type CreateFaviconPluginOptions = {
	priority?: number;
	TTL?: number;
	size?: number;
};

export function createFaviconPlugin(options: CreateFaviconPluginOptions = {}): EnrichmentPlugin {
	const iconSize = options.size ?? 128;

	return defineEnrichmentPlugin({
		id: 'favicon',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['favicon'],
		priority: options.priority ?? 15,
		TTL: options.TTL ?? 86_400,

		supports(request: EnrichmentRequest) {
			const url = getRequestUrl(request);
			if (!url) {
				return false;
			}

			return !!getDomainFromUrl(url);
		},

		async enrich(request, ctx) {
			const url = getRequestUrl(request);
			if (!url) {
				return [];
			}

			const domain = getDomainFromUrl(url);
			if (!domain) {
				return [];
			}

			const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${iconSize}`;

			return [
				{
					artifact_type: 'favicon',
					data: {
						url: faviconUrl,
						type: 'image/png',
						sizes: `${iconSize}x${iconSize}`,
					},
					meta: {
						pluginId: 'favicon',
						provider: 'google-s2',
						fetchedAt: ctx.now(),
						sourceUrl: url,
					},
				},
			];
		},
	});
}
