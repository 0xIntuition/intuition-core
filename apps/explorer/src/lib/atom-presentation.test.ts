import { describe, expect, test } from 'bun:test';
import { atomContextItemSchema, atomIdentitySchema, iidAtomsPath } from './api';
import {
	atomDisplayImage,
	atomDisplayLabel,
	atomSecondaryIdentity,
	contextDisplayValue,
	parseSemanticReadsFlag,
	safeContextHref,
} from './atom-presentation';

type GoldenFixture = {
	schemaVersion: string;
	canonicalizationPolicy: string;
	identityCases: Array<{ id: string; input: string }>;
	contextCases: Array<{
		id: string;
		entries: Array<{
			ordinal: number;
			uri: string | null;
			raw?: string;
			source: string;
			expectedLinkable: boolean;
			expectedDisplay?: string;
		}>;
	}>;
	resolutionCases: Array<{
		id: string;
		source: {
			id: string;
			data: string;
			dataResolved: unknown;
		};
		expected: {
			displayName: string | null;
			displayImage?: string;
		};
	}>;
};

const golden = (await Bun.file(
	new URL('../../../../tests/fixtures/atom-semantic-read-model.v1.json', import.meta.url)
).json()) as GoldenFixture;

function byId<T extends { id: string }>(cases: T[], id: string): T {
	const found = cases.find((entry) => entry.id === id);
	if (!found) {
		throw new Error(`missing golden fixture case: ${id}`);
	}
	return found;
}

const unresolved = byId(golden.resolutionCases, 'unresolved-isrc');
const resolved = byId(golden.resolutionCases, 'resolved-isrc');
const baseAtom = unresolved.source;

describe('atom presentation', () => {
	test('prefers the resolved display name and image over a raw IID', () => {
		const atom = {
			...resolved.source,
			display: {
				name: resolved.expected.displayName ?? undefined,
				image: resolved.expected.displayImage,
			},
		};

		expect(atomDisplayLabel(atom, 96, true)).toBe(
			resolved.expected.displayName ?? resolved.source.data
		);
		expect(atomDisplayImage(atom, true)).toBe(resolved.expected.displayImage ?? null);
	});

	test('falls back through resolved payload, raw data, and atom id', () => {
		expect(
			atomDisplayLabel({ ...baseAtom, dataResolved: { name: 'Resolved name' } }, 96, true)
		).toBe('Resolved name');
		expect(atomDisplayLabel(baseAtom, 96, true)).toBe('int:isrc:USQX91300108');
		expect(atomDisplayLabel({ ...baseAtom, data: null }, 96, true)).toBe(baseAtom.id);
	});

	test('retains legacy presentation while the Explorer exposure gate is off', () => {
		const atom = {
			...baseAtom,
			dataResolved: { name: 'Resolved name', image: 'https://images.example/legacy.jpg' },
			display: { name: 'Semantic name', image: 'https://images.example/semantic.jpg' },
		};

		expect(atomDisplayLabel(atom, 96, false)).toBe('int:isrc:USQX91300108');
		expect(atomDisplayImage(atom, false)).toBe('https://images.example/legacy.jpg');
		expect(
			atomSecondaryIdentity(
				{ ...atom, identity: { raw: baseAtom.data, canonical: baseAtom.data } },
				false
			)
		).toBeNull();
	});

	test('loads a versioned, package-neutral identity corpus', () => {
		expect(golden.schemaVersion).toBe('1.0.0');
		expect(golden.canonicalizationPolicy).toBe('deferred-to-public-iid-package');
		expect(golden.identityCases.map((entry) => entry.id)).toEqual([
			'p0-isrc-recording',
			'typed-mbid-recording',
			'polymorphic-wikidata',
			'invalid-isrc-value',
			'iid-lookalike',
		]);
	});

	test('accepts the complete Core producer identity envelope', () => {
		const identity = (unresolved.source as { parseResult?: { identity?: unknown } }).parseResult
			?.identity;

		const parsed = atomIdentitySchema.parse(identity);
		expect(parsed).toEqual(identity as typeof parsed);
	});

	test('parses only explicit exposure values', () => {
		expect(parseSemanticReadsFlag('true')).toBe(true);
		expect(parseSemanticReadsFlag('1')).toBe(true);
		expect(parseSemanticReadsFlag('false')).toBe(false);
		expect(parseSemanticReadsFlag('yes')).toBe(false);
		expect(parseSemanticReadsFlag(undefined)).toBe(false);
	});

	test('builds an exact, encoded same-IID cluster path', () => {
		expect(iidAtomsPath('int:mbid:recording:a/b')).toBe(
			'/api/iids/int%3Ambid%3Arecording%3Aa%2Fb/atoms'
		);
	});
});

describe('safeContextHref', () => {
	test('accepts persisted ordering provenance while keeping opaque bytes non-clickable', () => {
		const context = atomContextItemSchema.parse({
			eventSequence: '42',
			ordinal: 3,
			uri: null,
			raw: '0xff00',
			source: 'onchain',
			registrant: '0xregistrant',
			transactionHash: '0xtx',
			logIndex: 7,
		});

		expect(contextDisplayValue(context)).toBe('0xff00');
		expect(safeContextHref(context)).toBeNull();
	});

	test('applies link safety without reordering or deduplicating context evidence', () => {
		const fixture = byId(golden.contextCases, 'ordered-duplicate-and-unsafe-context');

		expect(fixture.entries.map((entry) => entry.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6]);
		expect(fixture.entries[0]?.uri).toBe(fixture.entries[1]?.uri);
		for (const entry of fixture.entries) {
			expect(safeContextHref(entry) !== null, `context ordinal ${entry.ordinal}`).toBe(
				entry.expectedLinkable
			);
			if (entry.expectedDisplay) {
				expect(contextDisplayValue(entry)).toBe(entry.expectedDisplay);
			}
		}
	});
});
