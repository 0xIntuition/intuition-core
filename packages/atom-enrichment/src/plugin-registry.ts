import { type EnrichmentPlugin, isPluginRuntimeCompatible } from './plugins';
import { canonicalizeEnrichmentSlug, canonicalizeEnrichmentSlugs } from './slug-aliases';
import {
	type EnrichmentRequest,
	type EnrichmentSkippedPlugin,
	enrichmentRequestSchema,
} from './types';

export type RegisterPluginOptions = {
	override?: boolean;
};

export type ResolvePluginsResult = {
	plugins: EnrichmentPlugin[];
	skipped: EnrichmentSkippedPlugin[];
};

export type EnrichmentPluginRegistry = {
	register(plugin: EnrichmentPlugin, options?: RegisterPluginOptions): void;
	unregister(pluginId: string): boolean;
	list(): EnrichmentPlugin[];
	resolve(request: EnrichmentRequest): ResolvePluginsResult;
	has(pluginId: string): boolean;
	get(pluginId: string): EnrichmentPlugin | undefined;
};

export function createEnrichmentPluginRegistry(
	plugins: EnrichmentPlugin[] = []
): EnrichmentPluginRegistry {
	const definitions = new Map<string, EnrichmentPlugin>();

	for (const plugin of plugins) {
		registerInternal(definitions, plugin, { override: false });
	}

	return {
		register(plugin, options) {
			registerInternal(definitions, plugin, options);
		},

		unregister(pluginId) {
			return definitions.delete(canonicalizeEnrichmentSlug(pluginId));
		},

		list() {
			return sortPlugins(Array.from(definitions.values()));
		},

		resolve(request) {
			const parsedRequest = enrichmentRequestSchema.parse(request);
			const pluginAllowListSlugs = canonicalizeEnrichmentSlugs(parsedRequest.plugins);
			const artifactTypeAllowListSlugs = canonicalizeEnrichmentSlugs(
				parsedRequest.artifactTypes ?? parsedRequest.artifactClasses
			);
			const pluginAllowList = pluginAllowListSlugs ? new Set(pluginAllowListSlugs) : undefined;
			const artifactTypeAllowList = artifactTypeAllowListSlugs
				? new Set(artifactTypeAllowListSlugs)
				: undefined;

			const resolved: EnrichmentPlugin[] = [];
			const skipped: EnrichmentSkippedPlugin[] = [];

			for (const plugin of sortPlugins(Array.from(definitions.values()))) {
				if (!isPluginRuntimeCompatible(parsedRequest.runtime, plugin.runtime)) {
					skipped.push({
						pluginId: plugin.id,
						reason: 'runtime_mismatch',
					});
					continue;
				}

				if (pluginAllowList && !pluginAllowList.has(plugin.id)) {
					skipped.push({
						pluginId: plugin.id,
						reason: 'filtered',
					});
					continue;
				}

				if (
					artifactTypeAllowList &&
					!plugin.artifactTypes.some((slug) => artifactTypeAllowList.has(slug))
				) {
					skipped.push({
						pluginId: plugin.id,
						reason: 'filtered',
					});
					continue;
				}

				resolved.push(plugin);
			}

			return {
				plugins: resolved,
				skipped,
			};
		},

		has(pluginId) {
			return definitions.has(canonicalizeEnrichmentSlug(pluginId));
		},

		get(pluginId) {
			return definitions.get(canonicalizeEnrichmentSlug(pluginId));
		},
	};
}

function registerInternal(
	definitions: Map<string, EnrichmentPlugin>,
	plugin: EnrichmentPlugin,
	options?: RegisterPluginOptions
): void {
	if (definitions.has(plugin.id) && !options?.override) {
		throw new Error(
			`Plugin "${plugin.id}" is already registered. Pass { override: true } to replace it.`
		);
	}

	if (typeof plugin.supports !== 'function') {
		throw new Error(`Plugin "${plugin.id}" must implement supports(request).`);
	}

	if (typeof plugin.enrich !== 'function') {
		throw new Error(`Plugin "${plugin.id}" must implement enrich(request, ctx).`);
	}

	definitions.set(plugin.id, plugin);
}

function sortPlugins(plugins: EnrichmentPlugin[]): EnrichmentPlugin[] {
	return [...plugins].sort((left, right) => {
		const priorityDiff = (left.priority ?? 100) - (right.priority ?? 100);
		if (priorityDiff !== 0) {
			return priorityDiff;
		}

		return left.id.localeCompare(right.id);
	});
}
