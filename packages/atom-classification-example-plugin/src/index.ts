import type { AtomClassificationPlugin } from '@0xintuition/atom-classification';

export type ExampleLexicalSignalPluginOptions = {
	/**
	 * Prefix used to trigger this plugin, e.g. "idea:".
	 */
	prefix?: string;
	/**
	 * Override plugin ID if you need multiple instances.
	 */
	id?: string;
	/**
	 * Classifier/resolver priority. Lower runs earlier.
	 */
	priority?: number;
};

/**
 * Minimal external plugin example.
 *
 * Input pattern:
 * - "idea: semantic grounding"
 *
 * Output:
 * - lexical classification + DefinedTerm resolution
 */
export function createExampleLexicalSignalPlugin(
	options: ExampleLexicalSignalPluginOptions = {}
): AtomClassificationPlugin {
	const pluginId = options.id ?? 'example-lexical-signal';
	const normalizedPrefix = normalizePrefix(options.prefix ?? 'idea:');
	const priority = options.priority ?? 30;
	const classifierId = `${pluginId}-classifier`;
	const resolverId = `${pluginId}-resolver`;

	return {
		manifest: {
			id: pluginId,
			version: '1.0.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['classifier:text:seed-term', 'resolver:lexical:defined-term'],
			permissions: [],
			dependsOn: ['type-profiles'],
			provides: ['example:lexical:defined-term'],
			priority,
		},
		classifiers: [
			{
				id: classifierId,
				priority,
				classify: (input) => {
					const normalizedValue = parsePrefixedValue(input, normalizedPrefix);
					if (!normalizedValue) {
						return null;
					}

					return {
						type: 'text',
						domain: 'lexical',
						subtype: 'seed-term',
						confidence: 0.82,
						meta: {
							plugin: pluginId,
							prefix: normalizedPrefix,
							normalizedValue,
						},
					};
				},
			},
		],
		resolvers: [
			{
				id: resolverId,
				priority,
				canResolve: (classification, request) =>
					classification.domain === 'lexical' &&
					classification.subtype === 'seed-term' &&
					!!parsePrefixedValue(request.input, normalizedPrefix),
				resolve: ({ request }) => {
					const normalizedValue = parsePrefixedValue(request.input, normalizedPrefix);
					if (!normalizedValue) {
						return null;
					}

					const slug = slugify(normalizedValue);
					const title = toTitleCase(normalizedValue);
					return {
						atoms: [
							{
								schemaType: 'DefinedTerm',
								category: 'thing',
								title,
								description: `External plugin resolved "${normalizedValue}" as a deterministic seed term.`,
								canonicalId: `example-term:${slug}`,
								sameAs: [`https://example.org/terms/${slug}`],
								source: pluginId,
								data: {
									plugin: pluginId,
									prefix: normalizedPrefix,
									normalizedValue,
								},
							},
						],
						fallbackUsed: false,
						metadata: {
							examplePlugin: pluginId,
						},
					};
				},
			},
		],
	};
}

function parsePrefixedValue(input: string, prefix: string): string | null {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return null;
	}

	const lowerPrefix = prefix.toLowerCase();
	if (!trimmed.toLowerCase().startsWith(lowerPrefix)) {
		return null;
	}

	const rawValue = trimmed.slice(prefix.length).trim();
	return rawValue.length > 0 ? rawValue : null;
}

function normalizePrefix(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return 'idea:';
	}

	return trimmed.endsWith(':') ? trimmed : `${trimmed}:`;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function toTitleCase(value: string): string {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
		.join(' ');
}
