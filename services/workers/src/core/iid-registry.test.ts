import { describe, expect, test } from 'bun:test';
import { deriveIidClassificationResult } from './classification';
import type { NormalizedAtomIdentity } from './identity-contract';
import { createIidRegistryAdapter } from './iid-registry';

const PACKAGE_VERSION = '0.1.0-alpha.0';

describe('IID registry adapter', () => {
	test('preserves public classification, provider order, hints, and package provenance', () => {
		const calls: string[] = [];
		const adapter = createIidRegistryAdapter({
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
		const adapter = createIidRegistryAdapter({
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
