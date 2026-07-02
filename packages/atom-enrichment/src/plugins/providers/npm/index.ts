import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import {
	getIdentifier,
	getRequestName,
	getRequestUrl,
	parseNpmPackageFromUrl,
} from '../__shared__/request';
import { npmDownloadsResponseSchema, npmRegistryResponseSchema } from './external';
import { npmPackageDataSchema } from './schema';

type CreateNpmPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
};

type NpmRegistryResponse = {
	name?: string;
	'dist-tags'?: { latest?: string };
	versions?: Record<string, NpmVersionInfo>;
};

type NpmVersionInfo = {
	description?: string;
	keywords?: string[];
	license?: string;
	homepage?: string;
	repository?: string | { url?: string };
	author?: string | { name?: string };
	maintainers?: Array<string | { name?: string }>;
};

type NpmDownloadsResponse = {
	downloads?: number;
};

export function createNpmPlugin(options: CreateNpmPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'npm',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['npm-package'],
		priority: options.priority ?? 40,
		TTL: options.TTL ?? 3_600,

		supports(request: EnrichmentRequest) {
			return !!resolvePackageName(request);
		},

		async enrich(request, ctx) {
			const packageName = resolvePackageName(request);
			if (!packageName) {
				return [];
			}

			const encodedName = encodeURIComponent(packageName);
			const registryUrl = `https://registry.npmjs.org/${encodedName}`;
			const registryPayload = await fetchJsonWithSchema(
				fetcher,
				registryUrl,
				npmRegistryResponseSchema,
				{
					signal: ctx.signal,
				}
			);

			const latestVersion = registryPayload['dist-tags']?.latest;
			const latestInfo =
				(latestVersion && registryPayload.versions?.[latestVersion]) ||
				firstVersionInfo(registryPayload.versions);

			let weeklyDownloads: number | undefined;
			try {
				const downloadsPayload = await fetchJsonWithSchema(
					fetcher,
					`https://api.npmjs.org/downloads/point/last-week/${encodedName}`,
					npmDownloadsResponseSchema,
					{ signal: ctx.signal }
				);
				weeklyDownloads = downloadsPayload.downloads;
			} catch {
				weeklyDownloads = undefined;
			}

			return [
				{
					artifact_type: 'npm-package',
					data: npmPackageDataSchema.parse({
						name: registryPayload.name ?? packageName,
						version: latestVersion ?? firstVersionKey(registryPayload.versions) ?? '0.0.0',
						description: latestInfo?.description,
						keywords: latestInfo?.keywords,
						license: latestInfo?.license,
						homepage: normalizeUrl(latestInfo?.homepage),
						repository: normalizeRepository(latestInfo?.repository),
						weeklyDownloads,
						author: normalizeAuthor(latestInfo?.author),
						maintainers: normalizeMaintainers(latestInfo?.maintainers),
					}),
					meta: {
						pluginId: 'npm',
						provider: 'npm',
						fetchedAt: ctx.now(),
						sourceUrl: `https://www.npmjs.com/package/${packageName}`,
					},
				},
			];
		},
	});
}

function resolvePackageName(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'npm', 'npm-package', 'package');
	if (identifier) {
		return identifier;
	}

	const requestUrl = getRequestUrl(request);
	if (requestUrl) {
		const fromUrl = parseNpmPackageFromUrl(requestUrl);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (!name) {
		return undefined;
	}

	if (name.includes(' ')) {
		return undefined;
	}

	return name;
}

function firstVersionInfo(
	versions: Record<string, NpmVersionInfo> | undefined
): NpmVersionInfo | undefined {
	if (!versions) {
		return undefined;
	}

	const firstKey = Object.keys(versions).sort((left, right) => right.localeCompare(left))[0];
	if (!firstKey) {
		return undefined;
	}

	return versions[firstKey];
}

function firstVersionKey(versions: Record<string, NpmVersionInfo> | undefined): string | undefined {
	if (!versions) {
		return undefined;
	}

	return Object.keys(versions).sort((left, right) => right.localeCompare(left))[0];
}

function normalizeRepository(
	repository: string | { url?: string } | undefined
): string | undefined {
	if (!repository) {
		return undefined;
	}

	if (typeof repository === 'string') {
		return repository;
	}

	return repository.url;
}

function normalizeAuthor(author: string | { name?: string } | undefined): string | undefined {
	if (!author) {
		return undefined;
	}

	if (typeof author === 'string') {
		return author;
	}

	return author.name;
}

function normalizeMaintainers(
	maintainers: Array<string | { name?: string }> | undefined
): string[] | undefined {
	if (!maintainers) {
		return undefined;
	}

	const normalized = maintainers
		.map((entry) => (typeof entry === 'string' ? entry : entry.name))
		.filter((value): value is string => typeof value === 'string' && value.length > 0);

	return normalized.length > 0 ? normalized : undefined;
}

function normalizeUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	try {
		new URL(value);
		return value;
	} catch {
		return undefined;
	}
}
