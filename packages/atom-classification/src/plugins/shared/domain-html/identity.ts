import type { ResolverAtom } from '../../../plugins';

type IdentityFieldValue = string | string[] | number | boolean | Record<string, unknown>;

export function buildIdentityResolverAtom(input: {
	schemaType: string;
	category: ResolverAtom['category'];
	title: string;
	canonicalId: string;
	canonicalUrl: string;
	sameAs?: string[];
	description?: string;
	pluginId: string;
	provider: string;
	fields?: Record<string, IdentityFieldValue | undefined>;
}): ResolverAtom {
	const sameAs = normalizeStringArray(input.sameAs ?? [input.canonicalUrl]);

	return {
		schemaType: input.schemaType,
		category: input.category,
		title: input.title,
		description: input.description,
		canonicalId: input.canonicalId,
		sameAs,
		data: {
			'@context': 'https://schema.org/',
			'@type': input.schemaType,
			name: input.title,
			url: input.canonicalUrl,
			sameAs,
			...(input.description ? { description: input.description } : {}),
			...filterDefinedFields(input.fields),
		},
		metadata: {
			pluginId: input.pluginId,
			provider: input.provider,
			sourceUrl: input.canonicalUrl,
		},
	};
}

function filterDefinedFields(
	fields: Record<string, IdentityFieldValue | undefined> | undefined
): Record<string, IdentityFieldValue> {
	if (!fields) {
		return {};
	}

	return Object.fromEntries(
		Object.entries(fields).filter(
			(entry): entry is [string, IdentityFieldValue] => entry[1] !== undefined
		)
	);
}

function normalizeStringArray(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
