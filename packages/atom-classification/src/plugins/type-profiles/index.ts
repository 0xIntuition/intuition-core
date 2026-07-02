import { z } from 'zod/v4';

import type { AtomClassificationPlugin } from '../../plugins';
import type { JsonLdTypeCategory } from '../../type-registry';
import { TYPE_PROFILES_PLUGIN_ID } from '../shared/constants';

type BuiltinTypeDefinition = {
	type: string;
	category: JsonLdTypeCategory;
	schema: z.ZodType;
	requiredFields: string[];
	recommendedFields: string[];
	identityFields: string[];
	aliases?: string[];
};

export function createTypeProfilesPlugin(): AtomClassificationPlugin {
	return {
		manifest: {
			id: TYPE_PROFILES_PLUGIN_ID,
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['type:register:v0'],
			permissions: [],
			dependsOn: [],
			provides: ['types:v0-profiles'],
			priority: 1,
		},
		registerTypes(registry) {
			for (const definition of TYPE_DEFINITIONS) {
				registry.register(definition);
			}
		},
	};
}

export const createV0TypeProfilesPlugin = createTypeProfilesPlugin;

const TYPE_DEFINITIONS: BuiltinTypeDefinition[] = [
	createTypeDefinition(
		'Thing',
		'thing',
		['name'],
		['description', 'sameAs'],
		['identifier', 'sameAs']
	),
	createTypeDefinition('Person', 'person', ['name'], ['description', 'sameAs'], ['sameAs']),
	createTypeDefinition('Place', 'place', ['name'], ['address', 'sameAs'], ['sameAs']),
	createTypeDefinition(
		'Organization',
		'company',
		['name'],
		['url', 'sameAs'],
		['identifier', 'sameAs']
	),
	createTypeDefinition(
		'Product',
		'product',
		['name'],
		['brand', 'offers', 'sameAs'],
		['gtin', 'sku']
	),
	createTypeDefinition('MusicRecording', 'song', ['name'], ['byArtist', 'inAlbum'], ['sameAs']),
	createTypeDefinition('MusicAlbum', 'song', ['name'], ['byArtist', 'sameAs'], ['sameAs']),
	createTypeDefinition('MusicGroup', 'song', ['name'], ['sameAs'], ['sameAs']),
	createTypeDefinition(
		'PodcastSeries',
		'podcast',
		['name'],
		['description', 'publisher', 'url', 'sameAs'],
		['url', 'sameAs']
	),
	createTypeDefinition(
		'PodcastEpisode',
		'podcast',
		['name'],
		['description', 'partOfSeries', 'datePublished', 'url', 'sameAs'],
		['url', 'sameAs']
	),
	createTypeDefinition(
		'SoftwareApplication',
		'software',
		['name'],
		['applicationCategory', 'operatingSystem', 'sameAs'],
		['sameAs']
	),
	createTypeDefinition(
		'SocialMediaPosting',
		'thing',
		['name'],
		['datePublished', 'author', 'sameAs'],
		['sameAs']
	),
	createTypeDefinition('ImageObject', 'thing', ['name'], ['contentUrl', 'sameAs'], ['sameAs']),
	createTypeDefinition('VideoObject', 'thing', ['name'], ['contentUrl', 'sameAs'], ['sameAs']),
	createTypeDefinition('WebSite', 'thing', ['name'], ['url', 'sameAs'], ['url', 'sameAs']),
	createTypeDefinition('Movie', 'thing', ['name'], ['datePublished', 'sameAs'], ['sameAs']),
	createTypeDefinition('TVSeries', 'thing', ['name'], ['sameAs'], ['sameAs']),
	createTypeDefinition('Book', 'thing', ['name'], ['isbn', 'sameAs'], ['isbn']),
	createTypeDefinition(
		'DefinedTerm',
		'thing',
		['name'],
		['description', 'sameAs'],
		['termCode', 'sameAs']
	),
	createTypeDefinition(
		'SoftwareSourceCode',
		'software',
		['name'],
		['codeRepository', 'sameAs'],
		['sameAs']
	),
	{
		type: 'SocialMediaAccount',
		category: 'person',
		schema: z
			.object({
				'@context': z.enum(['https://schema.org', 'https://schema.org/']).optional(),
				'@type': z.literal('SocialMediaAccount').optional(),
				username: z.string().min(1),
				platform: z.string().min(1),
				url: z.string().min(1).optional(),
			})
			.passthrough(),
		requiredFields: ['username', 'platform'],
		recommendedFields: ['url'],
		identityFields: ['username', 'platform'],
	},
	{
		type: 'EthereumAccount',
		category: 'thing',
		schema: z
			.object({
				address: z.string().min(1),
				chainId: z.union([z.string(), z.number()]).optional(),
			})
			.passthrough(),
		requiredFields: ['address'],
		recommendedFields: ['chainId'],
		identityFields: ['address'],
	},
	{
		type: 'EthereumSmartContract',
		category: 'thing',
		schema: z
			.object({
				address: z.string().min(1),
				chainId: z.union([z.string(), z.number()]).optional(),
			})
			.passthrough(),
		requiredFields: ['address'],
		recommendedFields: ['chainId'],
		identityFields: ['address', 'chainId'],
	},
	{
		type: 'EthereumERC20',
		category: 'product',
		schema: z
			.object({
				address: z.string().min(1),
				chainId: z.union([z.string(), z.number()]).optional(),
				name: z.string().min(1).optional(),
				symbol: z.string().min(1).optional(),
				decimals: z.union([z.string(), z.number()]).optional(),
			})
			.passthrough(),
		requiredFields: ['address', 'chainId'],
		recommendedFields: ['name', 'symbol', 'decimals'],
		identityFields: ['address', 'chainId', 'symbol'],
	},
];

function createTypeDefinition(
	type: string,
	category: JsonLdTypeCategory,
	requiredFields: string[],
	recommendedFields: string[],
	identityFields: string[]
): BuiltinTypeDefinition {
	return {
		type,
		category,
		schema: z
			.object({
				'@context': z.enum(['https://schema.org', 'https://schema.org/']).optional(),
				'@type': z.literal(type).optional(),
				name: z.string().min(1),
				description: z.string().optional(),
				sameAs: z.array(z.string().min(1)).optional(),
			})
			.passthrough(),
		requiredFields,
		recommendedFields,
		identityFields,
	};
}
