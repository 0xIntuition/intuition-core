import { z } from 'zod/v4';

import {
	classificationSlugLikeSchema,
	type EnrichmentArtifact,
	type EnrichmentRequest,
	type EnrichmentRuntime,
	type PluginRuntime,
	pluginRuntimeSchema,
} from './types';

const semverPattern = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;

export const enrichmentPluginManifestSchema = z
	.object({
		id: classificationSlugLikeSchema,
		version: z.string().regex(semverPattern, 'Version must be semantic versioning compatible.'),
		runtime: pluginRuntimeSchema,
		artifactTypes: z.array(classificationSlugLikeSchema).min(1),
		priority: z.number().int().min(0).default(100),
		TTL: z.number().int().min(0).optional(),
	})
	.strict();

export type ParsedEnrichmentPluginManifest = z.infer<typeof enrichmentPluginManifestSchema>;

export type EnrichmentPluginManifest = {
	id: string;
	version: string;
	runtime: PluginRuntime;
	artifactTypes: string[];
	priority?: number;
	TTL?: number;
};

export type EnrichmentPluginLogger = {
	debug(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
};

/** Optional host-injected identity policy; providers never import identity packages. */
export type EnrichmentIdentityCapability = {
	/** Stable version-bearing cache policy identifier: trimmed, non-empty, at most 256 characters, never `no-identity`. Invalid capabilities fail engine construction. */
	fingerprint: string;
	resolveWikidataSchemaType(p31EntityIds: string[]): string | undefined;
};

export type EnrichmentPluginContext = {
	now(): string;
	signal: AbortSignal;
	logger?: EnrichmentPluginLogger;
	secrets?: Record<string, string>;
	identity?: EnrichmentIdentityCapability;
};

export type EnrichmentPlugin = EnrichmentPluginManifest & {
	supports(request: EnrichmentRequest): boolean | Promise<boolean>;
	enrich(request: EnrichmentRequest, ctx: EnrichmentPluginContext): Promise<EnrichmentArtifact[]>;
};

export function defineEnrichmentPlugin<TPlugin extends EnrichmentPlugin>(plugin: TPlugin): TPlugin {
	return plugin;
}

export function validateEnrichmentPluginManifest(
	manifest: unknown
): ParsedEnrichmentPluginManifest {
	return enrichmentPluginManifestSchema.parse(manifest);
}

export function isPluginRuntimeCompatible(
	runtime: EnrichmentRuntime,
	pluginRuntime: PluginRuntime
): boolean {
	if (pluginRuntime === 'universal') {
		return true;
	}

	return runtime === pluginRuntime;
}
