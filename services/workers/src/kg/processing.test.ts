import { describe, expect, test } from 'bun:test';
import {
	getProcessingMetaString,
	toClassificationResultMaybe,
	toCompactParseResultMaybe,
} from './processing';

describe('KG processing helpers', () => {
	test('reads run ids from processing metadata', () => {
		expect(getProcessingMetaString({ parseRunId: 'run-1' }, 'parseRunId')).toBe('run-1');
		expect(() => getProcessingMetaString({}, 'parseRunId')).toThrow(/parseRunId/);
		expect(() => getProcessingMetaString(null, 'parseRunId')).toThrow(/parseRunId/);
	});

	test('validates compact parse result shape', () => {
		expect(
			toCompactParseResultMaybe({
				kind: 'json',
				normalizedInput: '{}',
				structuredDocument: { topLevelType: 'object' },
			})
		).toMatchObject({ kind: 'json', normalizedInput: '{}' });
		expect(toCompactParseResultMaybe({ kind: 'json' })).toBeNull();
		expect(toCompactParseResultMaybe({ kind: '', normalizedInput: '{}' })).toBeNull();
		expect(toCompactParseResultMaybe([])).toBeNull();
	});

	test('keeps legacy parse records valid and validates optional identity handoffs', () => {
		const legacy = { kind: 'plain_string', normalizedInput: 'legacy value' } as const;
		expect(toCompactParseResultMaybe(legacy)).toEqual(legacy);

		const withIdentity = {
			kind: 'iid',
			normalizedInput: 'opaque raw identity',
			identity: {
				raw: 'opaque raw identity',
				canonical: 'opaque canonical identity',
				scheme: 'fixture-scheme',
				value: 'value:with:colons',
				profile: 'p0',
				anchorEligible: true,
				provenance: { producer: 'adapter', version: 'test' },
			},
		} as const;
		expect(toCompactParseResultMaybe(withIdentity)).toEqual(withIdentity);
		expect(toCompactParseResultMaybe({ ...withIdentity, identity: { canonical: '' } })).toBeNull();

		const withFallback = {
			...legacy,
			iidFallback: {
				reason: 'unknown-scheme',
				provenance: {
					producer: '@0xintuition/iid/inspectIntuitionId',
					version: '0.1.0-alpha.0',
				},
			},
		} as const;
		expect(toCompactParseResultMaybe(withFallback)).toEqual(withFallback);
		expect(
			toCompactParseResultMaybe({
				...withFallback,
				iidFallback: { ...withFallback.iidFallback, reason: 'guessed-repair' },
			})
		).toBeNull();
	});

	test('validates classification result shape', () => {
		expect(
			toClassificationResultMaybe({
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'WebSite',
			})
		).toMatchObject({ status: 'recognized', schemaType: 'WebSite' });
		expect(toClassificationResultMaybe({ status: 'recognized' })).toBeNull();
		expect(toClassificationResultMaybe({ status: 'done', source: 'inline_json' })).toBeNull();
		expect(toClassificationResultMaybe('recognized')).toBeNull();
	});

	test('keeps legacy classification records valid and validates optional semantic handoffs', () => {
		const legacy = { status: 'not_applicable', source: 'raw_input' } as const;
		expect(toClassificationResultMaybe(legacy)).toEqual(legacy);

		const withHandoffs = {
			status: 'recognized',
			source: 'future-adapter',
			identityDecision: {
				status: 'unmapped',
				provenance: { producer: 'registry-adapter', version: 'test' },
			},
			providerPlan: {
				status: 'unsupported',
				targets: [],
				provenance: { producer: 'registry-adapter', version: 'test' },
			},
		} as const;
		expect(toClassificationResultMaybe(withHandoffs)).toEqual(withHandoffs);
		expect(
			toClassificationResultMaybe({
				...withHandoffs,
				providerPlan: { status: 'planned', targets: 'not-an-array' },
			})
		).toBeNull();
	});
});
