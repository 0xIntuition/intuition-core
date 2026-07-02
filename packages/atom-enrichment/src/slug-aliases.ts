const canonicalSlugAliases = new Map<string, string>([['twitter-profile', 'x-profile']]);

const equivalentSlugGroups = new Map<string, string[]>([
	['twitter-profile', ['x-profile', 'twitter-profile']],
	['x-profile', ['x-profile', 'twitter-profile']],
]);

export function canonicalizeEnrichmentSlug(slug: string): string {
	return canonicalSlugAliases.get(slug) ?? slug;
}

export function canonicalizeEnrichmentSlugs(
	slugs: readonly string[] | undefined
): string[] | undefined {
	if (!slugs || slugs.length === 0) {
		return undefined;
	}

	return [...new Set(slugs.map((slug) => canonicalizeEnrichmentSlug(slug)))];
}

export function expandEnrichmentSlugAliases(slug: string): string[] {
	return (
		equivalentSlugGroups.get(slug) ??
		equivalentSlugGroups.get(canonicalizeEnrichmentSlug(slug)) ?? [slug]
	);
}

export function expandEnrichmentSlugAliasesList(
	slugs: readonly string[] | undefined
): string[] | undefined {
	if (!slugs || slugs.length === 0) {
		return undefined;
	}

	return [...new Set(slugs.flatMap((slug) => expandEnrichmentSlugAliases(slug)))];
}
