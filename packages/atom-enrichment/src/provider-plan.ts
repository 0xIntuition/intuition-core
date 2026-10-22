/**
 * Provider-plan boundary for `@0xintuition/iid-registry` output.
 *
 * This package intentionally does not depend on the registry. The IID layer
 * owns parsing/canonicalization and supplies its ordered provider slugs plus
 * canonical identifier hints. This adapter intersects that desired plan with
 * the plugins registered in the current enrichment deployment without ever
 * silently dropping a provider.
 */

/** Mirrored capability vocabulary from iid-registry `PROVIDER_SLUGS`. */
export const IID_PROVIDER_SLUGS = [
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

export type IidProviderSlug = (typeof IID_PROVIDER_SLUGS)[number];

export type IidProviderCapability =
	| {
			pluginId: string;
			status: 'supported';
	  }
	| {
			status: 'unsupported';
			reason: string;
	  };

/**
 * Total compile-time contract: adding a mirrored registry slug requires an
 * explicit Core capability decision before TypeScript will compile.
 */
export const IID_PROVIDER_CAPABILITIES: Readonly<Record<IidProviderSlug, IidProviderCapability>> = {
	'apple-music': { pluginId: 'apple-music', status: 'supported' },
	coingecko: { pluginId: 'coingecko', status: 'supported' },
	crossref: { pluginId: 'crossref', status: 'supported' },
	etherscan: { pluginId: 'etherscan', status: 'supported' },
	github: { pluginId: 'github', status: 'supported' },
	musicbrainz: { pluginId: 'musicbrainz', status: 'supported' },
	npm: { pluginId: 'npm', status: 'supported' },
	openlibrary: { pluginId: 'openlibrary', status: 'supported' },
	'podcast-index': { pluginId: 'podcast-index', status: 'supported' },
	spotify: { pluginId: 'spotify', status: 'supported' },
	tmdb: { pluginId: 'tmdb', status: 'supported' },
	wikidata: { pluginId: 'wikidata', status: 'supported' },
	'x-profile': { pluginId: 'x-profile', status: 'supported' },
};

export type ScheduledProviderPlanEntry = {
	providerSlug: IidProviderSlug;
	pluginId: string;
	ordinal: number;
	status: 'scheduled';
	disposition: 'execute';
};

export type UnavailableProviderPlanEntry = {
	providerSlug: IidProviderSlug;
	pluginId: string;
	ordinal: number;
	status: 'unavailable';
	disposition: 'retry';
	reason: 'plugin_not_registered';
};

export type UnsupportedProviderPlanEntry = {
	providerSlug: string;
	ordinal: number;
	status: 'unsupported';
	disposition: 'terminal';
	reason: 'unknown_provider_slug' | 'duplicate_provider_slug' | 'provider_not_implemented';
	detail?: string;
};

export type IdentifierProviderPlanEntry =
	| ScheduledProviderPlanEntry
	| UnavailableProviderPlanEntry
	| UnsupportedProviderPlanEntry;

export type IdentifierProviderPlan = {
	/** Canonical hints, copied in caller-provided insertion order. */
	identifiers: Record<string, string>;
	/** One entry for every requested provider, in registry order. */
	entries: IdentifierProviderPlanEntry[];
	/** Ordered allowlist suitable for `EnrichmentRequest.plugins`. */
	plugins: string[];
	complete: boolean;
};

export type CreateIdentifierProviderPlanInput = {
	providers: readonly string[];
	identifiers: Readonly<Record<string, string>>;
	registeredPluginIds: Iterable<string>;
};

export function createIdentifierProviderPlan(
	input: CreateIdentifierProviderPlanInput
): IdentifierProviderPlan {
	const registered = new Set(input.registeredPluginIds);
	const seen = new Set<string>();
	const entries: IdentifierProviderPlanEntry[] = [];
	const plugins: string[] = [];

	for (const [ordinal, providerSlug] of input.providers.entries()) {
		if (seen.has(providerSlug)) {
			entries.push({
				providerSlug,
				ordinal,
				status: 'unsupported',
				disposition: 'terminal',
				reason: 'duplicate_provider_slug',
			});
			continue;
		}
		seen.add(providerSlug);

		if (!isIidProviderSlug(providerSlug)) {
			entries.push({
				providerSlug,
				ordinal,
				status: 'unsupported',
				disposition: 'terminal',
				reason: 'unknown_provider_slug',
			});
			continue;
		}

		const capability: IidProviderCapability = IID_PROVIDER_CAPABILITIES[providerSlug];
		if (capability.status === 'unsupported') {
			entries.push({
				providerSlug,
				ordinal,
				status: 'unsupported',
				disposition: 'terminal',
				reason: 'provider_not_implemented',
				detail: capability.reason,
			});
			continue;
		}

		const pluginId = capability.pluginId;
		if (!registered.has(pluginId)) {
			entries.push({
				providerSlug,
				pluginId,
				ordinal,
				status: 'unavailable',
				disposition: 'retry',
				reason: 'plugin_not_registered',
			});
			continue;
		}

		entries.push({
			providerSlug,
			pluginId,
			ordinal,
			status: 'scheduled',
			disposition: 'execute',
		});
		plugins.push(pluginId);
	}

	return {
		identifiers: copyCanonicalHints(input.identifiers),
		entries,
		plugins,
		complete: entries.every((entry) => entry.status === 'scheduled'),
	};
}

function isIidProviderSlug(value: string): value is IidProviderSlug {
	return (IID_PROVIDER_SLUGS as readonly string[]).includes(value);
}

function copyCanonicalHints(hints: Readonly<Record<string, string>>): Record<string, string> {
	return Object.fromEntries(Object.entries(hints));
}
