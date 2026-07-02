import type { AtomClassificationPlugin } from '../../plugins';
import { TYPE_PROFILES_PLUGIN_ID } from '../shared/constants';

const DEFAULT_URL_PLUGIN_ID = 'default-url';
const DEFAULT_URL_DOMAIN = 'web';
const DEFAULT_URL_SUBTYPE = 'website';

export function createDefaultUrlPlugin(): AtomClassificationPlugin {
	return {
		manifest: {
			id: DEFAULT_URL_PLUGIN_ID,
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['classify:url:web', 'resolve:url:web'],
			permissions: [],
			dependsOn: [TYPE_PROFILES_PLUGIN_ID],
			provides: ['url:web'],
			priority: 30,
		},
		classifiers: [
			{
				id: 'default-url-classifier',
				priority: 100,
				classify: (input) => {
					const canonicalUrl = normalizeHttpUrl(input);
					if (!canonicalUrl) {
						return null;
					}

					return {
						type: 'url',
						domain: DEFAULT_URL_DOMAIN,
						subtype: DEFAULT_URL_SUBTYPE,
						confidence: 0.72,
						meta: {
							canonicalUrl,
						},
					};
				},
			},
		],
		resolvers: [
			{
				id: 'default-url-resolver',
				priority: 90,
				executionMode: 'deterministic',
				canResolve: (classification) =>
					classification.type === 'url' &&
					classification.domain === DEFAULT_URL_DOMAIN &&
					classification.subtype === DEFAULT_URL_SUBTYPE,
				resolve: ({ classification, request, now }) => {
					const canonicalUrl =
						toStringMaybe(classification.meta.canonicalUrl) ??
						normalizeHttpUrl(request.input) ??
						request.input.trim();
					const parsed = tryParseHttpUrl(canonicalUrl);
					const displayHost = parsed?.hostname.replace(/^www\./i, '') ?? canonicalUrl;
					const name = `Website ${displayHost}`;

					return {
						fallbackUsed: true,
						atoms: [
							{
								schemaType: 'WebSite',
								category: 'thing',
								title: name,
								canonicalId: canonicalUrl,
								sameAs: [canonicalUrl],
								data: {
									'@context': 'https://schema.org/',
									'@type': 'WebSite',
									name,
									url: canonicalUrl,
									sameAs: [canonicalUrl],
								},
								metadata: {
									pluginId: DEFAULT_URL_PLUGIN_ID,
									provider: DEFAULT_URL_PLUGIN_ID,
									fetchedAt: now,
									sourceUrl: canonicalUrl,
									confidence: classification.confidence,
								},
							},
						],
					};
				},
			},
		],
	};
}

function normalizeHttpUrl(input: string): string | undefined {
	const candidate = sanitizeUrlLikeInput(input);
	if (!candidate) {
		return undefined;
	}

	const parsed = tryParseHttpUrl(candidate) ?? tryParseBareHttpUrl(candidate);
	if (!parsed) {
		return undefined;
	}

	parsed.hash = '';
	return parsed.toString().replace(/\/$/, '');
}

function tryParseHttpUrl(input: string): URL | null {
	try {
		const parsed = new URL(input.trim());
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}

		return parsed;
	} catch {
		return null;
	}
}

function tryParseBareHttpUrl(input: string): URL | null {
	if (!isLikelyBareHttpUrl(input)) {
		return null;
	}

	try {
		return new URL(`https://${input}`);
	} catch {
		return null;
	}
}

function isLikelyBareHttpUrl(value: string): boolean {
	if (value.length === 0 || /\s/.test(value) || value.includes('@') || value.includes('://')) {
		return false;
	}

	const [authority] = value.split(/[/?#]/, 1);
	const host = authority ? stripPort(authority) : undefined;
	if (!host || host.startsWith('.') || host.endsWith('.')) {
		return false;
	}

	if (hasKnownFileLikeExtension(host)) {
		return false;
	}

	return host === 'localhost' || isIPv4Address(host) || isDnsHostname(host);
}

function sanitizeUrlLikeInput(input: string): string | undefined {
	const trimmed = input.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	return trimTrailingUrlPunctuation(trimmed);
}

function trimTrailingUrlPunctuation(value: string): string {
	let result = value;
	while (result.length > 0) {
		const lastCharacter = result.at(-1);
		if (!lastCharacter) {
			break;
		}

		if (TRAILING_SENTENCE_PUNCTUATION.has(lastCharacter)) {
			result = result.slice(0, -1);
			continue;
		}

		const openCharacter = CLOSING_TO_OPENING_PUNCTUATION[lastCharacter];
		if (!openCharacter) {
			break;
		}

		const openCount = countCharacter(result, openCharacter);
		const closeCount = countCharacter(result, lastCharacter);
		if (closeCount > openCount) {
			result = result.slice(0, -1);
			continue;
		}

		break;
	}

	return result;
}

function stripPort(authority: string): string | undefined {
	const colonIndex = authority.lastIndexOf(':');
	if (colonIndex === -1) {
		return authority;
	}

	const host = authority.slice(0, colonIndex);
	const port = authority.slice(colonIndex + 1);
	if (!host || !/^\d+$/.test(port)) {
		return undefined;
	}

	return host;
}

function isDnsHostname(value: string): boolean {
	return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
}

function isIPv4Address(value: string): boolean {
	const segments = value.split('.');
	if (segments.length !== 4) {
		return false;
	}

	return segments.every((segment) => {
		if (!/^\d{1,3}$/.test(segment)) {
			return false;
		}

		const numericValue = Number.parseInt(segment, 10);
		return numericValue >= 0 && numericValue <= 255;
	});
}

function hasKnownFileLikeExtension(value: string): boolean {
	const lastDotIndex = value.lastIndexOf('.');
	if (lastDotIndex === -1 || lastDotIndex === value.length - 1) {
		return false;
	}

	const extension = value.slice(lastDotIndex + 1).toLowerCase();
	return KNOWN_FILE_LIKE_EXTENSIONS.has(extension);
}

function countCharacter(value: string, character: string): number {
	let count = 0;
	for (const currentCharacter of value) {
		if (currentCharacter === character) {
			count += 1;
		}
	}

	return count;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

const TRAILING_SENTENCE_PUNCTUATION = new Set(['.', ',', '!', '?', ';', ':']);

const CLOSING_TO_OPENING_PUNCTUATION: Record<string, string | undefined> = {
	')': '(',
	']': '[',
	'}': '{',
};

const KNOWN_FILE_LIKE_EXTENSIONS = new Set([
	'cjs',
	'conf',
	'config',
	'css',
	'csv',
	'env',
	'html',
	'ini',
	'js',
	'json',
	'jsx',
	'lock',
	'log',
	'md',
	'mjs',
	'scss',
	'toml',
	'ts',
	'tsx',
	'txt',
	'xml',
	'yaml',
	'yml',
]);
