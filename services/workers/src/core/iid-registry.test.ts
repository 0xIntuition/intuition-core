import { describe, expect, test } from 'bun:test';
import { deriveIidClassificationResult } from './classification';
import type { NormalizedAtomIdentity } from './identity-contract';
import { extendProviderPlanWithAliases } from './iid-registry';
import { registryFixture } from './testing/iid-fixtures';

const PACKAGE_VERSION = '0.1.0-alpha.0';

describe('IID registry adapter', () => {
	test('preserves public classification, provider order, hints, and package provenance', () => {
		const calls: string[] = [];
		const adapter = registryFixture({
			classificationForIid: (iid) => {
				calls.push(`classification:${iid}`);
				return {
					slug: 'music-recording',
					schemaType: 'MusicRecording',
					displayName: 'Music Recording',
					category: 'Media',
				};
			},
			providersForIid: (iid) => {
				calls.push(`providers:${iid}`);
				return ['musicbrainz', 'spotify'];
			},
			identifierHintsForIid: (iid) => {
				calls.push(`hints:${iid}`);
				return { isrc: 'USRC17607839', recordingCode: 'USRC17607839' };
			},
			packageVersion: PACKAGE_VERSION,
		});
		const identity = identityFixture({
			canonical: 'int:isrc:USRC17607839',
			scheme: 'isrc',
			value: 'USRC17607839',
		});

		const resolution = adapter.resolve(identity);

		expect(calls).toEqual([
			'classification:int:isrc:USRC17607839',
			'providers:int:isrc:USRC17607839',
			'hints:int:isrc:USRC17607839',
		]);
		expect(resolution).toEqual({
			identityDecision: {
				status: 'classified',
				classificationSlug: 'music-recording',
				schemaType: 'MusicRecording',
				category: 'Media',
				provenance: {
					producer: '@0xintuition/iid-registry/classificationForIid',
					version: PACKAGE_VERSION,
				},
			},
			providerPlan: {
				status: 'planned',
				targets: [
					{
						provider: 'musicbrainz',
						capabilities: ['musicbrainz'],
						identifierHints: [
							{ kind: 'isrc', value: 'USRC17607839' },
							{ kind: 'recordingCode', value: 'USRC17607839' },
						],
					},
					{
						provider: 'spotify',
						capabilities: ['spotify'],
						identifierHints: [
							{ kind: 'isrc', value: 'USRC17607839' },
							{ kind: 'recordingCode', value: 'USRC17607839' },
						],
					},
				],
				provenance: {
					producer: '@0xintuition/iid-registry/providersForIid+identifierHintsForIid',
					version: PACKAGE_VERSION,
				},
			},
		});
		expect(deriveIidClassificationResult({ identity, resolution })).toMatchObject({
			status: 'recognized',
			source: 'iid-registry',
			schemaType: 'MusicRecording',
			category: 'Media',
			knownType: true,
			identity,
			identityDecision: { status: 'classified' },
			providerPlan: { status: 'planned' },
		});
	});

	test('distinguishes polymorphic ambiguity from ratified-unmapped identity', () => {
		const adapter = registryFixture({
			classificationForIid: () => undefined,
			providersForIid: () => [],
			identifierHintsForIid: () => ({}),
			packageVersion: PACKAGE_VERSION,
		});
		const ambiguous = adapter.resolve(
			identityFixture({
				canonical: 'int:wd:Q42',
				scheme: 'wd',
				value: 'Q42',
				typing: 'polymorphic',
				anchorEligible: false,
			})
		);
		const unmapped = adapter.resolve(
			identityFixture({
				canonical: 'int:iswc:T-034.524.680-1',
				scheme: 'iswc',
				value: 'T-034.524.680-1',
			})
		);

		expect(ambiguous.identityDecision.status).toBe('ambiguous');
		expect(unmapped.identityDecision.status).toBe('unmapped');
		expect(ambiguous.providerPlan).toMatchObject({ status: 'unsupported', targets: [] });
		expect(unmapped.providerPlan).toMatchObject({ status: 'unsupported', targets: [] });
	});
});

function identityFixture(overrides: Partial<NormalizedAtomIdentity>): NormalizedAtomIdentity {
	const canonical = overrides.canonical ?? 'int:isrc:USRC17607839';
	return {
		raw: canonical,
		canonical,
		scheme: 'isrc',
		value: 'USRC17607839',
		class: 'A',
		typing: 'unambiguous',
		anchorEligible: true,
		provenance: {
			producer: '@0xintuition/iid/inspectIntuitionId',
			version: PACKAGE_VERSION,
		},
		...overrides,
	};
}

test('alias provider targets are deduplicated with primary providers first and earliest hints retained', () => {
	const registry = registryFixture({
		packageVersion: PACKAGE_VERSION,
		inspect: (iid) => ({
			valid: true,
			iid,
			scheme: 'fixture',
			value: iid,
			class: 'A',
			typing: 'unambiguous',
			anchorEligible: true,
		}),
		classificationForIid: () => undefined,
		providersForIid: (iid) =>
			iid === 'alias:1' ? ['spotify', 'musicbrainz', 'spotify'] : ['wikidata', 'spotify'],
		identifierHintsForIid: (iid): Record<string, string> =>
			iid === 'alias:1' ? { spotify: 'first' } : { spotify: 'later', wikidata: 'Q42' },
	});
	const result = extendProviderPlanWithAliases({
		registry,
		aliasIids: ['alias:1', 'alias:2'],
		primaryIid: 'primary',
		primaryPlan: {
			status: 'planned',
			targets: [
				{
					provider: 'musicbrainz',
					capabilities: ['musicbrainz'],
					identifierHints: [{ kind: 'mbid', value: 'primary' }],
				},
			],
			provenance: { producer: 'fixture', version: '1' },
		},
	});
	expect(result.providerPlan?.targets.map((target) => target.provider)).toEqual([
		'musicbrainz',
		'spotify',
		'wikidata',
	]);
	expect(result.providerPlan?.targets[0]?.identifierHints).toEqual([
		{ kind: 'mbid', value: 'primary' },
		{ kind: 'spotify', value: 'first' },
	]);
	expect(result.droppedAliasHints).toEqual([
		{ iid: 'alias:2', kind: 'spotify', value: 'later', keptValue: 'first' },
	]);
});

test('alias inspection refuses repairs and noncanonical input before registry calls', () => {
	const calls: string[] = [];
	const registry = registryFixture({
		packageVersion: PACKAGE_VERSION,
		inspect: (iid) =>
			iid === 'repair'
				? {
						valid: true,
						iid: 'canonical',
						scheme: 'fixture',
						value: 'canonical',
						class: 'A',
						typing: 'unambiguous',
						anchorEligible: true,
					}
				: { valid: false, reason: 'noncanonical', canonical: 'canonical' },
		classificationForIid: () => undefined,
		providersForIid: (iid) => {
			calls.push(iid);
			return ['wikidata'];
		},
		identifierHintsForIid: () => ({ wikidata: 'Q42' }),
	});
	const result = extendProviderPlanWithAliases({ registry, aliasIids: ['repair', 'noncanonical'] });
	expect(result.skippedAliasIids).toBe(2);
	expect(result.providerPlan).toBeUndefined();
	expect(calls).toEqual([]);
});

test('a hintless alias is refused and counted even when the registry names providers', () => {
	const registry = registryFixture({
		packageVersion: PACKAGE_VERSION,
		inspect: (iid) => ({
			valid: true,
			iid,
			scheme: 'fixture',
			value: iid,
			class: 'A',
			typing: 'unambiguous',
			anchorEligible: true,
		}),
		classificationForIid: () => undefined,
		providersForIid: () => ['wikidata'],
		identifierHintsForIid: (iid): Record<string, string> =>
			iid === 'hintless' ? {} : { wikidata: 'Q42' },
	});
	const result = extendProviderPlanWithAliases({
		registry,
		aliasIids: ['hintless', 'accepted'],
	});
	expect(result.skippedAliasIids).toBe(1);
	expect(result.providerPlan).toMatchObject({
		status: 'planned',
		targets: [{ provider: 'wikidata', identifierHints: [{ kind: 'wikidata', value: 'Q42' }] }],
	});
	expect(result.providerPlan?.targets).toHaveLength(1);
});

test('a providerless alias is counted and an accepted alias can start an unsupported plan', () => {
	const registry = registryFixture({
		packageVersion: PACKAGE_VERSION,
		inspect: (iid) => ({
			valid: true,
			iid,
			scheme: 'fixture',
			value: iid,
			class: 'A',
			typing: 'unambiguous',
			anchorEligible: true,
		}),
		classificationForIid: () => undefined,
		providersForIid: (iid) => (iid === 'providerless' ? [] : ['wikidata']),
		identifierHintsForIid: () => ({ wikidata: 'Q42' }),
	});
	const result = extendProviderPlanWithAliases({
		registry,
		aliasIids: ['providerless', 'accepted'],
	});
	expect(result.skippedAliasIids).toBe(1);
	expect(result.providerPlan).toMatchObject({
		status: 'planned',
		targets: [{ provider: 'wikidata', identifierHints: [{ kind: 'wikidata', value: 'Q42' }] }],
	});
});
