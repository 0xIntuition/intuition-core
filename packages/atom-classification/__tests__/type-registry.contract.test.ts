import { describe, expect, it } from 'bun:test';
import { z } from 'zod/v4';

import {
	createJsonLdTypeRegistry,
	validateJsonLdTypeDefinition,
	validateRegisterTypeOptions,
} from '../src/type-registry';

const PERSON_DEFINITION = {
	type: 'Person',
	category: 'person' as const,
	schema: z.object({ name: z.string() }),
	requiredFields: ['name'],
	recommendedFields: ['description'],
	identityFields: ['sameAs'],
};

describe('json-ld type registry contract', () => {
	it('registers and reads type definitions deterministically', () => {
		const registry = createJsonLdTypeRegistry();

		registry.register({
			...PERSON_DEFINITION,
			aliases: ['Human'],
		});
		registry.register({
			type: 'SoftwareApplication',
			category: 'software',
			schema: z.object({ name: z.string() }),
			requiredFields: ['name'],
			recommendedFields: ['url'],
			identityFields: ['sameAs'],
		});

		expect(registry.has('Person')).toBe(true);
		expect(registry.get('Person')?.aliases).toEqual(['Human']);
		expect(registry.list().map((definition) => definition.type)).toEqual([
			'Person',
			'SoftwareApplication',
		]);
	});

	it('rejects duplicate registration without explicit override', () => {
		const registry = createJsonLdTypeRegistry();
		registry.register(PERSON_DEFINITION);

		expect(() => registry.register(PERSON_DEFINITION)).toThrow();
	});

	it('allows duplicate registration when allowOverride is true', () => {
		const registry = createJsonLdTypeRegistry();
		registry.register(PERSON_DEFINITION);

		registry.register(
			{
				...PERSON_DEFINITION,
				recommendedFields: ['description', 'image'],
			},
			{ allowOverride: true }
		);

		expect(registry.get('Person')?.recommendedFields).toEqual(['description', 'image']);
	});

	it('validates type definition contracts for plugin authors', () => {
		const definition = validateJsonLdTypeDefinition({
			type: 'DefinedTerm',
			category: 'thing',
			schema: z.object({ name: z.string() }),
			requiredFields: ['name'],
			recommendedFields: ['description'],
			identityFields: ['termCode'],
		});

		expect(definition.type).toBe('DefinedTerm');
		expect(definition.category).toBe('thing');
	});

	it('rejects non-zod schemas in type definition helper validation', () => {
		expect(() =>
			validateJsonLdTypeDefinition({
				type: 'DefinedTerm',
				category: 'thing',
				schema: { parse: () => true },
				requiredFields: ['name'],
				recommendedFields: ['description'],
				identityFields: ['termCode'],
			})
		).toThrow();
	});

	it('validates register type options helper', () => {
		expect(validateRegisterTypeOptions(undefined)).toBeUndefined();
		expect(validateRegisterTypeOptions({ allowOverride: true })).toEqual({ allowOverride: true });
		expect(() => validateRegisterTypeOptions({ allowOverride: 'yes' })).toThrow();
	});
});
