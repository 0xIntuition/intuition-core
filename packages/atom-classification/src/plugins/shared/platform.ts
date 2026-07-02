import type { AtomClassificationPlugin, AtomClassifier, ResolverAtom } from '../../plugins';
import type { ClassificationClientClassificationHint, ClassificationRuntime } from '../../types';
import { TYPE_PROFILES_PLUGIN_ID } from './constants';

export const PLATFORM_DOMAINS = [
	'spotify',
	'amazon',
	'github',
	'npm',
	'x',
	'instagram',
	'tiktok',
	'youtube',
	'wikipedia',
	'imdb',
	'tmdb',
] as const;

export type PlatformDomain = (typeof PLATFORM_DOMAINS)[number];

type PlatformFallbackStage =
	| 'domain-api'
	| 'domain-html'
	| 'public-metadata'
	| 'oembed'
	| 'opengraph'
	| 'generic';

export type PlatformCredential = {
	apiKey?: string;
	token?: string;
	clientId?: string;
	clientSecret?: string;
	enabled?: boolean;
};

export type PlatformStageInput = {
	runtime: ClassificationRuntime;
	domain: PlatformDomain;
	classification: ClassificationClientClassificationHint;
	requestInput: string;
	canonicalUrl: string;
	credential?: PlatformCredential;
};

export type PlatformStageAdapter = (
	input: PlatformStageInput
) => ResolverAtom | Promise<ResolverAtom | null | undefined> | null | undefined;

export type PlatformV0PluginOptions = {
	credentials?: Partial<Record<PlatformDomain, PlatformCredential>>;
	adapters?: {
		domainApi?: PlatformStageAdapter;
		domainHtml?: PlatformStageAdapter;
		publicMetadata?: PlatformStageAdapter;
		oEmbed?: PlatformStageAdapter;
		openGraph?: PlatformStageAdapter;
	};
};

export type PlatformV0Profile = {
	domain: PlatformDomain;
	supportsOEmbed: boolean;
	allowDomainApiWithoutCredentials?: boolean;
	classifier: AtomClassifier;
	resolveGeneric: (input: {
		classification: ClassificationClientClassificationHint;
		requestInput: string;
		canonicalUrl: string;
		now: string;
	}) => ResolverAtom | null;
};

export function isPlatformDomain(value: string): value is PlatformDomain {
	return PLATFORM_DOMAINS.includes(value as PlatformDomain);
}

export function createPlatformPlugin(input: {
	pluginId: string;
	resolverId: string;
	profile: PlatformV0Profile;
	options?: PlatformV0PluginOptions;
}): AtomClassificationPlugin {
	const { pluginId, profile, resolverId } = input;
	const options = input.options ?? {};

	return {
		manifest: {
			id: pluginId,
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: [`classify:url:${profile.domain}`, 'resolve:url:v0'],
			permissions: [],
			dependsOn: [TYPE_PROFILES_PLUGIN_ID],
			provides: [`platform:v0:${profile.domain}`],
			priority: 20,
		},
		classifiers: [profile.classifier],
		resolvers: [
			{
				id: resolverId,
				priority: 40,
				executionMode: 'deterministic',
				canResolve: (classification) =>
					classification.type === 'url' && classification.domain === profile.domain,
				resolve: async ({ runtime, classification, request, now }) => {
					if (classification.type !== 'url' || classification.domain !== profile.domain) {
						return null;
					}

					const resolved = await resolveWithFallbackChain({
						runtime,
						pluginId,
						profile,
						classification,
						requestInput: request.input,
						now,
						options,
					});
					if (!resolved) {
						return null;
					}

					return {
						fallbackUsed: resolved.fallbackUsed,
						atoms: [resolved.atom],
						metadata: {
							platformResolver: {
								domain: profile.domain,
								fallbackStage: resolved.stage,
								attemptedStages: resolved.attemptedStages,
								skippedStages: resolved.skippedStages,
								stageErrors: resolved.stageErrors,
							},
						},
					};
				},
			},
		],
	};
}

async function resolveWithFallbackChain(input: {
	runtime: ClassificationRuntime;
	pluginId: string;
	profile: PlatformV0Profile;
	classification: ClassificationClientClassificationHint;
	requestInput: string;
	now: string;
	options: PlatformV0PluginOptions;
}): Promise<{
	stage: PlatformFallbackStage;
	fallbackUsed: boolean;
	atom: ResolverAtom;
	attemptedStages: PlatformFallbackStage[];
	skippedStages: string[];
	stageErrors: string[];
} | null> {
	const { classification, now, options, profile, requestInput, runtime } = input;
	const canonicalUrl =
		(typeof classification.meta.canonicalUrl === 'string' && classification.meta.canonicalUrl) ||
		requestInput;
	const attemptedStages: PlatformFallbackStage[] = [];
	const skippedStages: string[] = [];
	const stageErrors: string[] = [];
	const credential = options.credentials?.[profile.domain];
	const canAttemptDomainApi =
		!!options.adapters?.domainApi &&
		(isCredentialConfigured(credential) || profile.allowDomainApiWithoutCredentials === true);

	if (canAttemptDomainApi) {
		attemptedStages.push('domain-api');
		const domainApiCandidate = await tryStageAdapter('domain-api', options.adapters?.domainApi, {
			runtime,
			domain: profile.domain,
			classification,
			requestInput,
			canonicalUrl,
			credential,
		});

		if ('error' in domainApiCandidate) {
			stageErrors.push(domainApiCandidate.error);
		} else if (domainApiCandidate.atom) {
			return {
				stage: 'domain-api',
				fallbackUsed: false,
				atom: finalizeStageAtom(domainApiCandidate.atom, {
					pluginId: input.pluginId,
					stage: 'domain-api',
					domain: profile.domain,
					attemptedStages,
					canonicalUrl,
					now,
				}),
				attemptedStages,
				skippedStages,
				stageErrors,
			};
		}
	} else if (!profile.allowDomainApiWithoutCredentials) {
		skippedStages.push('domain-api:no-credentials');
	}

	if (options.adapters?.domainHtml) {
		attemptedStages.push('domain-html');
		const domainHtmlCandidate = await tryStageAdapter('domain-html', options.adapters.domainHtml, {
			runtime,
			domain: profile.domain,
			classification,
			requestInput,
			canonicalUrl,
			credential,
		});

		if ('error' in domainHtmlCandidate) {
			stageErrors.push(domainHtmlCandidate.error);
		} else if (domainHtmlCandidate.atom) {
			return {
				stage: 'domain-html',
				fallbackUsed: false,
				atom: finalizeStageAtom(domainHtmlCandidate.atom, {
					pluginId: input.pluginId,
					stage: 'domain-html',
					domain: profile.domain,
					attemptedStages,
					canonicalUrl,
					now,
				}),
				attemptedStages,
				skippedStages,
				stageErrors,
			};
		}
	}

	if (options.adapters?.publicMetadata) {
		attemptedStages.push('public-metadata');
		const publicMetadataCandidate = await tryStageAdapter(
			'public-metadata',
			options.adapters.publicMetadata,
			{
				runtime,
				domain: profile.domain,
				classification,
				requestInput,
				canonicalUrl,
				credential,
			}
		);

		if ('error' in publicMetadataCandidate) {
			stageErrors.push(publicMetadataCandidate.error);
		} else if (publicMetadataCandidate.atom) {
			return {
				stage: 'public-metadata',
				fallbackUsed: true,
				atom: finalizeStageAtom(publicMetadataCandidate.atom, {
					pluginId: input.pluginId,
					stage: 'public-metadata',
					domain: profile.domain,
					attemptedStages,
					canonicalUrl,
					now,
				}),
				attemptedStages,
				skippedStages,
				stageErrors,
			};
		}
	}

	if (profile.supportsOEmbed) {
		attemptedStages.push('oembed');
		const oembedCandidate = await tryStageAdapter('oembed', options.adapters?.oEmbed, {
			runtime,
			domain: profile.domain,
			classification,
			requestInput,
			canonicalUrl,
			credential,
		});

		if ('error' in oembedCandidate) {
			stageErrors.push(oembedCandidate.error);
		} else if (oembedCandidate.atom) {
			return {
				stage: 'oembed',
				fallbackUsed: true,
				atom: finalizeStageAtom(oembedCandidate.atom, {
					pluginId: input.pluginId,
					stage: 'oembed',
					domain: profile.domain,
					attemptedStages,
					canonicalUrl,
					now,
				}),
				attemptedStages,
				skippedStages,
				stageErrors,
			};
		}
	} else {
		skippedStages.push('oembed:unsupported');
	}

	attemptedStages.push('opengraph');
	const openGraphCandidate = await tryStageAdapter('opengraph', options.adapters?.openGraph, {
		runtime,
		domain: profile.domain,
		classification,
		requestInput,
		canonicalUrl,
		credential,
	});

	if ('error' in openGraphCandidate) {
		stageErrors.push(openGraphCandidate.error);
	} else if (openGraphCandidate.atom) {
		return {
			stage: 'opengraph',
			fallbackUsed: true,
			atom: finalizeStageAtom(openGraphCandidate.atom, {
				pluginId: input.pluginId,
				stage: 'opengraph',
				domain: profile.domain,
				attemptedStages,
				canonicalUrl,
				now,
			}),
			attemptedStages,
			skippedStages,
			stageErrors,
		};
	}

	attemptedStages.push('generic');
	const genericAtom = profile.resolveGeneric({
		classification,
		requestInput,
		canonicalUrl,
		now,
	});
	if (!genericAtom) {
		return null;
	}

	return {
		stage: 'generic',
		fallbackUsed: true,
		atom: finalizeStageAtom(genericAtom, {
			pluginId: input.pluginId,
			stage: 'generic',
			domain: profile.domain,
			attemptedStages,
			canonicalUrl,
			now,
		}),
		attemptedStages,
		skippedStages,
		stageErrors,
	};
}

async function tryStageAdapter(
	stage: PlatformFallbackStage,
	adapter: PlatformStageAdapter | undefined,
	input: PlatformStageInput
): Promise<{ ok: true; atom: ResolverAtom | null } | { ok: false; error: string }> {
	if (!adapter) {
		return { ok: true, atom: null };
	}

	try {
		const atom = await Promise.resolve(adapter(input));
		return { ok: true, atom: atom ?? null };
	} catch (error) {
		return {
			ok: false,
			error: `${stage}:${normalizeError(error).message}`,
		};
	}
}

function finalizeStageAtom(
	atom: ResolverAtom,
	input: {
		pluginId: string;
		stage: PlatformFallbackStage;
		domain: PlatformDomain;
		attemptedStages: PlatformFallbackStage[];
		canonicalUrl: string;
		now: string;
	}
): ResolverAtom {
	const metadata = atom.metadata ?? {};
	const metadataRecord: Record<string, unknown> =
		metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};

	return {
		...atom,
		source: atom.source ?? `platform-v0:${input.stage}`,
		metadata: {
			...metadataRecord,
			pluginId:
				typeof metadataRecord.pluginId === 'string' ? metadataRecord.pluginId : input.pluginId,
			provider:
				typeof metadataRecord.provider === 'string' ? metadataRecord.provider : input.domain,
			fetchedAt:
				typeof metadataRecord.fetchedAt === 'string' ? metadataRecord.fetchedAt : input.now,
			sourceUrl:
				typeof metadataRecord.sourceUrl === 'string'
					? metadataRecord.sourceUrl
					: input.canonicalUrl,
			platform: input.domain,
			fallbackStage: input.stage,
			fallbackChain: [...input.attemptedStages],
		},
	};
}

function isCredentialConfigured(credential: PlatformCredential | undefined): boolean {
	if (!credential) {
		return false;
	}

	if (credential.enabled === false) {
		return false;
	}

	return !!(
		credential.apiKey ||
		credential.token ||
		credential.clientId ||
		credential.clientSecret ||
		credential.enabled
	);
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	return new Error('Unknown platform stage error');
}
