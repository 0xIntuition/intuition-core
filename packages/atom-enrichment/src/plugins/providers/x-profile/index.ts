import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getRequestUrl, getXTarget } from '../__shared__/request';
import { xUserLookupResponseSchema } from './external';
import { xProfileDataSchema } from './schema';

type CreateXProfilePluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	token?: string;
};

const X_API_BASE_URL = 'https://api.x.com/2';

export function createXProfilePlugin(options: CreateXProfilePluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'x-profile',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['x-profile'],
		priority: options.priority ?? 43,
		TTL: options.TTL ?? 300,

		supports(request: EnrichmentRequest) {
			const target = resolveXProfileTarget(request);
			return target?.kind === 'profile';
		},

		async enrich(request, ctx) {
			const target = resolveXProfileTarget(request);
			if (!target || target.kind !== 'profile') {
				return [];
			}

			if (!options.token) {
				throw new Error(
					'Authentication required for x-profile enrichment: X_BEARER_TOKEN is missing.'
				);
			}

			const payload = await fetchJsonWithSchema(
				fetcher,
				buildXUserLookupUrl(target.handle),
				xUserLookupResponseSchema,
				{
					signal: ctx.signal,
					headers: {
						authorization: `Bearer ${options.token}`,
					},
				}
			);
			const user = toRecordMaybe(payload.data);
			if (!user) {
				return [];
			}

			const username =
				normalizeXHandle(toStringMaybe(user.username) ?? target.handle) ?? target.handle;
			const sourceUrl = `https://x.com/${username}`;
			const metrics = toRecordMaybe(user.public_metrics) ?? {};

			return [
				{
					artifact_type: 'x-profile',
					data: xProfileDataSchema.parse({
						username,
						name: toStringMaybe(user.name),
						bio: toStringMaybe(user.description),
						profileBannerUrl: toStringMaybe(user.profile_banner_url),
						profileImageUrl: upgradeXAvatarUrl(toStringMaybe(user.profile_image_url)),
						followers: toNumberMaybe(metrics.followers_count),
						following: toNumberMaybe(metrics.following_count),
						tweetCount: toNumberMaybe(metrics.tweet_count),
						verified: toBooleanMaybe(user.verified),
						joinedAt: toStringMaybe(user.created_at),
					}),
					meta: {
						pluginId: 'x-profile',
						provider: 'x-profile',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function resolveXProfileTarget(
	request: EnrichmentRequest
): ReturnType<typeof getXTarget> | undefined {
	const explicitTarget = getXTarget(request);
	if (explicitTarget) {
		return explicitTarget;
	}

	const url = getRequestUrl(request);
	if (!url) {
		return undefined;
	}

	return parseXTargetFromUrl(url);
}

function buildXUserLookupUrl(handle: string): string {
	const params = new URLSearchParams({
		'user.fields':
			'created_at,description,name,profile_banner_url,profile_image_url,public_metrics,username,verified',
	});
	return `${X_API_BASE_URL}/users/by/username/${encodeURIComponent(handle)}?${params.toString()}`;
}

function parseXTargetFromUrl(url: string): ReturnType<typeof getXTarget> | undefined {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (
			host !== 'x.com' &&
			host !== 'www.x.com' &&
			host !== 'twitter.com' &&
			host !== 'www.twitter.com'
		) {
			return undefined;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		const handle = normalizeXHandle(segments[0]);
		if (!handle) {
			return undefined;
		}

		if (segments[1] === 'status' && segments[2]) {
			return {
				kind: 'post',
				handle,
				postId: segments[2],
				canonicalUrl: `https://x.com/${handle}/status/${segments[2]}`,
			};
		}

		return {
			kind: 'profile',
			handle,
			canonicalUrl: `https://x.com/${handle}`,
		};
	} catch {
		return undefined;
	}
}

function normalizeXHandle(handle: string | undefined): string | undefined {
	const normalized = toStringMaybe(handle)?.replace(/^@+/, '');
	return normalized && normalized.length > 0 ? normalized : undefined;
}

function upgradeXAvatarUrl(url: string | undefined): string | undefined {
	if (!url) {
		return undefined;
	}

	return url.replace(/_(normal|bigger|mini)(\.(jpg|jpeg|png|webp))$/i, '_400x400$2');
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toNumberMaybe(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const normalized = Number(value);
		return Number.isFinite(normalized) ? normalized : undefined;
	}

	return undefined;
}

function toBooleanMaybe(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}
