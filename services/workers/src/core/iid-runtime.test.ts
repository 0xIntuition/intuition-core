import { describe, expect, test } from 'bun:test';
import { WorkerConfigurationError } from '../shared/errors';
import { composeIidWorkerAdapters } from './iid-runtime';

describe('IID worker runtime composition', () => {
	test('binds public module functions to exact installed manifest versions', () => {
		const adapters = composeIidWorkerAdapters({
			iid: {
				inspectIntuitionId: (iid) => ({
					valid: true,
					iid,
					scheme: 'isrc',
					value: 'USUM71703861',
					class: 'A',
					typing: 'unambiguous',
					anchorEligible: true,
				}),
			},
			iidManifest: { name: '@0xintuition/iid', version: '0.1.0-alpha.0' },
			iidRegistry: {
				classificationForIid: () => ({
					slug: 'music-recording',
					schemaType: 'MusicRecording',
					displayName: 'Music Recording',
					category: 'Media',
				}),
				providersForIid: () => ['musicbrainz', 'spotify'],
				identifierHintsForIid: () => ({ isrc: 'USUM71703861' }),
			},
			iidRegistryManifest: {
				name: '@0xintuition/iid-registry',
				version: '0.1.0-alpha.0',
			},
			iidSpecificationVersion: '@0xintuition/iid-spec@0.1.0-alpha.0',
		});

		const inspection = adapters.iidInspection.inspect('int:isrc:USUM71703861');
		expect(inspection.valid).toBe(true);
		expect(adapters.iidInspection.provenance).toEqual({
			producer: '@0xintuition/iid/inspectIntuitionId',
			version: '0.1.0-alpha.0',
			specificationVersion: '@0xintuition/iid-spec@0.1.0-alpha.0',
		});
		const resolution = adapters.iidRegistry.resolve({
			raw: 'int:isrc:USUM71703861',
			canonical: 'int:isrc:USUM71703861',
			scheme: 'isrc',
			value: 'USUM71703861',
			class: 'A',
			typing: 'unambiguous',
			anchorEligible: true,
			provenance: adapters.iidInspection.provenance,
		});
		expect(resolution).toMatchObject({
			identityDecision: {
				status: 'classified',
				classificationSlug: 'music-recording',
				provenance: { version: '0.1.0-alpha.0' },
			},
			providerPlan: {
				status: 'planned',
				targets: [{ provider: 'musicbrainz' }, { provider: 'spotify' }],
				provenance: { version: '0.1.0-alpha.0' },
			},
		});
	});

	test('rejects substituted manifests and non-exact runtime versions', () => {
		const compose = (overrides: { iidName?: string; iidVersion?: string; registryName?: string }) =>
			composeIidWorkerAdapters({
				iid: { inspectIntuitionId: () => ({ valid: false, reason: 'malformed' }) },
				iidManifest: {
					name: overrides.iidName ?? '@0xintuition/iid',
					version: overrides.iidVersion ?? '0.1.0-alpha.0',
				},
				iidRegistry: {
					classificationForIid: () => undefined,
					providersForIid: () => [],
					identifierHintsForIid: () => ({}),
				},
				iidRegistryManifest: {
					name: overrides.registryName ?? '@0xintuition/iid-registry',
					version: '0.1.0-alpha.0',
				},
				iidSpecificationVersion: '@0xintuition/iid-spec@0.1.0-alpha.0',
			});

		expect(() => compose({ iidName: '@attacker/iid' })).toThrow(WorkerConfigurationError);
		expect(() => compose({ registryName: '@attacker/registry' })).toThrow(WorkerConfigurationError);
		expect(() => compose({ iidVersion: '*' })).toThrow(WorkerConfigurationError);
		expect(() => compose({ iidVersion: 'workspace:*' })).toThrow(WorkerConfigurationError);
		expect(() => compose({ iidVersion: '^0.1.0' })).toThrow(WorkerConfigurationError);
	});
});
