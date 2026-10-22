import { describe, expect, it } from 'bun:test';
import { CLASSIFICATION_SPECS, getClassification } from '@0xintuition/classifications';
import * as chaining from '../src/extraction/chaining';
import * as direct from '../src/extraction/direct-providers';
import * as extraction from '../src/extraction/index';
import type { ExtractedField, ExtractionContext } from '../src/extraction/types';
import { createMockArtifact } from '../src/testing';
import type { EnrichmentArtifact } from '../src/types';

const inputUrl = 'https://example.com/input';
const noFetch = () => Promise.reject(new Error('unexpected network request'));
const directFunctions: Record<string, unknown> = Object.fromEntries(Object.entries(direct));
type Strength = 'title' | 'identifier' | 'url' | undefined;

function artifact(type: string, data: Record<string, unknown>, ...strength: [Strength?]) {
	const result = createMockArtifact({ artifact_type: type, data });
	// Legacy controls actually omit the property.
	const value = strength.length === 0 ? 'title' : strength[0];
	if (value !== undefined) result.meta.identityStrength = value;
	return result;
}

function context(artifacts: EnrichmentArtifact[], classification = 'thing'): ExtractionContext {
	const spec = getClassification(classification);
	if (!spec) throw new Error(`missing fixture spec ${classification}`);
	return { spec, url: inputUrl, artifacts, fetcher: noFetch, language: 'en' };
}

const podcastCases: Array<{
	name: string;
	type: string;
	data: Record<string, unknown>;
	identifiers: Record<string, string>;
	pluginSlugs: string[];
}> = [
	{
		name: 'Spotify show',
		type: 'spotify',
		data: {
			name: 'Wrong podcast',
			publisher: 'Wrong publisher',
			type: 'show',
			spotifyId: '12345678',
			spotifyUrl: 'https://open.spotify.com/show/12345678',
		},
		identifiers: { itunesPodcastSearch: 'Wrong podcast|Wrong publisher' },
		pluginSlugs: ['apple-music'],
	},
	{
		name: 'Spotify episode',
		type: 'spotify',
		data: {
			name: 'Wrong episode',
			showName: 'Wrong podcast',
			publisher: 'Wrong publisher',
			type: 'episode',
			spotifyId: '12345678',
			spotifyUrl: 'https://open.spotify.com/episode/12345678',
		},
		identifiers: { itunesPodcastSearch: 'Wrong podcast|Wrong publisher' },
		pluginSlugs: ['apple-music'],
	},
	{
		name: 'Apple podcast with feed',
		type: 'apple-music',
		data: {
			name: 'Wrong podcast',
			type: 'podcast',
			appleMusicId: '360084272',
			appleMusicUrl: 'https://podcasts.apple.com/us/podcast/wrong/id360084272',
			feedUrl: 'https://example.com/wrong.xml',
		},
		identifiers: { feedUrl: 'https://example.com/wrong.xml' },
		pluginSlugs: ['podcast-index'],
	},
	{
		name: 'Apple podcast without feed',
		type: 'apple-music',
		data: {
			name: 'Wrong podcast',
			type: 'podcast',
			appleMusicId: '360084272',
			appleMusicUrl: 'https://podcasts.apple.com/us/podcast/wrong/id360084272',
		},
		identifiers: { itunesId: '360084272' },
		pluginSlugs: ['podcast-index'],
	},
	{
		name: 'Podcast Index',
		type: 'podcast-index',
		data: {
			title: 'Wrong podcast',
			podcastIndexId: 920666,
			feedUrl: 'https://example.com/wrong.xml',
			itunesId: 360084272,
		},
		identifiers: { itunesId: '360084272' },
		pluginSlugs: ['apple-music'],
	},
];

const pageCases = [
	{ classification: 'book', type: 'Book', identity: { isbn: '9780143111580' } },
	{
		classification: 'product',
		type: 'Product',
		identity: { sku: 'WRONG-SKU', gtin: '0012345678901' },
	},
	{
		classification: 'software',
		type: 'SoftwareSourceCode',
		identity: { codeRepository: 'https://github.com/wrong/repo' },
	},
];

describe('title-strength quarantine review regressions', () => {
	for (const strength of ['title', 'identifier', 'url', undefined] as const) {
		for (const probe of podcastCases) {
			it(`${probe.name} augmentation respects ${strength ?? 'legacy'}`, () => {
				expect(
					extraction.harvestAugmentationLookups([artifact(probe.type, probe.data, strength)])
				).toEqual(
					strength === 'title'
						? { identifiers: {}, pluginSlugs: [] }
						: {
								identifiers: probe.identifiers,
								pluginSlugs: probe.pluginSlugs,
							}
				);
			});
		}
		it(`Wikipedia pivot respects ${strength ?? 'legacy'}`, () => {
			const wiki = artifact(
				'wikipedia',
				{
					title: 'Dune',
					extract: 'A movie',
					language: 'en',
					pageUrl: 'https://en.wikipedia.org/wiki/Dune_(2021_film)',
					wikibaseItem: 'Q1',
				},
				strength
			);
			expect(extraction.readWikibaseItemFromArtifacts([wiki])).toBe(
				strength === 'title' ? undefined : 'Q1'
			);
			expect(chaining.hasWikipediaPivot([wiki])).toBe(strength !== 'title');
		});
		for (const probe of pageCases) {
			it(`${probe.type} spec identities respect ${strength ?? 'legacy'}`, async () => {
				const page = artifact(
					'microdata',
					{
						url: inputUrl,
						jsonLd: [
							{
								'@type': probe.type,
								name: 'Wrong entity',
								description: 'Still descriptive',
								...probe.identity,
							},
						],
					},
					strength
				);
				const result = await extraction.extractClassificationFields({
					classification: probe.classification,
					url: inputUrl,
					artifacts: [page],
					fetcher: noFetch,
				});
				expect(result.values.name).toBe('Wrong entity');
				for (const [key, value] of Object.entries(probe.identity)) {
					expect(result.values[key]).toBe(strength === 'title' ? undefined : value);
				}
				expect(result.values.sameAs).toEqual([inputUrl]);
			});
		}
	}

	it('a title Wikipedia pivot cannot shadow later strong evidence', () => {
		const data = { title: 'Dune', extract: 'A movie', language: 'en', pageUrl: inputUrl };
		expect(
			extraction.readWikibaseItemFromArtifacts([
				artifact('wikipedia', { ...data, wikibaseItem: 'Q1' }),
				artifact('wikipedia', { ...data, wikibaseItem: 'Q2' }, 'identifier'),
			])
		).toBe('Q2');
	});

	it('title evidence cannot suppress an admissible peer lookup', () => {
		const spotify = podcastCases[0]!;
		const apple = podcastCases[2]!;
		expect(
			extraction.harvestAugmentationLookups([
				artifact(spotify.type, spotify.data, 'identifier'),
				artifact(apple.type, apple.data),
			])
		).toEqual({ identifiers: spotify.identifiers, pluginSlugs: spotify.pluginSlugs });
	});

	it('page-native entry point keeps descriptions and excludes future unknown identity keys', () => {
		const page = artifact('microdata', {
			url: inputUrl,
			jsonLd: [
				{
					'@type': 'Thing',
					name: 'Title name',
					description: 'Title description',
					image: 'https://example.com/image.jpg',
					futureProviderId: 'wrong-id',
				},
			],
		});
		const ctx = context([page]);
		ctx.spec = {
			...ctx.spec,
			fields: [
				...ctx.spec.fields,
				{
					key: 'image',
					label: 'Image',
					fieldType: 'url',
					required: false,
					description: 'Descriptive image',
				},
				{
					key: 'futureProviderId',
					label: 'Future provider ID',
					fieldType: 'string',
					required: false,
					description: 'Future identity',
				},
			],
		};
		const fields = Object.fromEntries(
			extraction.extractPageNativeFields(ctx).map((f) => [f.key, f.value])
		);
		expect(fields).toEqual({
			name: 'Title name',
			description: 'Title description',
			image: 'https://example.com/image.jpg',
		});
	});

	const directCases: Record<
		string,
		{ classification: string; type: string; data: Record<string, unknown> }
	> = {
		extractMusicFields: {
			classification: 'music-recording',
			type: 'spotify',
			data: {
				name: 'Wrong song',
				type: 'track',
				spotifyId: '12345678',
				spotifyUrl: 'https://open.spotify.com/track/12345678',
				artists: [{ name: 'Wrong artist', id: '123' }],
				albumName: 'Wrong album',
			},
		},
		extractVideoObjectFields: {
			classification: 'video-object',
			type: 'youtube',
			data: {
				videoId: '12345678',
				title: 'Wrong video',
				description: 'A description',
			},
		},
		extractPodcastFields: {
			classification: 'podcast-series',
			type: 'spotify',
			data: podcastCases[0]!.data,
		},
		extractSoftwareFields: {
			classification: 'software',
			type: 'github-repo',
			data: { owner: 'wrong', name: 'wrong', fullName: 'wrong/repo' },
		},
		extractSoftwareApplicationFields: {
			classification: 'software-application',
			type: 'npm-package',
			data: { name: 'wrong', version: '1.0.0', homepage: 'https://wrong.example.com' },
		},
		extractSocialMediaAccountFields: {
			classification: 'social-media-account',
			type: 'x-profile',
			data: { username: 'wrong' },
		},
		extractEthereumAccountFields: {
			classification: 'ethereum-account',
			type: 'etherscan',
			data: { address: `0x${'a'.repeat(40)}`, balance: '0', isContract: true },
		},
		extractEthereumContractFields: {
			classification: 'ethereum-smart-contract',
			type: 'etherscan',
			data: { address: `0x${'a'.repeat(40)}`, balance: '0', isContract: true },
		},
		extractEthereumErc20Fields: {
			classification: 'ethereum-erc20',
			type: 'etherscan',
			data: {
				address: `0x${'a'.repeat(40)}`,
				balance: '0',
				isContract: true,
				tokenName: 'Wrong token',
				tokenSymbol: 'BAD',
			},
		},
		extractPlacesBackedFields: {
			classification: 'location',
			type: 'places',
			data: {
				name: 'Wrong place',
				formattedAddress: 'Wrong address',
				phoneNumber: '555-0000',
				website: 'https://wrong.example.com',
			},
		},
	};
	for (const [name, probe] of Object.entries(directCases)) {
		it(`public ${name} excludes title identities`, () => {
			const ctx = context([artifact(probe.type, probe.data)], probe.classification);
			const fn = directFunctions[name] as (
				ctx: ExtractionContext,
				kind: 'series'
			) => ExtractedField[];
			const fields = fn(ctx, 'series');
			const forbidden = [
				'url',
				'sameAs',
				'codeRepository',
				'username',
				'address',
				'telephone',
				'symbol',
			];
			for (const field of fields) {
				if (forbidden.includes(field.key)) expect(field.value).toBe(inputUrl);
			}
		});
	}

	it('enumerates all direct-provider entry points and checks outputs against the allowlist', () => {
		const names = Object.entries(direct)
			.filter(([, value]) => typeof value === 'function')
			.map(([name]) => name);
		expect(names.sort()).toEqual(
			[...Object.keys(directCases), 'parseSocialAccountUrl', 'resolveExplorerChainId'].sort()
		);
		const descriptiveKeys: ReadonlySet<string> = new Set(
			extraction.TITLE_STRENGTH_DESCRIPTIVE_FIELDS
		);
		for (const name of names) {
			const probe = directCases[name];
			if (!probe) {
				// URL-only helpers do not read artifacts.
				expect(
					name === 'parseSocialAccountUrl'
						? direct.parseSocialAccountUrl(inputUrl)
						: direct.resolveExplorerChainId(inputUrl)
				).toBeUndefined();
				continue;
			}
			const fn = directFunctions[name] as (
				ctx: ExtractionContext,
				kind: 'series'
			) => ExtractedField[];
			const titleFields = fn(
				context([artifact(probe.type, probe.data)], probe.classification),
				'series'
			);
			for (const field of titleFields) {
				if (descriptiveKeys.has(field.key)) continue;
				// Identities derived solely from the caller's URL remain admissible.
				expect(field.source).toBe('input-url');
				expect(['url', 'contentUrl']).toContain(field.key);
				expect(field.value).toBe(inputUrl);
			}
			const strong = fn(
				context([artifact(probe.type, probe.data, 'identifier')], probe.classification),
				'series'
			);
			const legacy = fn(
				context([artifact(probe.type, probe.data, undefined)], probe.classification),
				'series'
			);
			expect(strong).toEqual(legacy);
			const byKey = Object.fromEntries(strong.map((field) => [field.key, field.value]));
			if (name === 'extractSoftwareFields')
				expect(byKey.codeRepository).toBe('https://github.com/wrong/repo');
			if (name === 'extractSocialMediaAccountFields') expect(byKey.username).toBe('wrong');
			if (name.startsWith('extractEthereum')) expect(byKey.address).toBe(`0x${'a'.repeat(40)}`);
		}
	});

	it('public artifact predicates and chaining cannot be satisfied or suppressed by a title hit', () => {
		const place = artifact('places', { name: 'Wrong place' });
		expect(chaining.hasResolvedPlace([place])).toBe(false);
		expect(chaining.hasResolvedPlace([artifact('places', place.data, 'identifier')])).toBe(true);
		const wiki = artifact('wikipedia', {
			title: 'Wrong',
			extract: 'Wrong',
			language: 'en',
			pageUrl: inputUrl,
			wikibaseItem: 'Q1',
		});
		expect(chaining.hasWikipediaPivot([wiki])).toBe(false);
		expect(
			extraction.harvestChainIdentifiers([
				artifact('wikidata', { entityId: 'Q1', label: 'Strong' }, 'identifier'),
				wiki,
			])
		).toEqual({ identifiers: {}, pluginSlugs: [] });
		const wikidata = artifact(
			'wikidata',
			{
				entityId: 'Q1',
				label: 'Strong',
				claims: { P4947: [{ mainsnak: { datavalue: { value: '438631' } } }] },
			},
			'identifier'
		);
		expect(extraction.harvestChainIdentifiers([wikidata, artifact('tmdb', {})])).toEqual({
			identifiers: { tmdb: 'movie:438631' },
			pluginSlugs: ['tmdb'],
		});
	});

	it('the allowlist excludes identities, contacts, codes and unknown keys', () => {
		const fields: ReadonlySet<string> = new Set(extraction.TITLE_STRENGTH_DESCRIPTIVE_FIELDS);
		for (const key of [
			'url',
			'sameAs',
			'identifier',
			'identifiers',
			'isbn',
			'gtin',
			'sku',
			'mpn',
			'codeRepository',
			'feedUrl',
			'itunesId',
			'wikibaseItem',
			'address',
			'telephone',
			'username',
			'symbol',
			'chainId',
			'contentUrl',
			'downloadUrl',
			'futureProviderId',
		])
			expect(fields.has(key)).toBe(false);
		for (const key of [
			'name',
			'description',
			'image',
			'datePublished',
			'genre',
			'inLanguage',
			'duration',
			'numberOfPages',
		])
			expect(fields.has(key)).toBe(true);
	});

	it('every classification spec admits only allowlisted title fields through both public mappers', async () => {
		const descriptive: ReadonlySet<string> = new Set(extraction.TITLE_STRENGTH_DESCRIPTIVE_FIELDS);
		for (const spec of Object.values(CLASSIFICATION_SPECS)) {
			const node: Record<string, unknown> = { '@type': spec.schema?.type ?? spec.type };
			for (const field of spec.fields) {
				node[field.key] =
					field.fieldType === 'url'
						? 'https://wrong.example.com/resource'
						: field.fieldType === 'string[]'
							? ['Wrong entity']
							: field.fieldType === 'integer' || field.fieldType === 'number'
								? 1
								: field.fieldType === 'iso-date'
									? '2026-01-01'
									: 'Wrong entity';
			}
			const page = artifact('microdata', { url: inputUrl, jsonLd: [node] });
			for (const field of extraction.extractPageNativeFields(context([page], spec.slug))) {
				expect(descriptive.has(field.key)).toBe(true);
			}
			const result = await extraction.extractClassificationFields({
				classification: spec.slug,
				url: inputUrl,
				artifacts: [page],
				fetcher: noFetch,
			});
			for (const field of Object.values(result.fields)) {
				if (descriptive.has(field.key)) continue;
				expect(field.source).toBe('input-url');
				expect(['url', 'sameAs']).toContain(field.key);
				expect(field.value).toEqual(field.key === 'sameAs' ? [inputUrl] : inputUrl);
			}
		}
	});

	it('enumerates every extraction-index function and requires an explicit probe adapter', async () => {
		const page = artifact('microdata', {
			url: inputUrl,
			jsonLd: [
				{
					'@type': 'Book',
					name: 'Wrong book',
					isbn: '9780143111580',
				},
			],
		});
		const ctx = context([page], 'book');
		const probes: Record<string, () => unknown | Promise<unknown>> = {
			extractClassificationFields: async () => {
				const result = await extraction.extractClassificationFields({
					classification: 'book',
					url: inputUrl,
					artifacts: [page],
					fetcher: noFetch,
				});
				expect(result.values.isbn).toBeUndefined();
				expect(result.values.sameAs).toEqual([inputUrl]);
			},
			extractPageNativeFields: () =>
				expect(extraction.extractPageNativeFields(ctx).map((f) => f.key)).toEqual(['name']),
			harvestAugmentationLookups: () =>
				expect(extraction.harvestAugmentationLookups([page])).toEqual({
					identifiers: {},
					pluginSlugs: [],
				}),
			mergeHarvests: () =>
				expect(
					extraction.mergeHarvests(
						extraction.harvestAugmentationLookups([page]),
						extraction.harvestChainIdentifiers([page])
					)
				).toEqual({ identifiers: {}, pluginSlugs: [] }),
			harvestChainIdentifiers: () =>
				expect(extraction.harvestChainIdentifiers([page])).toEqual({
					identifiers: {},
					pluginSlugs: [],
				}),
			readWikibaseItemFromArtifacts: () =>
				expect(extraction.readWikibaseItemFromArtifacts([page])).toBeUndefined(),
			getIdentityArtifacts: () => expect(extraction.getIdentityArtifacts([page])).toEqual([]),
			hasArtifactOfType: () =>
				expect(extraction.hasArtifactOfType([page], 'microdata')).toBe(false),
			suggestClassifications: () =>
				expect(extraction.suggestClassifications(inputUrl, [page])).toEqual([]),
			// Pure helpers take claims/nodes/URLs, never an artifact set. Feed no
			// evidence from the title artifact and check their normal empty behavior.
			pickPrimaryJsonLdType: () => expect(extraction.pickPrimaryJsonLdType([])).toBeUndefined(),
			readEntityIdClaimValues: () =>
				expect(extraction.readEntityIdClaimValues({}, 'P31')).toEqual([]),
			readTimeClaimValue: () => expect(extraction.readTimeClaimValue({}, 'P577')).toBeUndefined(),
			resolveWikidataEntityLabels: async () =>
				expect(await extraction.resolveWikidataEntityLabels(noFetch, [])).toEqual(new Map()),
			resolveUrlFirstClassification: () =>
				expect(extraction.resolveUrlFirstClassification('thing')?.slug).toBe('thing'),
			buildUrlFirstClassifiedAtomInput: () => {
				const classification = extraction.resolveUrlFirstClassification('thing');
				if (!classification) throw new Error('missing thing spec');
				expect(
					extraction.buildUrlFirstClassifiedAtomInput(
						classification,
						inputUrl,
						'2026-01-01T00:00:00.000Z'
					).jsonLd.sameAs
				).toEqual([inputUrl]);
			},
		};
		const names = Object.entries(extraction)
			.filter(([, value]) => typeof value === 'function')
			.map(([name]) => name);
		expect(names.sort()).toEqual(Object.keys(probes).sort());
		for (const name of names) await probes[name]?.();
	});
});
