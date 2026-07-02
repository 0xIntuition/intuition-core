import type { ResolverAtom } from '../../plugins';
import type {
	ClassificationCanonicalFieldPolicyMap,
	ClassificationSourceFamily,
} from '../../types';

export function tryParseUrl(input: string): URL | null {
	try {
		return new URL(input.trim());
	} catch {
		return null;
	}
}

export function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

export function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

export function toCategory(
	value: string
): 'person' | 'place' | 'thing' | 'company' | 'product' | 'podcast' | 'song' | 'software' {
	if (
		value === 'person' ||
		value === 'place' ||
		value === 'thing' ||
		value === 'company' ||
		value === 'product' ||
		value === 'podcast' ||
		value === 'song' ||
		value === 'software'
	) {
		return value;
	}

	return 'thing';
}

export function withPlatformMetadata(
	atom: ResolverAtom,
	platform: string,
	subtype: string,
	options?: {
		pluginId?: string;
		provider?: string;
		fetchedAt?: string;
		sourceUrl?: string;
		confidence?: number;
		resolutionMode?: 'identity-only' | 'enriched';
		sourceFamily?: ClassificationSourceFamily;
		fieldPolicies?: ClassificationCanonicalFieldPolicyMap;
	}
): ResolverAtom {
	const pluginId = options?.pluginId ?? platform;
	const provider = options?.provider ?? platform;

	return {
		...atom,
		metadata: {
			...(atom.metadata ?? {}),
			pluginId,
			provider,
			fetchedAt: options?.fetchedAt,
			sourceUrl: options?.sourceUrl,
			confidence: options?.confidence,
			resolutionMode: options?.resolutionMode,
			sourceFamily: options?.sourceFamily,
			fieldPolicies: options?.fieldPolicies,
			platform,
			subtype,
		},
	};
}
