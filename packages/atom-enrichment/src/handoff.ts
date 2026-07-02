import {
	extractAmazonAsinFromUrl,
	resolveAmazonMarketplace,
} from './plugins/providers/__shared__/amazon';
import type {
	AmazonTarget,
	ClassifiedAtomInput,
	ClassifiedAtomPolicy,
	ClassifiedAtomTargets,
	GitHubTarget,
	XTarget,
} from './types';

type ClassificationInputLike = {
	type?: string;
	domain?: string;
	subtype?: string;
	meta?: Record<string, unknown>;
};

type CanonicalEnvelopeLike = {
	type: string;
	data: Record<string, unknown>;
	meta: {
		sourceUrl?: string;
	};
};

type ResolvedAtomLike = {
	category: ClassifiedAtomInput['atomType'];
	schemaType: string;
	title: string;
	description?: string;
	canonicalId?: string;
	sameAs?: string[];
	data?: Record<string, unknown>;
};

export type ClassificationResultLike = {
	classification?: ClassificationInputLike;
	resolved?: {
		publishable?: CanonicalEnvelopeLike[];
		classifications?: CanonicalEnvelopeLike[];
		atoms?: ResolvedAtomLike[];
	};
};

type NormalizedResolvedClassificationInput = {
	atomType: ClassifiedAtomInput['atomType'];
	schemaType: string;
	name?: string;
	description?: string;
	canonicalId?: string;
	sameAs: string[];
	data: Record<string, unknown>;
};

export function toClassifiedAtomInput(
	rawInput: string,
	classificationResult: ClassificationResultLike
): ClassifiedAtomInput | null {
	const normalizedInput = normalizeResolvedClassificationInput(classificationResult);
	if (!normalizedInput) {
		return null;
	}

	const policy = resolveClassifiedAtomPolicy(rawInput, normalizedInput);
	const normalizedUrl = policy.allowUrlOnlyProviders
		? resolvePreferredEnrichmentUrl({
				rawInput,
				canonicalId: normalizedInput.canonicalId,
				sameAs: normalizedInput.sameAs,
			})
		: undefined;
	const targets = resolveProviderTargets(classificationResult, normalizedUrl);

	const hints: NonNullable<ClassifiedAtomInput['hints']> = {};
	if (normalizedInput.name && !isHttpUrl(normalizedInput.name)) {
		hints.name = normalizedInput.name;
	}
	if (normalizedInput.description) {
		hints.description = normalizedInput.description;
	}
	if (normalizedUrl) {
		hints.url = normalizedUrl;
	}

	const normalizedName =
		normalizedInput.name && !isHttpUrl(normalizedInput.name) ? normalizedInput.name : undefined;
	const jsonLdData = policy.allowUrlOnlyProviders
		? normalizedInput.data
		: omitUrlLikeFields(normalizedInput.data);

	return {
		atomType: normalizedInput.atomType,
		jsonLd: {
			'@context': 'https://schema.org',
			'@type': normalizedInput.schemaType,
			...(normalizedName ? { name: normalizedName } : {}),
			...(normalizedInput.description ? { description: normalizedInput.description } : {}),
			...(normalizedUrl ? { url: normalizedUrl } : {}),
			...jsonLdData,
		},
		source: {
			classificationEngine: '@0xintuition/atom-classification',
			classifiedAt: new Date().toISOString(),
		},
		...(Object.keys(hints).length > 0 ? { hints } : {}),
		...(targets ? { targets } : {}),
		policy,
	};
}

export function normalizeResolvedClassificationInput(
	classificationResult: ClassificationResultLike
): NormalizedResolvedClassificationInput | null {
	const canonical =
		classificationResult.resolved?.publishable?.[0] ??
		classificationResult.resolved?.classifications?.[0];
	if (canonical) {
		const data = toRecordMaybe(canonical.data) ?? {};
		const sameAs = collectSameAsUrls(data, canonical.meta.sourceUrl);
		return {
			atomType: resolveAtomTypeFromClassificationType(canonical.type),
			schemaType: canonical.type,
			name: resolveCanonicalName(data),
			description: resolveCanonicalDescription(data),
			canonicalId: resolveCanonicalIdFromCanonicalData(canonical.type, data, sameAs),
			sameAs,
			data,
		};
	}

	const atom = classificationResult.resolved?.atoms?.[0];
	if (!atom) {
		return null;
	}

	return {
		atomType: atom.category,
		schemaType: atom.schemaType,
		name: atom.title,
		description: atom.description,
		canonicalId: atom.canonicalId,
		sameAs: atom.sameAs ?? [],
		data: toRecordMaybe(atom.data) ?? {},
	};
}

export function resolveClassifiedAtomPolicy(
	rawInput: string,
	normalizedInput: Pick<NormalizedResolvedClassificationInput, 'atomType' | 'schemaType'>
): ClassifiedAtomPolicy {
	const rawInputKind = isHttpUrl(rawInput) ? 'url' : 'plain-text';
	const isPlainTextThing =
		rawInputKind === 'plain-text' &&
		normalizedInput.atomType === 'thing' &&
		normalizedInput.schemaType.trim().toLowerCase() === 'thing';

	return {
		rawInputKind,
		allowUrlOnlyProviders: !isPlainTextThing,
	};
}

export function resolvePreferredEnrichmentUrl(input: {
	rawInput: string;
	canonicalId?: string;
	sameAs?: string[];
}): string | undefined {
	const rawInputUrl = isHttpUrl(input.rawInput) ? input.rawInput : undefined;
	const canonicalIdUrl = isHttpUrl(input.canonicalId) ? input.canonicalId : undefined;
	const sameAsUrls = (input.sameAs ?? []).filter(isHttpUrl);

	if (!rawInputUrl) {
		return canonicalIdUrl ?? sameAsUrls[0];
	}

	const rawHostname = getHostname(rawInputUrl);
	if (!rawHostname) {
		return rawInputUrl;
	}

	const sameDomainCandidate = sameAsUrls.find(
		(candidate) => getHostname(candidate) === rawHostname
	);
	if (!sameDomainCandidate) {
		return rawInputUrl;
	}

	if (isCaseMutatedPathVariant(rawInputUrl, sameDomainCandidate)) {
		return rawInputUrl;
	}

	return sameDomainCandidate;
}

function resolveProviderTargets(
	classificationResult: ClassificationResultLike,
	fallbackCanonicalUrl?: string
): ClassifiedAtomTargets | undefined {
	const classification = classificationResult.classification;
	if (!classification) {
		return undefined;
	}

	const targets: ClassifiedAtomTargets = {};
	const canonicalUrl =
		toStringMaybe(classification.meta?.canonicalUrl) ?? fallbackCanonicalUrl ?? undefined;

	if (classification.domain === 'github') {
		const githubTarget = resolveGitHubTarget(classification, canonicalUrl);
		if (githubTarget) {
			targets.github = githubTarget;
		}
	}

	if (classification.domain === 'amazon') {
		const amazonTarget = resolveAmazonTarget(classification, canonicalUrl);
		if (amazonTarget) {
			targets.amazon = amazonTarget;
		}
	}

	if (classification.domain === 'x') {
		const xTarget = resolveXTarget(classification, canonicalUrl);
		if (xTarget) {
			targets.x = xTarget;
		}
	}

	return Object.keys(targets).length > 0 ? targets : undefined;
}

function resolveGitHubTarget(
	classification: ClassificationInputLike,
	canonicalUrl?: string
): GitHubTarget | undefined {
	if (classification.subtype === 'repo') {
		const owner = toStringMaybe(classification.meta?.owner);
		const repo = toStringMaybe(classification.meta?.repo);
		if (owner && repo) {
			return {
				kind: 'repo',
				owner,
				repo,
			};
		}
	}

	if (classification.subtype === 'profile') {
		const login = toStringMaybe(classification.meta?.login);
		if (login) {
			return {
				kind: 'user',
				login,
			};
		}
	}

	if (
		classification.subtype &&
		classification.subtype !== 'repo' &&
		classification.subtype !== 'profile'
	) {
		return undefined;
	}

	if (!canonicalUrl) {
		return undefined;
	}

	return parseGitHubTargetFromUrl(canonicalUrl);
}

function resolveAmazonTarget(
	classification: ClassificationInputLike,
	canonicalUrl?: string
): AmazonTarget | undefined {
	if (!canonicalUrl) {
		return undefined;
	}

	if (classification.subtype === 'product') {
		const asin = toStringMaybe(classification.meta?.asin) ?? extractAmazonAsinFromUrl(canonicalUrl);
		if (!asin) {
			return undefined;
		}

		return {
			kind: 'product',
			asin: asin.toUpperCase(),
			canonicalUrl,
			marketplace: resolveAmazonMarketplace(canonicalUrl),
		};
	}

	if (classification.subtype === 'store') {
		return {
			kind: 'storefront',
			canonicalUrl,
		};
	}

	return undefined;
}

function resolveXTarget(
	classification: ClassificationInputLike,
	canonicalUrl?: string
): XTarget | undefined {
	if (!canonicalUrl) {
		return undefined;
	}

	if (classification.subtype === 'profile') {
		const handle = normalizeXHandle(toStringMaybe(classification.meta?.handle));
		if (!handle) {
			return undefined;
		}

		return {
			kind: 'profile',
			handle,
			canonicalUrl,
		};
	}

	if (classification.subtype === 'post') {
		const postId = toStringMaybe(classification.meta?.postId);
		if (!postId) {
			return undefined;
		}

		return {
			kind: 'post',
			handle: normalizeXHandle(toStringMaybe(classification.meta?.handle)),
			postId,
			canonicalUrl,
		};
	}

	return undefined;
}

function parseGitHubTargetFromUrl(url: string): GitHubTarget | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
			return undefined;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length === 0) {
			return undefined;
		}

		const ownerOrLogin = sanitizeGitHubSegment(segments[0]);
		if (!ownerOrLogin) {
			return undefined;
		}

		if (segments.length >= 2) {
			const repo = sanitizeGitHubSegment(segments[1]);
			if (!repo) {
				return undefined;
			}

			return {
				kind: 'repo',
				owner: ownerOrLogin,
				repo,
			};
		}

		return {
			kind: 'user',
			login: ownerOrLogin,
		};
	} catch {
		return undefined;
	}
}

function sanitizeGitHubSegment(segment: string | undefined): string | undefined {
	const value = toStringMaybe(segment)?.replace(/^\/+|\/+$/g, '');
	return value && value.length > 0 ? value : undefined;
}

function normalizeXHandle(handle: string | undefined): string | undefined {
	const normalized = toStringMaybe(handle)?.replace(/^@+/, '');
	return normalized && normalized.length > 0 ? normalized : undefined;
}

function omitUrlLikeFields(data: Record<string, unknown>): Record<string, unknown> {
	const { url: _url, contentUrl: _contentUrl, ...rest } = data;
	return rest;
}

function getHostname(value: string): string | undefined {
	try {
		return new URL(value).hostname;
	} catch {
		return undefined;
	}
}

function isHttpUrl(value: string | undefined): value is string {
	if (!value) {
		return false;
	}

	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

function isCaseMutatedPathVariant(rawUrl: string, candidateUrl: string): boolean {
	try {
		const raw = new URL(rawUrl);
		const candidate = new URL(candidateUrl);

		return (
			raw.pathname !== candidate.pathname &&
			raw.pathname.toLowerCase() === candidate.pathname.toLowerCase()
		);
	} catch {
		return false;
	}
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function collectSameAsUrls(data: Record<string, unknown>, sourceUrl?: string): string[] {
	const candidates = [
		...extractStringArray(data.sameAs),
		toStringMaybe(data.url),
		toStringMaybe(data.contentUrl),
		sourceUrl,
	].filter((value): value is string => !!value && isHttpUrl(value));
	return Array.from(new Set(candidates));
}

function extractStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function resolveCanonicalName(data: Record<string, unknown>): string | undefined {
	const directName = toStringMaybe(data.name);
	if (directName) {
		return directName;
	}

	const givenName = toStringMaybe(data.givenName);
	const familyName = toStringMaybe(data.familyName);
	if (givenName && familyName) {
		return `${givenName} ${familyName}`;
	}

	return (
		givenName ??
		familyName ??
		toStringMaybe(data.address) ??
		toStringMaybe(data.identifier) ??
		toStringMaybe(data.isbn)
	);
}

function resolveCanonicalDescription(data: Record<string, unknown>): string | undefined {
	return (
		toStringMaybe(data.description) ??
		toStringMaybe(data.text) ??
		toStringMaybe(data.summary) ??
		undefined
	);
}

function resolveCanonicalIdFromCanonicalData(
	type: string,
	data: Record<string, unknown>,
	sameAs: string[]
): string | undefined {
	const identifier = toStringMaybe(data.identifier);
	if (identifier) {
		return identifier;
	}

	const isbn = toStringMaybe(data.isbn);
	if (isbn) {
		return `isbn:${isbn}`;
	}

	if (type === 'EthereumAccount' || type === 'EthereumSmartContract' || type === 'EthereumERC20') {
		const address = toStringMaybe(data.address);
		if (address) {
			const chainId = toStringMaybe(data.chainId) ?? '1';
			return `eip155:${chainId}:${address.toLowerCase()}`;
		}
	}

	return toStringMaybe(data.url) ?? sameAs[0];
}

function resolveAtomTypeFromClassificationType(type: string): ClassifiedAtomInput['atomType'] {
	const normalized = type.trim().toLowerCase();

	if (normalized === 'person') {
		return 'person';
	}
	if (normalized === 'place') {
		return 'place';
	}
	if (normalized === 'organization' || normalized === 'localbusiness') {
		return 'company';
	}
	if (normalized === 'product' || normalized === 'brand' || normalized === 'ethereumerc20') {
		return 'product';
	}
	if (
		normalized === 'musicrecording' ||
		normalized === 'musicalbum' ||
		normalized === 'musicgroup'
	) {
		return 'song';
	}
	if (normalized === 'podcastseries' || normalized === 'podcastepisode') {
		return 'podcast';
	}
	if (
		normalized === 'softwareapplication' ||
		normalized === 'softwaresourcecode' ||
		normalized === 'mobileapplication'
	) {
		return 'software';
	}

	return 'thing';
}
