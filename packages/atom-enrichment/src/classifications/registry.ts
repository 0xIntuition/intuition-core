import { z } from 'zod/v4';

import {
	type ClassificationCategory,
	classificationCategorySchema,
	classificationSlugSchema,
} from './schemas';

export interface ClassificationDefinition<TData extends z.ZodType = z.ZodType> {
	slug: string;
	displayName: string;
	category: ClassificationCategory;
	dataSchema: TData;
	renderer?: string;
	description?: string;
	schemaVersion?: string;
	runtime?: 'client' | 'server' | 'universal';
}

export type RegisterClassificationOptions = {
	override?: boolean;
};

export interface ClassificationRegistry {
	register(definition: ClassificationDefinition, options?: RegisterClassificationOptions): void;
	get(slug: string): ClassificationDefinition | undefined;
	list(): ClassificationDefinition[];
	listByCategory(category: ClassificationCategory): ClassificationDefinition[];
	has(slug: string): boolean;
	validate(slug: string, data: unknown): z.ZodSafeParseResult<unknown>;
}

export function createClassificationRegistry(): ClassificationRegistry {
	const definitions = new Map<string, ClassificationDefinition>();

	return {
		register(definition, options) {
			classificationSlugSchema.parse(definition.slug);
			classificationCategorySchema.parse(definition.category);

			if (definitions.has(definition.slug) && !options?.override) {
				throw new Error(
					`Classification "${definition.slug}" is already registered. Pass { override: true } to replace it.`
				);
			}

			definitions.set(definition.slug, cloneDefinition(definition));
		},

		get(slug) {
			const definition = definitions.get(slug);
			return definition ? cloneDefinition(definition) : undefined;
		},

		list() {
			return Array.from(definitions.values())
				.map((definition) => cloneDefinition(definition))
				.sort((left, right) => left.slug.localeCompare(right.slug));
		},

		listByCategory(category) {
			classificationCategorySchema.parse(category);

			return Array.from(definitions.values())
				.filter((definition) => definition.category === category)
				.map((definition) => cloneDefinition(definition))
				.sort((left, right) => left.slug.localeCompare(right.slug));
		},

		has(slug) {
			return definitions.has(slug);
		},

		validate(slug, data) {
			const definition = definitions.get(slug);

			if (!definition) {
				return z
					.any()
					.superRefine((_value, ctx) => {
						ctx.addIssue({
							code: 'custom',
							message: `Unknown classification: "${slug}"`,
							path: ['classification'],
						});
					})
					.safeParse(data);
			}

			return definition.dataSchema.safeParse(data);
		},
	};
}

function cloneDefinition(definition: ClassificationDefinition): ClassificationDefinition {
	return {
		...definition,
	};
}
