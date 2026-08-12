import { describe, expect, test } from 'bun:test';
import {
	isIdentityClassificationDecision,
	isIdentityProviderPlan,
	isNormalizedAtomIdentity,
} from './identity-contract';

const provenance = {
	producer: 'public-package-adapter',
	version: '0.1.0-test',
	specificationVersion: 'fixture-v1',
};

describe('identity handoff contracts', () => {
	test('accepts normalized identity without interpreting its scheme or value', () => {
		expect(
			isNormalizedAtomIdentity({
				raw: 'opaque raw identity',
				canonical: 'opaque canonical identity',
				scheme: 'fixture-scheme',
				value: 'value:with:colons',
				profile: 'p0',
				class: 'A',
				typing: 'unambiguous',
				anchorEligible: true,
				provenance,
			})
		).toBe(true);
		expect(
			isNormalizedAtomIdentity({
				raw: 'same identity without representation context',
				canonical: 'opaque canonical identity',
				scheme: 'fixture-scheme',
				value: 'value:with:colons',
				class: 'C',
				typing: 'polymorphic',
				anchorIneligibilityReason: 'polymorphic-scheme',
				anchorEligible: false,
				provenance,
			})
		).toBe(true);
	});

	test('rejects incomplete normalized identity records', () => {
		expect(isNormalizedAtomIdentity({ canonical: 'missing-fields' })).toBe(false);
		expect(
			isNormalizedAtomIdentity({
				raw: 'raw',
				canonical: 'canonical',
				scheme: 'scheme',
				value: 'value',
				profile: 'future-profile',
				anchorEligible: true,
				provenance,
			})
		).toBe(false);
		expect(
			isNormalizedAtomIdentity({
				raw: 'raw',
				canonical: 'canonical',
				scheme: 'scheme',
				value: 'value',
				class: 'unknown-class',
				anchorEligible: false,
				provenance,
			})
		).toBe(false);
	});

	test('accepts classification decisions and ordered provider plans', () => {
		expect(
			isIdentityClassificationDecision({
				status: 'classified',
				classificationSlug: 'music-recording',
				schemaType: 'MusicRecording',
				provenance,
			})
		).toBe(true);

		expect(
			isIdentityProviderPlan({
				status: 'planned',
				targets: [
					{
						provider: 'music-provider',
						capabilities: ['recording-metadata'],
						identifierHints: [{ kind: 'recording-code', value: 'fixture-value' }],
					},
				],
				provenance,
			})
		).toBe(true);
	});
});
