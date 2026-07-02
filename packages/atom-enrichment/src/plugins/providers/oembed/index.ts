import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getRequestUrl } from '../__shared__/request';
import { oembedResponseSchema } from './external';
import { oembedDataSchema } from './schema';

type OEmbedProvider = {
	id: string;
	matcher: RegExp;
	oembedEndpoint: string;
};

type CreateOEmbedPluginOptions = {
	fetch?: FetchLike;
	providers?: OEmbedProvider[];
	priority?: number;
	TTL?: number;
};

type OEmbedResponse = {
	type: 'photo' | 'video' | 'link' | 'rich';
	title?: string;
	author_name?: string;
	author_url?: string;
	provider_name?: string;
	provider_url?: string;
	thumbnail_url?: string;
	thumbnail_width?: number;
	thumbnail_height?: number;
	html?: string;
	width?: number;
	height?: number;
	url?: string;
};

const defaultProviders: OEmbedProvider[] = [
	{
		id: 'youtube',
		matcher: /https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i,
		oembedEndpoint: 'https://www.youtube.com/oembed',
	},
	{
		id: 'vimeo',
		matcher: /https?:\/\/(?:www\.)?vimeo\.com\//i,
		oembedEndpoint: 'https://vimeo.com/api/oembed.json',
	},
	{
		id: 'twitter',
		matcher: /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i,
		oembedEndpoint: 'https://publish.twitter.com/oembed',
	},
];

export function createOEmbedPlugin(options: CreateOEmbedPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const providers = options.providers ?? defaultProviders;

	return defineEnrichmentPlugin({
		id: 'oembed',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['oembed'],
		priority: options.priority ?? 20,
		TTL: options.TTL ?? 3_600,

		supports(request: EnrichmentRequest) {
			const url = getRequestUrl(request);
			if (!url) {
				return false;
			}

			return !!resolveProvider(url, providers);
		},

		async enrich(request, ctx) {
			const url = getRequestUrl(request);
			if (!url) {
				return [];
			}

			const provider = resolveProvider(url, providers);
			if (!provider) {
				return [];
			}

			const endpoint = new URL(provider.oembedEndpoint);
			endpoint.searchParams.set('url', url);
			endpoint.searchParams.set('format', 'json');

			const payload = await fetchJsonWithSchema(
				fetcher,
				endpoint.toString(),
				oembedResponseSchema,
				{
					signal: ctx.signal,
				}
			);

			return [
				{
					artifact_type: 'oembed',
					data: oembedDataSchema.parse({
						type: payload.type,
						title: payload.title,
						authorName: payload.author_name,
						authorUrl: payload.author_url,
						providerName: payload.provider_name,
						providerUrl: payload.provider_url,
						thumbnailUrl: payload.thumbnail_url,
						thumbnailWidth: toOptionalNumber(payload.thumbnail_width),
						thumbnailHeight: toOptionalNumber(payload.thumbnail_height),
						html: payload.html,
						width: toOptionalNumber(payload.width),
						height: toOptionalNumber(payload.height),
						url: payload.url,
					}),
					meta: {
						pluginId: 'oembed',
						provider: provider.id,
						fetchedAt: ctx.now(),
						sourceUrl: url,
					},
				},
			];
		},
	});
}

function resolveProvider(url: string, providers: OEmbedProvider[]): OEmbedProvider | undefined {
	return providers.find((provider) => provider.matcher.test(url));
}

function toOptionalNumber(value: number | string | undefined): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}
