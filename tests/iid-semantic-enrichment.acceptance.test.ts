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
const publicPackagesAvailable = existsSync(iidEntry) && existsSync(registryEntry);
const describeWithPublicPackages = publicPackagesAvailable ? describe : describe.skip;

const PACKAGE_VERSION = '0.1.0-alpha.0';
const NOW = '2026-08-12T12:00:00.000Z';

describeWithPublicPackages('canonical IID semantic enrichment acceptance', () => {
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
	const classification = deriveIidClassificationResult({
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
