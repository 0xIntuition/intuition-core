import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	createEnrichmentEngine,
	createIdentifierProviderPlan,
	createMusicBrainzPlugin,
	createOpenLibraryPlugin,
	type EnrichmentPlugin,
	type EnrichmentRequest,
} from '../packages/atom-enrichment/src';
import type { FetchLike } from '../packages/atom-enrichment/src/plugins/providers';
import { deriveIidClassificationResult } from '../services/workers/src/core/classification';
import { evaluateEnrichmentCompletion } from '../services/workers/src/core/enrichment';
import {
	createIidInspectionAdapter,
	type PublicIidInspection,
	parseAtomWithIidRead,
} from '../services/workers/src/core/iid-inspection';
import {
	createIidLadderAdapter,
	type PublicIidLadderModule,
} from '../services/workers/src/core/iid-ladder';
import {
	createIidRegistryAdapter,
	type PublicIidClassification,
} from '../services/workers/src/core/iid-registry';

type PublicIidModule = {
	inspectIntuitionId(input: string): PublicIidInspection;
};

type PublicRegistryModule = {
	classificationForIid(iid: string): PublicIidClassification | undefined;
	providersForIid(iid: string): readonly string[];
	identifierHintsForIid(iid: string): Record<string, string>;
};

const packagesRepository = process.env.INTUITION_PACKAGES_REPO
	? resolve(process.env.INTUITION_PACKAGES_REPO)
	: resolve(import.meta.dir, '../../packages');
const iidEntry = join(packagesRepository, 'packages/iid/dist/index.js');
const registryEntry = join(packagesRepository, 'packages/iid-registry/dist/index.js');
const ladderEntry = join(packagesRepository, 'packages/iid-ladder/dist/index.js');
const publicPackagesAvailable =
	existsSync(iidEntry) && existsSync(registryEntry) && existsSync(ladderEntry);
const describeWithPublicPackages = publicPackagesAvailable ? describe : describe.skip;

const PACKAGE_VERSION = '0.1.0-alpha.0';
const NOW = '2026-08-12T12:00:00.000Z';

describeWithPublicPackages('canonical IID semantic enrichment acceptance', () => {
	test.each([
		['MusicAlbum', 'int:gtin:00012345678905'],
		['PodcastSeries', 'int:wd:film:Q83495'],
	])('finding 1: real module rejects alias primary for %s', async (schemaType, iid) => {
		const adapter = await realLadder();
		const publicIid = await importModule<PublicIidModule>(iidEntry);
		const inspected = publicIid.inspectIntuitionId(iid);
		if (!inspected.valid) throw new Error('Invalid acceptance fixture');
		for (const input of [
			{
				schemaType,
				providerCanonicalId: iid,
				...(schemaType === 'MusicAlbum' ? { identifiers: { gtin: '00012345678905' } } : {}),
			},
			{
				schemaType,
				identity: {
					raw: iid,
					canonical: iid,
					scheme: inspected.scheme,
					value: inspected.value,
					anchorEligible: inspected.anchorEligible,
					provenance: { producer: 'probe', version: '1' },
				},
			},
		]) {
			const result = adapter.projectIdentityRungs(input);
			expect(result.primary).toBeUndefined();
			expect(result.rungs).toContainEqual(expect.objectContaining({ iid, aliasOnly: true }));
			expect(result.rungs.some((entry) => entry.iid === iid && !entry.aliasOnly)).toBe(false);
		}
	});
	test('finding 2: real canonical URL provider and inspected identity cannot mint', async () => {
		const adapter = await realLadder();
		const iid = 'int:url:https://example.com/book';
		for (const input of [
			{ schemaType: 'Book', providerCanonicalId: iid },
			{
				schemaType: 'Book',
				identity: {
					raw: iid,
					canonical: iid,
					scheme: 'url',
					value: 'https://example.com/book',
					anchorEligible: false,
					provenance: { producer: 'probe', version: '1' },
				},
			},
		]) {
			const result = adapter.projectIdentityRungs(input);
			expect(result.primary).toBeUndefined();
			expect(result.rungs).toEqual([]);
		}
	});
	test('finding 3: real inspection denies plain WD with missing legacy typing', async () => {
		const adapter = await realLadder();
		const identity = {
			raw: 'int:wd:Q42',
			canonical: 'int:wd:Q42',
			scheme: 'wd',
			value: 'Q42',
			anchorEligible: false,
			provenance: { producer: 'probe', version: '1' },
		};
		expect(adapter.projectIdentityRungs({ schemaType: 'Movie', identity }).primary).toBeUndefined();
		expect(adapter.projectIdentityRungs({ schemaType: 'MusicGroup', identity }).primary?.iid).toBe(
			identity.canonical
		);
		expect(
			adapter.projectIdentityRungs({
				schemaType: 'Movie',
				identity: { ...identity, canonical: 'int:wd:film:Q83495', value: 'film:Q83495' },
			}).primary?.iid
		).toBe('int:wd:film:Q83495');
	});
	test('ISRC inspection preserves open-first provider order and executes MusicBrainz by ISRC', async () => {
		let requestedUrl = '';
		const musicbrainz = createMusicBrainzPlugin({
			fetch: jsonFetch(
				{
					recordings: [
						{
							id: '0c8c75d9-98d7-4c9f-a6d8-37ea8768cc91',
							title: 'Shape of You',
							isrcs: ['USUM71703861'],
							'artist-credit': [{ name: 'Ed Sheeran' }],
						},
					],
				},
				200,
				(url) => {
					requestedUrl = url;
				}
			),
		});
		const semantic = await inspectAndPlan('int:isrc:USUM71703861', [musicbrainz]);

		expect(semantic.identity.canonical).toBe('int:isrc:USUM71703861');
		expect(semantic.classification.identityRungs?.primary?.iid).toBe('int:isrc:USUM71703861');
		expect(semantic.classification).toMatchObject({
			status: 'recognized',
			source: 'iid-registry',
			schemaType: 'MusicRecording',
		});
		expect(semantic.registryProviders).toEqual(['musicbrainz', 'spotify', 'apple-music']);
		expect(semantic.executionPlan.entries).toMatchObject([
			{ providerSlug: 'musicbrainz', ordinal: 0, disposition: 'execute' },
			{ providerSlug: 'spotify', ordinal: 1, disposition: 'retry' },
			{ providerSlug: 'apple-music', ordinal: 2, disposition: 'retry' },
		]);
		expect(semantic.executionPlan.identifiers).toEqual({ isrc: 'USUM71703861' });

		const result = await semantic.engine.enrich(semantic.request);

		expect(requestedUrl).toContain('query=isrc%3AUSUM71703861');
		expect(result.errors).toEqual([]);
		expect(result.artifacts).toMatchObject([
			{
				artifact_type: 'musicbrainz',
				data: {
					name: 'Shape of You',
					isrcs: ['USUM71703861'],
				},
			},
		]);
		expect(evaluateEnrichmentCompletion(result)).toEqual({ kind: 'complete' });
	});

	test('ISBN inspection plans OpenLibrary and executes the canonical Books API lookup', async () => {
		let requestedUrl = '';
		const openlibrary = createOpenLibraryPlugin({
			fetch: jsonFetch(
				{
					'ISBN:9780684832722': {
						key: '/books/OL7721520M',
						title: 'The Sovereign Individual',
						authors: [{ name: 'James Dale Davidson' }, { name: 'William Rees-Mogg' }],
						publishers: [{ name: 'Scribner' }],
					},
				},
				200,
				(url) => {
					requestedUrl = url;
				}
			),
		});
		const semantic = await inspectAndPlan('int:isbn:9780684832722', [openlibrary]);

		expect(semantic.identity.canonical).toBe('int:isbn:9780684832722');
		expect(semantic.classification.identityRungs?.primary?.iid).toBe('int:isbn:9780684832722');
		expect(semantic.classification).toMatchObject({
			status: 'recognized',
			source: 'iid-registry',
			schemaType: 'Book',
		});
		expect(semantic.registryProviders).toEqual(['openlibrary']);
		expect(semantic.executionPlan).toMatchObject({
			complete: true,
			identifiers: { isbn: '9780684832722' },
			plugins: ['openlibrary'],
			entries: [{ providerSlug: 'openlibrary', ordinal: 0, disposition: 'execute' }],
		});

		const result = await semantic.engine.enrich(semantic.request);

		expect(requestedUrl).toContain('bibkeys=ISBN%3A9780684832722');
		expect(result.errors).toEqual([]);
		expect(result.artifacts).toMatchObject([
			{
				artifact_type: 'openlibrary',
				data: {
					isbn: '9780684832722',
					olid: 'OL7721520M',
					title: 'The Sovereign Individual',
				},
			},
		]);
		expect(evaluateEnrichmentCompletion(result)).toEqual({ kind: 'complete' });
	});

	test('respects R16 provider-local hold for Spotify albums and retains GTIN aliases', async () => {
		const adapter = await realLadder();
		const projection = adapter.projectIdentityRungs({
			schemaType: 'MusicAlbum',
			providerCanonicalId: 'spotify:album:4LH4d3cOWNNsVw41Gqt2kv',
			identifiers: { gtin: '00012345678905' },
		});
		expect(projection.primary).toBeUndefined();
		expect(projection.rungs.some(({ iid }) => iid?.startsWith('int:spotify:'))).toBe(false);
		expect(projection.rungs.some(({ rung }) => rung === 'mbid:release-group')).toBe(false);
		expect(projection.rungs).toContainEqual(
			expect.objectContaining({ rung: 'gtin', aliasOnly: true })
		);
	});

	test('distinguishes retryable provider failure from terminal no-match and bad capability', async () => {
		const retryable = await inspectAndPlan('int:isbn:9780684832722', [
			createOpenLibraryPlugin({ fetch: jsonFetch({}, 503) }),
		]);
		const retryResult = await retryable.engine.enrich(retryable.request);
		expect(retryResult.errors).toMatchObject([
			{ pluginId: 'openlibrary', code: 'upstream_error', retriable: true },
		]);
		expect(evaluateEnrichmentCompletion(retryResult).kind).toBe('retryable_failure');

		const terminal = await inspectAndPlan('int:isbn:9780684832722', [
			createOpenLibraryPlugin({ fetch: jsonFetch({}, 404) }),
		]);
		const terminalResult = await terminal.engine.enrich(terminal.request);
		expect(terminalResult).toMatchObject({ artifacts: [], errors: [] });
		expect(evaluateEnrichmentCompletion(terminalResult).kind).toBe('terminal_unresolved');

		const invalidCapability = createIdentifierProviderPlan({
			providers: ['openlibrary', 'future-provider', 'openlibrary'],
			identifiers: { isbn: '9780684832722' },
			registeredPluginIds: ['openlibrary'],
		});
		expect(invalidCapability.entries).toMatchObject([
			{ disposition: 'execute' },
			{ disposition: 'terminal', reason: 'unknown_provider_slug' },
			{ disposition: 'terminal', reason: 'duplicate_provider_slug' },
		]);
	});
});

async function realLadder() {
	const module = await importModule<PublicIidLadderModule>(ladderEntry);
	const publicIid = await importModule<PublicIidModule>(iidEntry);
	return createIidLadderAdapter(
		{ ...module, packageVersion: PACKAGE_VERSION },
		{ inspect: publicIid.inspectIntuitionId }
	);
}

async function inspectAndPlan(iid: string, plugins: EnrichmentPlugin[]) {
	const publicIid = await importModule<PublicIidModule>(iidEntry);
	const publicRegistry = await importModule<PublicRegistryModule>(registryEntry);
	const inspectionAdapter = createIidInspectionAdapter({
		inspectIntuitionId: publicIid.inspectIntuitionId,
		packageVersion: PACKAGE_VERSION,
	});
	const parsed = await parseAtomWithIidRead({
		rawInput: iid,
		iidReadEnabled: true,
		adapter: inspectionAdapter,
		parseLegacy: () => {
			throw new Error('canonical acceptance input unexpectedly took the legacy parser path');
		},
	});
	if (!parsed.result.identity) {
		throw new Error(`public IID inspection did not produce identity for ${iid}`);
	}

	const registryAdapter = createIidRegistryAdapter({
		classificationForIid: publicRegistry.classificationForIid,
		providersForIid: publicRegistry.providersForIid,
		identifierHintsForIid: publicRegistry.identifierHintsForIid,
		packageVersion: PACKAGE_VERSION,
	});
	const resolution = registryAdapter.resolve(parsed.result.identity);
	const module = await importModule<PublicIidLadderModule>(ladderEntry);
	const classification = deriveIidClassificationResult({
		ladder: createIidLadderAdapter(
			{ ...module, packageVersion: PACKAGE_VERSION },
			{ inspect: publicIid.inspectIntuitionId }
		),
		identity: parsed.result.identity,
		resolution,
	});
	const registryProviders = resolution.providerPlan.targets.map(({ provider }) => provider);
	const identifiers = Object.fromEntries(
		(resolution.providerPlan.targets[0]?.identifierHints ?? []).map(({ kind, value }) => [
			kind,
			value,
		])
	);
	const engine = createEnrichmentEngine({ plugins, now: () => NOW });
	const executionPlan = createIdentifierProviderPlan({
		providers: registryProviders,
		identifiers,
		registeredPluginIds: engine.listPlugins().map(({ id }) => id),
	});
	const request: EnrichmentRequest = {
		input: {
			atomType: classification.schemaType === 'MusicRecording' ? 'song' : 'thing',
			jsonLd: {
				'@context': 'https://schema.org',
				'@type': classification.schemaType ?? 'Thing',
			},
			hints: { identifiers: executionPlan.identifiers },
			source: {
				classificationEngine: 'iid-semantic-acceptance',
				classifiedAt: NOW,
			},
		},
		runtime: 'server',
		plugins: executionPlan.plugins,
	};

	return {
		identity: parsed.result.identity,
		classification,
		registryProviders,
		executionPlan,
		engine,
		request,
	};
}

async function importModule<T>(entry: string): Promise<T> {
	return (await import(pathToFileURL(entry).href)) as T;
}

function jsonFetch(body: unknown, status = 200, inspect?: (url: string) => void): FetchLike {
	return async (url) => {
		inspect?.(url);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	};
}
