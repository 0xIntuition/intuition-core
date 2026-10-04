import { describe, expect, test } from 'bun:test';
import { atomIdentitySchema } from '../apps/explorer/src/lib/api';
import { presentAtom } from '../services/api/src/atom-view';
import { isNormalizedAtomIdentity } from '../services/workers/src/core/identity-contract';
import { toCompactParseResultMaybe } from '../services/workers/src/kg/processing';

type SemanticFixture = {
	resolutionCases: Array<{
		id: string;
		source: {
			id: string;
			rawType: string;
			data: string;
			dataResolved: unknown;
			parseResult?: unknown;
			classificationType: string;
			classificationStatus: string;
			enrichmentStatus: string;
		};
	}>;
};

const fixture = (await Bun.file(
	new URL('./fixtures/atom-semantic-read-model.v1.json', import.meta.url)
).json()) as SemanticFixture;

describe('normalized identity cross-stack contract', () => {
	test('survives persistence, API presentation, and Explorer validation losslessly', () => {
		const golden = fixture.resolutionCases.find(({ id }) => id === 'unresolved-isrc');
		if (!golden) {
			throw new Error('missing unresolved-isrc golden fixture');
		}

		// JSON round-trip models the JSONB persistence boundary without importing a
		// database driver or duplicating any IID package semantics in Core.
		const persisted = JSON.parse(JSON.stringify(golden.source)) as typeof golden.source;
		const parseResult = toCompactParseResultMaybe(persisted.parseResult);
		expect(parseResult).not.toBeNull();
		if (!parseResult) {
			throw new Error('golden parse result did not survive persistence validation');
		}
		expect(isNormalizedAtomIdentity(parseResult.identity)).toBe(true);
		expect(parseResult.identity).not.toHaveProperty('profile');
		expect(parseResult.identity?.provenance.specificationVersion).toBe(
			'@0xintuition/iid-spec@0.1.0-alpha.0'
		);

		const presented = presentAtom(persisted);
		expect(presented.identity).toEqual(parseResult.identity);
		expect(atomIdentitySchema.parse(presented.identity)).toEqual(parseResult.identity);
	});
});
