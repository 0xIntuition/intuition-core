import { describe, expect, test } from 'bun:test';
import {
	exposeAtomDetailView,
	exposeAtomListView,
	exposeAtomView,
	exposeExpandedAtomTerm,
	presentAtom,
	presentPersistedAtomContext,
} from '../src/atom-view';

type GoldenFixture = {
	identityCases: Array<{
		id: string;
		input: string;
		expectedIntent: {
			minimumProfile?: string;
			schemeTyping?: string;
			scheme?: string;
			value?: string;
			classification: string | null;
		};
	}>;
	legacyJsonAtom: {
		rawType: string;
		data: string;
		expectedIntent: { classification: string };
	};
	contextCases: Array<{
		id: string;
		entries: Array<{
			ordinal: number;
			uri: string | null;
			raw?: string;
			source: string;
			expectedLinkable: boolean;
		}>;
	}>;
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
			classificationResult?: unknown;
			enrichmentStatus: string;
			enrichmentError?: unknown;
			enrichedAt?: string;
		};
		expected: {
			resolutionStatus: string;
			displayName: string | null;
			displayImage?: string;
		};
	}>;
};

const golden = (await Bun.file(
	new URL('../../../tests/fixtures/atom-semantic-read-model.v1.json', import.meta.url)
).json()) as GoldenFixture;

function byId<T extends { id: string }>(cases: T[], id: string): T {
	const found = cases.find((entry) => entry.id === id);
	if (!found) {
		throw new Error(`missing golden fixture case: ${id}`);
	}
	return found;
}

describe('presentAtom', () => {
	test('maps persisted context without decoding or dropping ordering provenance', () => {
		expect(
			presentPersistedAtomContext({
				eventSequence: 42n,
				ordinal: 3,
				uriText: null,
				uriHex: '0xff00',
				registrant: '0xregistrant',
				transactionHash: '0xtx',
				logIndex: 7,
			})
		).toEqual({
			eventSequence: '42',
			ordinal: 3,
			uri: null,
			source: 'onchain',
			raw: '0xff00',
			registrant: '0xregistrant',
			transactionHash: '0xtx',
			logIndex: 7,
		});
	});

	test('keeps semantic list evidence dark and exposes nested identity when enabled', () => {
		const source = {
			id: '0xlist',
			createdAt: '2026-08-10T00:00:00.000Z',
			isOnchain: true,
			rawType: 'iid',
			data: 'int:isrc:USQX91300108',
			iid: 'int:isrc:USQX91300108',
			dataResolved: { name: 'One Last Time' },
			parseResult: {
				kind: 'iid',
				identity: {
					raw: 'int:isrc:USQX91300108',
					canonical: 'int:isrc:preferred-nested',
					scheme: 'isrc',
					value: 'USQX91300108',
					profile: 'p0',
					anchorEligible: true,
				},
			},
			classificationType: 'MusicRecording',
			parseStatus: 'completed',
			classificationStatus: 'completed',
			classificationResult: { source: 'iid-registry' },
			enrichmentStatus: 'completed',
			enrichmentError: null,
			enrichedAt: '2026-08-10T00:01:00.000Z',
		};

		const legacy = exposeAtomListView(source, false);
		expect(legacy).toEqual({
			id: source.id,
			createdAt: source.createdAt,
			isOnchain: source.isOnchain,
			rawType: source.rawType,
			data: source.data,
			dataResolved: source.dataResolved,
			classificationType: source.classificationType,
			parseStatus: source.parseStatus,
			classificationStatus: source.classificationStatus,
			enrichmentStatus: source.enrichmentStatus,
		});
		expect('iid' in legacy).toBe(false);
		expect('parseResult' in legacy).toBe(false);

		const semantic = exposeAtomListView(source, true);
		expect(semantic.identity).toMatchObject({
			canonical: 'int:isrc:preferred-nested',
			scheme: 'isrc',
			value: 'USQX91300108',
		});
		expect(semantic.iid).toBe('int:isrc:USQX91300108');
		expect('parseResult' in semantic).toBe(false);
		expect('classificationResult' in semantic).toBe(false);
		expect('enrichmentError' in semantic).toBe(false);
		expect('enrichedAt' in semantic).toBe(false);
		expect(semantic.classification).toEqual({
			type: 'MusicRecording',
			status: 'completed',
			source: 'iid-registry',
		});
	});

	test('strips only the new persisted IID from legacy detail and uses it when enabled', () => {
		const source = {
			id: '0xdetail',
			rawType: 'iid',
			data: 'int:isrc:raw-input',
			iid: 'int:isrc:persisted-canonical',
			parseResult: {
				kind: 'iid',
				identity: {
					raw: 'int:isrc:raw-input',
					canonical: null,
					scheme: 'isrc',
					value: 'raw-input',
					anchorEligible: true,
				},
			},
			classificationType: 'MusicRecording',
			classificationResult: { source: 'iid-registry' },
			enrichmentStatus: 'pending',
			context: [{ ordinal: 0, uri: null, raw: '0xff00', source: 'onchain' }],
		};

		const legacy = exposeAtomDetailView(source, false);
		expect(legacy).toEqual({
			id: source.id,
			rawType: source.rawType,
			data: source.data,
			parseResult: source.parseResult,
			classificationType: source.classificationType,
			classificationResult: source.classificationResult,
			enrichmentStatus: source.enrichmentStatus,
		});
		expect('iid' in legacy).toBe(false);
		expect('context' in legacy).toBe(false);

		const semantic = exposeAtomDetailView(source, true);
		expect(semantic.identity).toEqual({
			raw: source.data,
			canonical: source.iid,
		});
		expect(semantic.iid).toBe(source.iid);
	});

	test('does not treat a persisted IID as identity evidence for a non-IID atom', () => {
		const view = presentAtom({
			rawType: 'string',
			data: 'int:isrc:lookalike',
			iid: 'int:isrc:must-not-leak-into-identity',
			classificationType: 'Unknown',
		});

		expect(view.identity).toBeUndefined();
	});

	test('leaves the legacy response object unchanged while exposure is disabled', () => {
		const legacy = golden.legacyJsonAtom;
		const source = {
			id: '0xatom',
			rawType: legacy.rawType,
			data: legacy.data,
			dataResolved: { name: 'resolved but dark' },
			classificationType: legacy.expectedIntent.classification,
		};

		expect(exposeAtomView(source, false)).toBe(source);
		expect(exposeAtomView(source, false)).toEqual(source);
		expect('display' in exposeAtomView(source, false)).toBe(false);
	});

	test('does not leak display-only query fields into legacy expanded terms', () => {
		const source = byId(golden.resolutionCases, 'resolved-isrc').source;

		expect(exposeExpandedAtomTerm(source, false)).toEqual({
			id: source.id,
			rawType: 'iid',
			data: 'int:isrc:USQX91300108',
			classificationType: 'MusicRecording',
		});
		expect(exposeExpandedAtomTerm(source, true)).toMatchObject({
			display: { name: 'One Last Time' },
			raw: { type: 'iid', data: 'int:isrc:USQX91300108' },
		});
	});

	test('adds an envelope while preserving legacy fields', () => {
		const fixture = byId(golden.resolutionCases, 'resolved-isrc');
		const view = presentAtom(fixture.source);

		expect(view).toMatchObject({
			...fixture.source,
			raw: { type: fixture.source.rawType, data: fixture.source.data },
			classification: { type: 'MusicRecording', status: 'completed', source: 'iid-registry' },
			resolution: {
				status: fixture.expected.resolutionStatus,
				updatedAt: fixture.source.enrichedAt,
			},
			display: {
				name: fixture.expected.displayName,
				image: fixture.expected.displayImage,
			},
		});
	});

	test('projects IID identity from the parser result without an IID package dependency', () => {
		const identity = byId(golden.identityCases, 'p0-isrc-recording');
		const view = presentAtom({
			rawType: 'iid',
			data: identity.input,
			dataResolved: {},
			parseResult: {
				kind: 'iid',
				normalizedInput: identity.input,
				identity: {
					raw: identity.input,
					canonical: identity.input,
					profile: identity.expectedIntent.minimumProfile,
					scheme: identity.expectedIntent.scheme,
					value: identity.expectedIntent.value,
					anchorEligible: true,
				},
			},
			classificationType: identity.expectedIntent.classification ?? 'Unknown',
			classificationStatus: 'completed',
			enrichmentStatus: 'pending',
		});

		expect(view.identity).toEqual({
			raw: identity.input,
			canonical: identity.input,
			profile: identity.expectedIntent.minimumProfile,
			scheme: identity.expectedIntent.scheme,
			value: identity.expectedIntent.value,
			anchorEligible: true,
		});
		expect(view.resolution).toEqual({ status: 'pending' });
	});

	test('preserves all Core producer identity metadata', () => {
		const source = byId(golden.resolutionCases, 'unresolved-isrc').source;
		const identity = (source.parseResult as { identity: Record<string, unknown> }).identity;

		expect(presentAtom(source).identity).toEqual(identity);
	});

	test('retains compatibility with the legacy flat IID parse result', () => {
		const source = byId(golden.resolutionCases, 'resolved-isrc').source;
		const identity = presentAtom(source).identity;

		expect(identity).toMatchObject({
			raw: source.data,
			scheme: 'isrc',
			value: 'USQX91300108',
			profile: 'p0',
		});
	});

	test('does not fabricate identity, context, resolution, or display evidence', () => {
		const view = presentAtom({
			rawType: 'string',
			data: 'plain atom',
			classificationType: 'Unknown',
		});

		expect(view.raw).toEqual({ type: 'string', data: 'plain atom' });
		expect(view.classification).toEqual({ type: 'Unknown' });
		expect('identity' in view).toBe(false);
		expect('context' in view).toBe(false);
		expect('resolution' in view).toBe(false);
		expect('display' in view).toBe(false);
	});

	test('preserves supplied context order and opaque values', () => {
		const context = byId(golden.contextCases, 'ordered-duplicate-and-unsafe-context').entries.map(
			({ expectedLinkable: _expectedLinkable, ...entry }) => entry
		);
		const view = presentAtom({
			rawType: 'string',
			data: 'atom',
			classificationType: 'Unknown',
			context,
		});

		expect(view.context).toEqual(context);
		expect(view.context).not.toBe(context);
	});

	test('exposes every modeled resolution state from the golden corpus', () => {
		for (const fixture of golden.resolutionCases) {
			const view = presentAtom(fixture.source);
			expect(view.resolution?.status, fixture.id).toBe(fixture.expected.resolutionStatus);
			expect(view.display?.name ?? null, fixture.id).toBe(fixture.expected.displayName);
		}
	});
});
