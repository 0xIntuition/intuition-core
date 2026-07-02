import { z } from 'zod/v4';

export const jsonLdTypeCategorySchema = z.enum([
	'person',
	'place',
	'thing',
	'company',
	'product',
	'podcast',
	'song',
	'software',
]);

const jsonLdFieldListSchema = z.array(z.string().min(1).max(128)).max(64);

const zodSchemaSchema = z.custom<z.ZodTypeAny>(
	(value) =>
		!!value &&
		typeof value === 'object' &&
		typeof (value as { safeParse?: unknown }).safeParse === 'function',
	{
		error: 'Expected a Zod schema instance for "schema".',
	}
);

export const jsonLdTypeDefinitionSchema = z
	.object({
		type: z.string().min(1).max(128),
		aliases: z.array(z.string().min(1).max(128)).max(32).optional(),
		category: jsonLdTypeCategorySchema,
		schema: zodSchemaSchema,
		requiredFields: jsonLdFieldListSchema,
		recommendedFields: jsonLdFieldListSchema,
		identityFields: jsonLdFieldListSchema,
	})
	.strict();

export const registerTypeOptionsSchema = z
	.object({
		allowOverride: z.boolean().optional(),
	})
	.strict();

export type JsonLdTypeCategory = z.infer<typeof jsonLdTypeCategorySchema>;
export type JsonLdTypeDefinition = z.infer<typeof jsonLdTypeDefinitionSchema>;
export type RegisterTypeOptions = z.infer<typeof registerTypeOptionsSchema>;

export type JsonLdTypeRegistry = {
	register(definition: JsonLdTypeDefinition, options?: RegisterTypeOptions): void;
	has(type: string): boolean;
	get(type: string): JsonLdTypeDefinition | undefined;
	list(): JsonLdTypeDefinition[];
};

export function validateJsonLdTypeDefinition(definition: unknown): JsonLdTypeDefinition {
	return jsonLdTypeDefinitionSchema.parse(definition);
}

export function validateRegisterTypeOptions(options: unknown): RegisterTypeOptions | undefined {
	if (options === undefined) {
		return undefined;
	}

	return registerTypeOptionsSchema.parse(options);
}

export function createJsonLdTypeRegistry(): JsonLdTypeRegistry {
	const definitions = new Map<string, JsonLdTypeDefinition>();

	return {
		register(definition, options) {
			const existing = definitions.get(definition.type);

			if (existing && !options?.allowOverride) {
				throw new Error(
					`Type "${definition.type}" is already registered. Set allowOverride to replace it.`
				);
			}

			definitions.set(definition.type, cloneDefinition(definition));
		},

		has(type) {
			return definitions.has(type);
		},

		get(type) {
			const found = definitions.get(type);
			return found ? cloneDefinition(found) : undefined;
		},

		list() {
			return Array.from(definitions.values())
				.map((definition) => cloneDefinition(definition))
				.sort((a, b) => a.type.localeCompare(b.type));
		},
	};
}

function cloneDefinition(definition: JsonLdTypeDefinition): JsonLdTypeDefinition {
	return {
		...definition,
		aliases: definition.aliases ? [...definition.aliases] : undefined,
		requiredFields: [...definition.requiredFields],
		recommendedFields: [...definition.recommendedFields],
		identityFields: [...definition.identityFields],
	};
}
