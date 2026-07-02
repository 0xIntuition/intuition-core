import {
	buildClassificationResolverCacheKey,
	type ClassificationCacheAdapter,
	type ClassificationResolverCachedEntry,
	isClassificationResolverCachedEntryFresh,
} from './cache';
import {
	type AtomClassificationPlugin,
	type AtomClassifier,
	type AtomResolver,
	ENGINE_VERSION,
	getPluginSecurityViolations,
	type HookExecutionError,
	type HookPatch,
	type HookStage,
	isEngineVersionCompatible,
	isRuntimeCompatible,
	type PluginManifest,
	type ResolverAtom,
	type ResolverClassification,
	type RuntimeTarget,
	validatePluginManifest,
} from './plugins';
import { matchPlainTextInput } from './plugins/shared/plain-text';
import {
	getFieldPolicy,
	isRichPublicFieldAllowed,
	NON_PUBLISHABLE_MEDIA_FIELDS,
	NON_PUBLISHABLE_VOLATILE_FIELDS,
	PUBLISHABLE_STABLE_FIELDS,
} from './publishable-policy';
import {
	createJsonLdTypeRegistry,
	type JsonLdTypeDefinition,
	type JsonLdTypeRegistry,
	type RegisterTypeOptions,
} from './type-registry';
import {
	type ClassificationCanonicalEnvelope,
	type ClassificationCanonicalFieldPolicyMap,
	type ClassificationClientClassificationHint,
	type ClassificationFieldProvenanceMap,
	type ClassificationRequest,
	type ClassificationRequestInput,
	type ClassificationResolvedAtom,
	type ClassificationResolvedPayload,
	type ClassificationResolverError,
	type ClassificationResult,
	type ClassificationRuntime,
	type ClassificationSourceFamily,
	classificationCanonicalEnvelopeSchema,
	classificationClientClassificationHintSchema,
	classificationRequestSchema,
	classificationResolvedAtomSchema,
	classificationResolvedPayloadSchema,
	classificationResultSchema,
	resolveEnhancementPolicy,
} from './types';

const DEFAULT_HOOK_TIMEOUT_MS = 150;
const DEFAULT_CLASSIFIER_PRIORITY = 100;
const DEFAULT_RESOLVER_PRIORITY = 100;
const DEFAULT_RESOLVER_CACHE_TTL_MS = 300_000;

const RUNTIME_TO_PROVENANCE_SOURCE: Record<ClassificationRuntime, 'client' | 'server'> = {
	client: 'client',
	server: 'server',
};

type ClassificationRequestWithSession = ClassificationRequest & {
	classificationSessionId: string;
};

type ClientResultHint = NonNullable<
	NonNullable<ClassificationRequest['clientHints']>['clientResult']
>;

type ProvenanceSource = 'client' | 'server' | 'merged' | 'user';

type RegisteredPlugin = AtomClassificationPlugin & {
	manifest: PluginManifest;
	registrationOrder: number;
};

type RegisteredClassifier = AtomClassifier & {
	pluginId: string;
	priority: number;
	runtime: RuntimeTarget;
	registrationOrder: number;
};

type RegisteredResolver = AtomResolver & {
	pluginId: string;
	priority: number;
	runtime: RuntimeTarget;
	registrationOrder: number;
};

type HookPipelineState = {
	request: ClassificationRequest;
	classification?: ClassificationClientClassificationHint;
	resolved?: ClassificationResolvedPayload;
	resolverErrors: ClassificationResolverError[];
	result?: ClassificationResult;
	metadata: Record<string, unknown>;
};

type ResolverAtomCandidate = {
	resolverId: string;
	pluginId: string;
	resolverPriority: number;
	registrationOrder: number;
	fallbackUsed: boolean;
	atoms: ClassificationResolvedAtom[];
	classifications: ClassificationCanonicalEnvelope[];
	metadata?: Record<string, unknown>;
};

export type CreateClassificationEngineOptions = {
	runtime: ClassificationRuntime;
	hookTimeoutMs?: number;
	autoInit?: boolean;
	now?: () => Date;
	plugins?: AtomClassificationPlugin[];
	cache?: ClassificationCacheAdapter;
	resolverCacheTtlMs?: number;
};

export type ClassificationEngineInitResult = {
	ok: true;
	runtime: ClassificationRuntime;
	pluginOrder: string[];
	typeCount: number;
	classifierCount: number;
	resolverCount: number;
};

export type ClassificationEngine = {
	readonly runtime: ClassificationRuntime;
	registerPlugin(plugin: AtomClassificationPlugin): ClassificationEngine;
	registerHookPlugin(plugin: AtomClassificationPlugin): ClassificationEngine;
	registerType(
		definition: JsonLdTypeDefinition,
		options?: RegisterTypeOptions
	): ClassificationEngine;
	hasPlugin(pluginId: string): boolean;
	listPlugins(): PluginManifest[];
	listTypes(): ReturnType<JsonLdTypeRegistry['list']>;
	getPluginOrder(): string[];
	listClassifierIds(): string[];
	listResolverIds(): string[];
	getLastHookErrors(): HookExecutionError[];
	getLastMetadata(): Record<string, unknown>;
	init(): Promise<ClassificationEngineInitResult>;
	classify(input: ClassificationRequestInput): Promise<ClassificationResult>;
};

export type { ClassificationRuntime } from './types';

export function createClassificationEngine(
	options: CreateClassificationEngineOptions
): ClassificationEngine {
	return new DefaultClassificationEngine(options);
}

class DefaultClassificationEngine implements ClassificationEngine {
	readonly runtime: ClassificationRuntime;

	private readonly hookTimeoutMs: number;
	private readonly autoInit: boolean;
	private readonly now: () => Date;
	private readonly cache: ClassificationCacheAdapter | undefined;
	private readonly resolverCacheTtlMs: number | undefined;
	private readonly pluginsById = new Map<string, RegisteredPlugin>();
	private readonly classifiersById = new Map<string, RegisteredClassifier>();
	private readonly resolversById = new Map<string, RegisteredResolver>();
	private readonly typeRegistry = createJsonLdTypeRegistry();
	private readonly initializedTypePluginIds = new Set<string>();
	private readonly pluginOrder = [] as string[];
	private readonly classifierOrder = [] as string[];
	private readonly resolverOrder = [] as string[];
	private lastHookErrors: HookExecutionError[] = [];
	private lastMetadata: Record<string, unknown> = {};
	private registrationCount = 0;
	private sessionCount = 0;
	private initialized = false;

	constructor(options: CreateClassificationEngineOptions) {
		this.runtime = options.runtime;
		this.hookTimeoutMs = Math.max(0, options.hookTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS);
		this.autoInit = options.autoInit ?? true;
		this.now = options.now ?? (() => new Date());
		this.cache = options.cache;
		this.resolverCacheTtlMs = normalizeResolverCacheTtlMs(
			options.resolverCacheTtlMs ?? DEFAULT_RESOLVER_CACHE_TTL_MS
		);

		for (const plugin of options.plugins ?? []) {
			this.registerPlugin(plugin);
		}
	}

	registerPlugin(plugin: AtomClassificationPlugin): ClassificationEngine {
		const manifest = validatePluginManifest(plugin.manifest);

		if (this.pluginsById.has(manifest.id)) {
			throw new Error(`Plugin "${manifest.id}" is already registered.`);
		}

		if (!isRuntimeCompatible(this.runtime, manifest.runtime)) {
			throw new Error(
				`Plugin "${manifest.id}" targets runtime "${manifest.runtime}" and cannot run in "${this.runtime}".`
			);
		}

		if (!isEngineVersionCompatible(manifest.engineRange, ENGINE_VERSION)) {
			throw new Error(
				`Plugin "${manifest.id}" requires engineRange "${manifest.engineRange}" but engine version is "${ENGINE_VERSION}".`
			);
		}

		const securityViolations = getPluginSecurityViolations(this.runtime, manifest);
		if (securityViolations.length > 0) {
			throw new Error(securityViolations.map((violation) => violation.message).join(' '));
		}

		const registeredPlugin: RegisteredPlugin = {
			...plugin,
			manifest,
			registrationOrder: this.registrationCount,
		};

		this.pluginsById.set(manifest.id, registeredPlugin);
		this.registrationCount += 1;

		for (const classifier of plugin.classifiers ?? []) {
			this.registerClassifier(manifest, classifier);
		}

		for (const resolver of plugin.resolvers ?? []) {
			this.registerResolver(manifest, resolver);
		}

		this.markDirty();
		return this;
	}

	registerHookPlugin(plugin: AtomClassificationPlugin): ClassificationEngine {
		if (!plugin.hooks) {
			throw new Error('registerHookPlugin requires a plugin with at least one hook handler.');
		}

		return this.registerPlugin(plugin);
	}

	registerType(
		definition: JsonLdTypeDefinition,
		options?: RegisterTypeOptions
	): ClassificationEngine {
		this.typeRegistry.register(definition, options);
		return this;
	}

	hasPlugin(pluginId: string): boolean {
		return this.pluginsById.has(pluginId);
	}

	listPlugins(): PluginManifest[] {
		const plugins = Array.from(this.pluginsById.values()).sort((left, right) => {
			if (left.registrationOrder !== right.registrationOrder) {
				return left.registrationOrder - right.registrationOrder;
			}

			return left.manifest.id.localeCompare(right.manifest.id);
		});

		return plugins.map((plugin) => ({
			...plugin.manifest,
			capabilities: [...plugin.manifest.capabilities],
			permissions: [...plugin.manifest.permissions],
			dependsOn: [...plugin.manifest.dependsOn],
			provides: [...plugin.manifest.provides],
		}));
	}

	listTypes(): ReturnType<JsonLdTypeRegistry['list']> {
		return this.typeRegistry.list();
	}

	getPluginOrder(): string[] {
		return [...this.pluginOrder];
	}

	listClassifierIds(): string[] {
		if (this.classifierOrder.length > 0) {
			return [...this.classifierOrder];
		}

		return Array.from(this.classifiersById.keys()).sort((left, right) => left.localeCompare(right));
	}

	listResolverIds(): string[] {
		if (this.resolverOrder.length > 0) {
			return [...this.resolverOrder];
		}

		return Array.from(this.resolversById.keys()).sort((left, right) => left.localeCompare(right));
	}

	getLastHookErrors(): HookExecutionError[] {
		return this.lastHookErrors.map((entry) => ({ ...entry }));
	}

	getLastMetadata(): Record<string, unknown> {
		return cloneRecord(this.lastMetadata);
	}

	async init(): Promise<ClassificationEngineInitResult> {
		if (this.initialized) {
			return {
				ok: true,
				runtime: this.runtime,
				pluginOrder: [...this.pluginOrder],
				typeCount: this.typeRegistry.list().length,
				classifierCount: this.classifierOrder.length,
				resolverCount: this.resolverOrder.length,
			};
		}

		const orderedPlugins = resolvePluginOrder(Array.from(this.pluginsById.values()));
		const orderedClassifiers = resolveClassifierOrder(Array.from(this.classifiersById.values()));
		const orderedResolvers = resolveResolverOrder(Array.from(this.resolversById.values()));

		for (const plugin of orderedPlugins) {
			if (this.initializedTypePluginIds.has(plugin.manifest.id)) {
				continue;
			}

			plugin.registerTypes?.({
				register: (definition, options) => {
					this.typeRegistry.register(definition, options);
				},
			});
			this.initializedTypePluginIds.add(plugin.manifest.id);
		}

		this.initialized = true;
		this.pluginOrder.length = 0;
		this.classifierOrder.length = 0;
		this.resolverOrder.length = 0;
		this.pluginOrder.push(...orderedPlugins.map((plugin) => plugin.manifest.id));
		this.classifierOrder.push(...orderedClassifiers.map((classifier) => classifier.id));
		this.resolverOrder.push(...orderedResolvers.map((resolver) => resolver.id));

		return {
			ok: true,
			runtime: this.runtime,
			pluginOrder: [...this.pluginOrder],
			typeCount: this.typeRegistry.list().length,
			classifierCount: this.classifierOrder.length,
			resolverCount: this.resolverOrder.length,
		};
	}

	async classify(input: ClassificationRequestInput): Promise<ClassificationResult> {
		if (!this.initialized) {
			if (!this.autoInit) {
				throw new Error('Engine is not initialized. Call init() before classify().');
			}

			await this.init();
		}

		this.lastHookErrors = [];
		this.lastMetadata = {};

		let state: HookPipelineState = {
			request: this.ensureSessionId(classificationRequestSchema.parse(input)),
			resolverErrors: [],
			metadata: {},
		};

		state = await this.executeHookStage('beforeClassify', state);
		state.request = this.ensureSessionId(state.request);

		if (!state.classification) {
			state.classification = await this.classifyInput(state.request);
		}

		state.result = state.classification
			? this.createBaseResult(state.request, state.classification)
			: this.createPlaceholderResult(state.request, buildClassificationNoOpMessage(state.request));
		state = await this.executeHookStage('afterClassify', state);
		state = await this.executeHookStage('beforeResolve', state);
		if (!state.result) {
			if (!state.classification) {
				state.classification = await this.classifyInput(state.request);
			}
			state.result = state.classification
				? this.createBaseResult(state.request, state.classification)
				: this.createPlaceholderResult(
						state.request,
						buildClassificationNoOpMessage(state.request)
					);
		}

		if (!state.resolved && state.classification) {
			const resolution = await this.resolveInput(
				state.request,
				state.classification,
				state.result.policy
			);
			state.resolved = resolution.resolved;
			state.resolverErrors = [...state.resolverErrors, ...resolution.errors];

			if (resolution.metadata) {
				state.metadata = mergeMetadata(state.metadata, resolution.metadata);
			}
		}

		if (state.result) {
			state.result = this.mergeResultWithResolution(
				state.result,
				state.request,
				state.classification,
				state.resolved,
				state.resolverErrors
			);
		}

		state = await this.executeHookStage('afterResolve', state);
		state = await this.executeHookStage('beforeMerge', state);

		if (state.result) {
			state.result = classificationResultSchema.parse(
				this.syncResultWithRequest(state.result, state.request)
			);
		}

		state = await this.executeHookStage('afterMerge', state);

		const finalRequest = this.ensureSessionId(state.request);
		const fallbackClassification = state.classification ?? (await this.classifyInput(finalRequest));
		const finalResult = classificationResultSchema.parse(
			this.syncResultWithRequest(
				state.result ??
					(fallbackClassification
						? this.createBaseResult(finalRequest, fallbackClassification)
						: this.createPlaceholderResult(
								finalRequest,
								buildClassificationNoOpMessage(finalRequest)
							)),
				finalRequest
			)
		);

		this.lastMetadata = cloneRecord(state.metadata);
		return finalResult;
	}

	private registerClassifier(manifest: PluginManifest, classifier: AtomClassifier): void {
		if (!classifier.id) {
			throw new Error(`Plugin "${manifest.id}" registered a classifier without an id.`);
		}

		if (this.classifiersById.has(classifier.id)) {
			throw new Error(`Classifier "${classifier.id}" is already registered.`);
		}

		const runtime = classifier.runtime ?? manifest.runtime;
		if (!isRuntimeCompatible(this.runtime, runtime)) {
			throw new Error(
				`Classifier "${classifier.id}" in plugin "${manifest.id}" targets runtime "${runtime}" and cannot run in "${this.runtime}".`
			);
		}

		this.classifiersById.set(classifier.id, {
			...classifier,
			pluginId: manifest.id,
			priority: classifier.priority ?? DEFAULT_CLASSIFIER_PRIORITY,
			runtime,
			registrationOrder: this.registrationCount,
		});
	}

	private registerResolver(manifest: PluginManifest, resolver: AtomResolver): void {
		if (!resolver.id) {
			throw new Error(`Plugin "${manifest.id}" registered a resolver without an id.`);
		}

		if (this.resolversById.has(resolver.id)) {
			throw new Error(`Resolver "${resolver.id}" is already registered.`);
		}

		const runtime = resolver.runtime ?? manifest.runtime;
		if (!isRuntimeCompatible(this.runtime, runtime)) {
			throw new Error(
				`Resolver "${resolver.id}" in plugin "${manifest.id}" targets runtime "${runtime}" and cannot run in "${this.runtime}".`
			);
		}

		this.resolversById.set(resolver.id, {
			...resolver,
			pluginId: manifest.id,
			priority: resolver.priority ?? DEFAULT_RESOLVER_PRIORITY,
			executionMode: resolver.executionMode ?? 'server-enrichment',
			runtime,
			registrationOrder: this.registrationCount,
		});
	}

	private markDirty(): void {
		this.initialized = false;
		this.pluginOrder.length = 0;
		this.classifierOrder.length = 0;
		this.resolverOrder.length = 0;
	}

	private async classifyInput(
		request: ClassificationRequest
	): Promise<ClassificationClientClassificationHint | undefined> {
		const requestedPluginIds = resolveRequestedPluginIds(request.pluginIds, this.pluginsById);
		const orderedClassifiers = filterClassifiersForInputIntent(
			this.getOrderedClassifiers(requestedPluginIds),
			request
		);
		const input = request.input.trim();
		const candidates: Array<{
			classification: ClassificationClientClassificationHint;
			classifier: RegisteredClassifier;
		}> = [];

		for (const classifier of orderedClassifiers) {
			try {
				const candidate = await Promise.resolve(classifier.classify(input, cloneRequest(request)));
				if (!candidate) {
					continue;
				}

				const parsed = classificationClientClassificationHintSchema.parse(candidate);
				candidates.push({
					classification: parsed,
					classifier,
				});
			} catch {
				// Classifier failures are intentionally isolated.
			}
		}

		if (candidates.length > 0) {
			const [best] = [...candidates].sort((left, right) => {
				if (left.classification.confidence !== right.classification.confidence) {
					return right.classification.confidence - left.classification.confidence;
				}
				if (left.classifier.priority !== right.classifier.priority) {
					return left.classifier.priority - right.classifier.priority;
				}
				return left.classifier.registrationOrder - right.classifier.registrationOrder;
			});

			if (best) {
				return best.classification;
			}
		}

		if (request.clientHints?.clientClassification) {
			return classificationClientClassificationHintSchema.parse(
				request.clientHints.clientClassification
			);
		}

		// An explicit plugin selection is a hard boundary. If none of the requested
		// classifiers match, return no classification instead of fabricating the
		// engine's generic fallback under the requested domain.
		if (requestedPluginIds !== undefined) {
			return undefined;
		}

		if (shouldShortCircuitUrlFirstFallback(request)) {
			return undefined;
		}

		const fallback = inferGenericClassification(input);
		if (!fallback) {
			return undefined;
		}

		return classificationClientClassificationHintSchema.parse(fallback);
	}

	private async resolveInput(
		request: ClassificationRequest,
		classification: ClassificationClientClassificationHint,
		policy: ClassificationResult['policy']
	): Promise<{
		resolved: ClassificationResolvedPayload;
		errors: ClassificationResolverError[];
		metadata?: Record<string, unknown>;
	}> {
		const requestedPluginIds = resolveRequestedPluginIds(request.pluginIds, this.pluginsById);
		const orderedResolvers = this.getOrderedResolvers(requestedPluginIds);
		const attemptedResolvers: string[] = [];
		const errors: ClassificationResolverError[] = [];
		const resolverCandidates: ResolverAtomCandidate[] = [];

		for (const resolver of orderedResolvers) {
			if (!shouldRunResolverForPolicy(policy, resolver)) {
				continue;
			}

			if (!resolver.canResolve(classification, cloneRequest(request))) {
				continue;
			}

			attemptedResolvers.push(resolver.id);
			const resolverCacheTtlMs = this.resolveResolverCacheTtlMs(resolver);
			const resolverCacheKey =
				this.cache && resolverCacheTtlMs
					? buildClassificationResolverCacheKey({
							pluginId: resolver.pluginId,
							resolverId: resolver.id,
							runtime: this.runtime,
							request,
							classification,
						})
					: undefined;

			const cachedCandidate =
				this.cache && resolverCacheKey && resolverCacheTtlMs
					? await this.readResolverCandidateFromCache({
							resolver,
							cacheKey: resolverCacheKey,
						})
					: undefined;
			if (cachedCandidate) {
				resolverCandidates.push(cachedCandidate);
				continue;
			}

			try {
				const output = await Promise.resolve(
					resolver.resolve({
						runtime: this.runtime,
						request: cloneRequest(request),
						classification: cloneClassification(classification),
						now: this.now().toISOString(),
					})
				);

				if (
					!output ||
					((!output.atoms || output.atoms.length === 0) &&
						(!output.classifications || output.classifications.length === 0))
				) {
					continue;
				}

				const normalizedOutput = normalizeResolverOutput({
					output,
					resolverId: resolver.id,
					pluginId: resolver.pluginId,
					classificationConfidence: classification.confidence,
					fetchedAt: this.now().toISOString(),
				});
				const normalizedAtoms = normalizedOutput.atoms;
				if (normalizedAtoms.length === 0) {
					continue;
				}
				const normalizedClassifications =
					normalizedOutput.classifications.length > 0
						? normalizedOutput.classifications
						: normalizedAtoms.map((atom) =>
								toCanonicalClassification({
									atom,
									fetchedAt: this.now().toISOString(),
									defaultPluginId: resolver.pluginId,
									defaultProvider: resolver.id,
								})
							);
				if (normalizedClassifications.length === 0) {
					continue;
				}
				if (normalizedOutput.metaMismatches.length > 0) {
					output.metadata = {
						...(output.metadata ?? {}),
						migrationMismatches: normalizedOutput.metaMismatches,
					};
				}
				this.validateCanonicalClassifications(normalizedClassifications, resolver.id);
				this.validateCompatibilityProjection(
					normalizedClassifications,
					normalizedAtoms,
					resolver.id
				);
				this.validateResolvedAtomsAgainstRegistry(normalizedAtoms, resolver.id);
				const resolverCandidate: ResolverAtomCandidate = {
					resolverId: resolver.id,
					pluginId: resolver.pluginId,
					resolverPriority: resolver.priority,
					registrationOrder: resolver.registrationOrder,
					fallbackUsed: output.fallbackUsed ?? false,
					atoms: normalizedAtoms,
					classifications: normalizedClassifications,
					metadata: output.metadata,
				};
				resolverCandidates.push(resolverCandidate);
				if (this.cache && resolverCacheKey && resolverCacheTtlMs) {
					await this.writeResolverCandidateToCache({
						cacheKey: resolverCacheKey,
						candidate: resolverCandidate,
						ttlMs: resolverCacheTtlMs,
					});
				}
			} catch (error) {
				errors.push({
					resolverId: resolver.id,
					message: normalizeError(error).message,
					timestamp: this.now().toISOString(),
				});
			}
		}

		if (resolverCandidates.length > 0) {
			const rankedAtoms = rankResolverCandidates(resolverCandidates);
			const firstCandidate = resolverCandidates[0];
			if (!firstCandidate) {
				throw new Error('Resolver candidate collection was unexpectedly empty.');
			}
			const metadata = mergeResolverCandidateMetadata(resolverCandidates);
			const rankedClassifications = rankedAtoms.map((candidate) =>
				toCanonicalClassification({
					atom: candidate.atom,
					fetchedAt: this.now().toISOString(),
					defaultPluginId: candidate.atom.pluginId ?? candidate.resolverId,
					defaultProvider: candidate.resolverId,
				})
			);
			return {
				resolved: buildResolvedPayload({
					classification,
					resolverId: firstCandidate.resolverId,
					resolverChain: attemptedResolvers,
					atoms: rankedAtoms.map((candidate) => candidate.atom),
					classifications: rankedClassifications,
					fetchedAt: this.now().toISOString(),
					fallbackUsed: firstCandidate.fallbackUsed,
				}),
				errors,
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			};
		}

		const fallbackAtom = createFallbackAtom(
			classification,
			request.input,
			policy.runServerEnrichment ? 'resolver-fallback' : 'policy-fallback'
		);
		this.validateResolvedAtomsAgainstRegistry([fallbackAtom], 'deterministic-fallback');
		return {
			resolved: buildResolvedPayload({
				classification,
				resolverId: 'deterministic-fallback',
				resolverChain: attemptedResolvers,
				atoms: [fallbackAtom],
				fetchedAt: this.now().toISOString(),
				fallbackUsed: true,
			}),
			errors,
		};
	}

	private resolveResolverCacheTtlMs(resolver: RegisteredResolver): number | undefined {
		if (!this.cache) {
			return undefined;
		}

		if (typeof resolver.cacheTtlSeconds === 'number') {
			return normalizeResolverCacheTtlMs(resolver.cacheTtlSeconds * 1_000);
		}

		return this.resolverCacheTtlMs;
	}

	private async readResolverCandidateFromCache(input: {
		resolver: RegisteredResolver;
		cacheKey: string;
	}): Promise<ResolverAtomCandidate | undefined> {
		if (!this.cache) {
			return undefined;
		}

		try {
			const cachedEntry = await this.cache.get(input.cacheKey);
			if (!cachedEntry) {
				return undefined;
			}

			if (!isClassificationResolverCachedEntryFresh(cachedEntry)) {
				try {
					await this.cache.delete(input.cacheKey);
				} catch {
					// non-fatal cache cleanup failure
				}
				return undefined;
			}

			this.validateResolvedAtomsAgainstRegistry(cachedEntry.atoms, input.resolver.id);
			const classifications = cachedEntry.atoms.map((atom) =>
				toCanonicalClassification({
					atom,
					fetchedAt: this.now().toISOString(),
					defaultPluginId: atom.pluginId ?? input.resolver.pluginId,
					defaultProvider: input.resolver.id,
				})
			);
			this.validateCanonicalClassifications(classifications, input.resolver.id);
			this.validateCompatibilityProjection(classifications, cachedEntry.atoms, input.resolver.id);

			return {
				resolverId: input.resolver.id,
				pluginId: input.resolver.pluginId,
				resolverPriority: input.resolver.priority,
				registrationOrder: input.resolver.registrationOrder,
				fallbackUsed: cachedEntry.fallbackUsed,
				atoms: cachedEntry.atoms.map((atom) => structuredCloneSafe(atom)),
				classifications,
				metadata: cachedEntry.metadata ? structuredCloneSafe(cachedEntry.metadata) : undefined,
			};
		} catch {
			return undefined;
		}
	}

	private async writeResolverCandidateToCache(input: {
		cacheKey: string;
		candidate: ResolverAtomCandidate;
		ttlMs: number;
	}): Promise<void> {
		if (!this.cache) {
			return;
		}

		const cacheEntry: ClassificationResolverCachedEntry = {
			atoms: input.candidate.atoms.map((atom) => structuredCloneSafe(atom)),
			fallbackUsed: input.candidate.fallbackUsed,
			metadata: input.candidate.metadata
				? structuredCloneSafe(input.candidate.metadata)
				: undefined,
			cachedAt: this.now().toISOString(),
			ttlMs: input.ttlMs,
		};

		try {
			await this.cache.set(input.cacheKey, cacheEntry, input.ttlMs);
		} catch {
			// cache writes are intentionally best-effort
		}
	}

	private createBaseResult(
		request: ClassificationRequest,
		classification: ClassificationClientClassificationHint
	): ClassificationResult {
		const withSession = this.ensureSessionId(request);
		const policy = resolveEnhancementPolicy(withSession.mode, withSession.policy);

		return classificationResultSchema.parse({
			ok: true,
			status: 'partial',
			contractVersion: 'cpkg-02',
			runtime: this.runtime,
			mode: withSession.mode,
			classificationSessionId: withSession.classificationSessionId,
			policy,
			message: `Deterministic classification matched ${classification.domain}/${classification.subtype}.`,
			receivedAt: this.now().toISOString(),
			classification,
			provenance: policy.includeProvenance
				? {
						'/classification': {
							source: this.runtime,
							confidence: classification.confidence,
							updatedAt: this.now().toISOString(),
							tier: 0,
						},
					}
				: undefined,
			debug: {
				inputPreview: createInputPreview(withSession.input),
				hasClientHints: !!withSession.clientHints,
				inputIntent: withSession.inputIntent,
				requestedPluginIds: normalizePluginIds(withSession.pluginIds),
				requestedServerTiers: [...policy.requestedServerTiers],
			},
		});
	}

	private createPlaceholderResult(
		request: ClassificationRequest,
		message: string
	): ClassificationResult {
		const withSession = this.ensureSessionId(request);
		const policy = resolveEnhancementPolicy(withSession.mode, withSession.policy);

		return classificationResultSchema.parse({
			ok: true,
			status: 'placeholder',
			contractVersion: 'cpkg-02',
			runtime: this.runtime,
			mode: withSession.mode,
			classificationSessionId: withSession.classificationSessionId,
			policy,
			message,
			receivedAt: this.now().toISOString(),
			debug: {
				inputPreview: createInputPreview(withSession.input),
				hasClientHints: !!withSession.clientHints,
				inputIntent: withSession.inputIntent,
				requestedPluginIds: normalizePluginIds(withSession.pluginIds),
				requestedServerTiers: [...policy.requestedServerTiers],
			},
		});
	}

	private validateResolvedAtomsAgainstRegistry(
		atoms: ClassificationResolvedAtom[],
		resolverId: string
	): void {
		const registeredTypes = this.typeRegistry.list();
		if (registeredTypes.length === 0) {
			return;
		}

		for (const atom of atoms) {
			const definition = this.typeRegistry.get(atom.schemaType);
			if (!definition) {
				throw new Error(
					`Resolver "${resolverId}" emitted unregistered schema type "${atom.schemaType}".`
				);
			}

			const validationPayload =
				Object.keys(atom.data).length > 0
					? atom.data
					: {
							'@context': 'https://schema.org',
							'@type': atom.schemaType,
							name: atom.title,
							description: atom.description,
							sameAs: atom.sameAs.length > 0 ? atom.sameAs : undefined,
						};
			const validation = definition.schema.safeParse(validationPayload);

			if (!validation.success) {
				throw new Error(
					`Resolver "${resolverId}" emitted invalid payload for schema type "${atom.schemaType}".`
				);
			}
		}
	}

	private validateCanonicalClassifications(
		classifications: ClassificationCanonicalEnvelope[],
		resolverId: string
	): void {
		const registeredTypes = this.typeRegistry.list();
		if (registeredTypes.length === 0) {
			return;
		}

		for (const classification of classifications) {
			const definition = this.typeRegistry.get(classification.type);
			if (!definition) {
				throw new Error(
					`Resolver "${resolverId}" emitted unregistered canonical type "${classification.type}".`
				);
			}

			const validation = definition.schema.safeParse(classification.data);
			if (!validation.success) {
				throw new Error(
					`Resolver "${resolverId}" emitted invalid canonical data for type "${classification.type}".`
				);
			}
		}
	}

	private validateCompatibilityProjection(
		classifications: ClassificationCanonicalEnvelope[],
		atoms: ClassificationResolvedAtom[],
		resolverId: string
	): void {
		if (classifications.length !== atoms.length) {
			throw new Error(
				`Resolver "${resolverId}" canonical/legacy projection count mismatch (${classifications.length} classifications vs ${atoms.length} atoms).`
			);
		}

		const canonicalSignatures = classifications
			.map((classification) => canonicalClassificationSignature(classification))
			.sort((left, right) => left.localeCompare(right));
		const atomSignatures = atoms
			.map((atom) => atomCompatibilitySignature(atom))
			.sort((left, right) => left.localeCompare(right));

		for (let index = 0; index < canonicalSignatures.length; index += 1) {
			if (canonicalSignatures[index] !== atomSignatures[index]) {
				throw new Error(
					`Resolver "${resolverId}" canonical/legacy projection mismatch at index ${index}.`
				);
			}
		}
	}

	private mergeResultWithResolution(
		result: ClassificationResult,
		request: ClassificationRequest,
		classification: ClassificationClientClassificationHint | undefined,
		resolved: ClassificationResolvedPayload | undefined,
		resolverErrors: ClassificationResolverError[]
	): ClassificationResult {
		let mergedResolved = resolved;
		let message = resolved
			? `Resolved by ${resolved.resolverId} with ${resolved.atoms.length} candidate atom${resolved.atoms.length === 1 ? '' : 's'}.`
			: result.message;
		let progressiveProvenance: ClassificationFieldProvenanceMap | undefined;

		if (
			this.runtime === 'server' &&
			request.mode === 'progressive' &&
			classification &&
			mergedResolved &&
			request.clientHints?.clientResult
		) {
			const progressiveMerge = mergeProgressiveResolution({
				resolved: mergedResolved,
				classification,
				clientResult: request.clientHints.clientResult,
				clientClassification: request.clientHints.clientClassification,
				userEditedFields: extractUserEditedFields(request.clientHints.metadata),
				timestamp: this.now().toISOString(),
			});

			mergedResolved = progressiveMerge.resolved;
			progressiveProvenance = progressiveMerge.provenance;
			if (progressiveMerge.merged) {
				message = `${message} Client hints merged deterministically.`;
			}
		}

		if (mergedResolved) {
			mergedResolved = this.attachPublishableProjection(mergedResolved);
		}

		const status: ClassificationResult['status'] = mergedResolved
			? 'complete'
			: classification
				? 'partial'
				: 'placeholder';

		const merged: ClassificationResult = {
			...result,
			status,
			message,
			classification,
			resolved: mergedResolved,
			resolverErrors: resolverErrors.length > 0 ? resolverErrors : undefined,
			provenance:
				result.policy.includeProvenance && progressiveProvenance
					? {
							...(result.provenance ?? {}),
							...progressiveProvenance,
						}
					: result.provenance,
		};

		return classificationResultSchema.parse(this.syncResultWithRequest(merged, request));
	}

	private attachPublishableProjection(
		resolved: ClassificationResolvedPayload
	): ClassificationResolvedPayload {
		const publishable = projectPublishableClassifications(
			resolved.classifications,
			this.typeRegistry
		);

		return classificationResolvedPayloadSchema.parse({
			...resolved,
			publishable,
		});
	}

	private ensureSessionId(request: ClassificationRequest): ClassificationRequestWithSession {
		if (request.classificationSessionId) {
			return request as ClassificationRequestWithSession;
		}

		const nextRequest = {
			...request,
			classificationSessionId: this.createSessionId(),
		};

		return classificationRequestSchema.parse(nextRequest) as ClassificationRequestWithSession;
	}

	private createSessionId(): string {
		this.sessionCount += 1;
		return `${this.runtime}-${this.now().getTime().toString(36)}-${this.sessionCount.toString(36)}`;
	}

	private async executeHookStage(
		stage: HookStage,
		state: HookPipelineState
	): Promise<HookPipelineState> {
		let nextState = state;
		const orderedPlugins = this.getOrderedPlugins();

		for (const plugin of orderedPlugins) {
			const handler = plugin.hooks?.[stage];
			if (!handler) {
				continue;
			}

			const context = this.createHookContext(stage, nextState);

			try {
				const patch = await this.withTimeout(
					Promise.resolve(handler(context)),
					plugin.manifest.id,
					stage
				);

				if (patch) {
					nextState = this.applyPatch(nextState, patch);
				}
			} catch (error) {
				const normalizedError = normalizeError(error);
				this.recordHookError(plugin.manifest.id, stage, normalizedError);
				await this.runOnErrorHandler(plugin, stage, nextState, normalizedError);
			}
		}

		return nextState;
	}

	private createHookContext(stage: HookStage, state: HookPipelineState) {
		return deepFreeze({
			stage,
			runtime: this.runtime,
			request: cloneRequest(state.request),
			result: state.result ? cloneResult(state.result) : undefined,
			metadata: cloneRecord(state.metadata),
		});
	}

	private async runOnErrorHandler(
		plugin: RegisteredPlugin,
		stage: HookStage,
		state: HookPipelineState,
		error: Error
	): Promise<void> {
		const onError = plugin.hooks?.onError;
		if (!onError) {
			return;
		}

		const context = deepFreeze({
			...this.createHookContext(stage, state),
			error,
			pluginId: plugin.manifest.id,
		});

		try {
			await this.withTimeout(Promise.resolve(onError(context)), plugin.manifest.id, stage);
		} catch {
			// Secondary onError failures are intentionally isolated.
		}
	}

	private applyPatch(state: HookPipelineState, patch: HookPatch): HookPipelineState {
		let nextRequest = state.request;
		let nextResult = state.result;
		let nextMetadata = state.metadata;
		let nextClassification = state.classification;
		let nextResolved = state.resolved;
		let nextResolverErrors = state.resolverErrors;

		if (patch.request) {
			nextRequest = mergeRequest(nextRequest, patch.request);
			nextRequest = this.ensureSessionId(nextRequest);
		}

		if (patch.metadata) {
			nextMetadata = mergeMetadata(nextMetadata, patch.metadata);
		}

		if (patch.result) {
			if (!nextResult) {
				throw new Error('Cannot apply result patch before a classification result exists.');
			}

			nextResult = mergeResult(nextResult, patch.result);
			nextClassification = nextResult.classification;
			nextResolved = nextResult.resolved;
			nextResolverErrors = nextResult.resolverErrors ?? nextResolverErrors;
		}

		if (nextResult) {
			nextResult = classificationResultSchema.parse(
				this.syncResultWithRequest(nextResult, nextRequest)
			);
		}

		return {
			request: nextRequest,
			classification: nextClassification,
			resolved: nextResolved,
			resolverErrors: nextResolverErrors,
			result: nextResult,
			metadata: nextMetadata,
		};
	}

	private syncResultWithRequest(
		result: ClassificationResult,
		request: ClassificationRequest
	): ClassificationResult {
		const withSession = this.ensureSessionId(request);
		const policy = resolveEnhancementPolicy(withSession.mode, withSession.policy);
		const synced: ClassificationResult = {
			...result,
			runtime: this.runtime,
			mode: withSession.mode,
			classificationSessionId: withSession.classificationSessionId,
			policy,
			provenance: policy.includeProvenance
				? (result.provenance ?? deriveProvenance(result, this.runtime, this.now().toISOString()))
				: undefined,
			debug: {
				...result.debug,
				inputPreview: createInputPreview(withSession.input),
				hasClientHints: !!withSession.clientHints,
				inputIntent: withSession.inputIntent,
				requestedPluginIds: normalizePluginIds(withSession.pluginIds),
				requestedServerTiers: [...policy.requestedServerTiers],
			},
		};

		return classificationResultSchema.parse(synced);
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		pluginId: string,
		stage: HookStage
	): Promise<T> {
		if (this.hookTimeoutMs === 0) {
			return promise;
		}

		let timer: ReturnType<typeof setTimeout> | undefined;

		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timer = setTimeout(() => {
						reject(
							new Error(
								`Hook timed out after ${this.hookTimeoutMs}ms for plugin "${pluginId}" at stage "${stage}".`
							)
						);
					}, this.hookTimeoutMs);
				}),
			]);
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}

	private getOrderedPlugins(): RegisteredPlugin[] {
		const plugins = this.pluginOrder
			.map((id) => this.pluginsById.get(id))
			.filter((plugin): plugin is RegisteredPlugin => !!plugin);

		if (plugins.length > 0) {
			return plugins;
		}

		return resolvePluginOrder(Array.from(this.pluginsById.values()));
	}

	private getOrderedClassifiers(requestedPluginIds?: ReadonlySet<string>): RegisteredClassifier[] {
		const classifiers = this.classifierOrder
			.map((id) => this.classifiersById.get(id))
			.filter((classifier): classifier is RegisteredClassifier => !!classifier);

		if (classifiers.length > 0) {
			return requestedPluginIds
				? classifiers.filter((classifier) => requestedPluginIds.has(classifier.pluginId))
				: classifiers;
		}

		const ordered = resolveClassifierOrder(Array.from(this.classifiersById.values()));
		return requestedPluginIds
			? ordered.filter((classifier) => requestedPluginIds.has(classifier.pluginId))
			: ordered;
	}

	private getOrderedResolvers(requestedPluginIds?: ReadonlySet<string>): RegisteredResolver[] {
		const resolvers = this.resolverOrder
			.map((id) => this.resolversById.get(id))
			.filter((resolver): resolver is RegisteredResolver => !!resolver);

		if (resolvers.length > 0) {
			return requestedPluginIds
				? resolvers.filter((resolver) => requestedPluginIds.has(resolver.pluginId))
				: resolvers;
		}

		const ordered = resolveResolverOrder(Array.from(this.resolversById.values()));
		return requestedPluginIds
			? ordered.filter((resolver) => requestedPluginIds.has(resolver.pluginId))
			: ordered;
	}

	private recordHookError(pluginId: string, stage: HookStage, error: Error): void {
		this.lastHookErrors.push({
			pluginId,
			stage,
			message: error.message,
			timestamp: this.now().toISOString(),
		});
	}
}

function resolvePluginOrder(plugins: RegisteredPlugin[]): RegisteredPlugin[] {
	const byId = new Map<string, RegisteredPlugin>();
	const dependents = new Map<string, Set<string>>();
	const inDegree = new Map<string, number>();

	for (const plugin of plugins) {
		byId.set(plugin.manifest.id, plugin);
		dependents.set(plugin.manifest.id, new Set());
		inDegree.set(plugin.manifest.id, 0);
	}

	for (const plugin of plugins) {
		const pluginId = plugin.manifest.id;
		for (const dependencyId of plugin.manifest.dependsOn) {
			if (!byId.has(dependencyId)) {
				throw new Error(`Plugin "${pluginId}" depends on missing plugin "${dependencyId}".`);
			}

			dependents.get(dependencyId)?.add(pluginId);
			inDegree.set(pluginId, (inDegree.get(pluginId) ?? 0) + 1);
		}
	}

	const available = Array.from(byId.values()).filter(
		(plugin) => (inDegree.get(plugin.manifest.id) ?? 0) === 0
	);
	available.sort(comparePlugins);

	const ordered: RegisteredPlugin[] = [];

	while (available.length > 0) {
		const current = available.shift();
		if (!current) {
			break;
		}

		ordered.push(current);
		for (const dependentId of dependents.get(current.manifest.id) ?? []) {
			const nextInDegree = (inDegree.get(dependentId) ?? 0) - 1;
			inDegree.set(dependentId, nextInDegree);

			if (nextInDegree === 0) {
				const dependent = byId.get(dependentId);
				if (dependent) {
					available.push(dependent);
					available.sort(comparePlugins);
				}
			}
		}
	}

	if (ordered.length !== plugins.length) {
		const cycle = Array.from(inDegree.entries())
			.filter(([, degree]) => degree > 0)
			.map(([id]) => id)
			.sort((left, right) => left.localeCompare(right));

		throw new Error(`Plugin dependency cycle detected: ${cycle.join(', ')}.`);
	}

	return ordered;
}

function resolveClassifierOrder(classifiers: RegisteredClassifier[]): RegisteredClassifier[] {
	return [...classifiers].sort((left, right) => {
		if (left.priority !== right.priority) {
			return left.priority - right.priority;
		}

		if (left.id !== right.id) {
			return left.id.localeCompare(right.id);
		}

		return left.registrationOrder - right.registrationOrder;
	});
}

function resolveResolverOrder(resolvers: RegisteredResolver[]): RegisteredResolver[] {
	return [...resolvers].sort((left, right) => {
		if (left.priority !== right.priority) {
			return left.priority - right.priority;
		}

		if (left.id !== right.id) {
			return left.id.localeCompare(right.id);
		}

		return left.registrationOrder - right.registrationOrder;
	});
}

function comparePlugins(left: RegisteredPlugin, right: RegisteredPlugin): number {
	if (left.manifest.priority !== right.manifest.priority) {
		return left.manifest.priority - right.manifest.priority;
	}

	return left.manifest.id.localeCompare(right.manifest.id);
}

function mergeRequest(
	current: ClassificationRequest,
	patch: Partial<ClassificationRequest>
): ClassificationRequest {
	const merged = {
		...current,
		...patch,
		policy: patch.policy ? { ...(current.policy ?? {}), ...patch.policy } : current.policy,
		clientHints: patch.clientHints
			? { ...(current.clientHints ?? {}), ...patch.clientHints }
			: current.clientHints,
	};

	return classificationRequestSchema.parse(merged);
}

function mergeResult(
	current: ClassificationResult,
	patch: Partial<ClassificationResult>
): ClassificationResult {
	const merged = {
		...current,
		...patch,
		policy: patch.policy ? { ...current.policy, ...patch.policy } : current.policy,
		debug: patch.debug ? { ...current.debug, ...patch.debug } : current.debug,
		provenance: patch.provenance
			? { ...(current.provenance ?? {}), ...patch.provenance }
			: current.provenance,
	};

	return classificationResultSchema.parse(merged);
}

function mergeMetadata(
	current: Record<string, unknown>,
	patch: Record<string, unknown>
): Record<string, unknown> {
	return {
		...current,
		...patch,
	};
}

function normalizePluginIds(pluginIds: string[] | undefined): string[] {
	if (!pluginIds || pluginIds.length === 0) {
		return [];
	}

	return Array.from(new Set(pluginIds)).sort((left, right) => left.localeCompare(right));
}

function resolveRequestedPluginIds(
	pluginIds: string[] | undefined,
	pluginsById: ReadonlyMap<string, RegisteredPlugin>
): ReadonlySet<string> | undefined {
	const normalizedPluginIds = normalizePluginIds(pluginIds);
	if (normalizedPluginIds.length === 0) {
		return undefined;
	}

	const requestedPluginIds = new Set<string>();
	for (const pluginId of normalizedPluginIds) {
		if (pluginsById.has(pluginId)) {
			requestedPluginIds.add(pluginId);
		}
	}

	return requestedPluginIds;
}

function filterClassifiersForInputIntent(
	classifiers: RegisteredClassifier[],
	request: ClassificationRequest
): RegisteredClassifier[] {
	if (request.inputIntent !== 'url-first') {
		return classifiers;
	}

	const lexicalRequested = normalizePluginIds(request.pluginIds).includes('lexical');
	const plainTextRequested = normalizePluginIds(request.pluginIds).includes('plain-text');
	if (lexicalRequested || plainTextRequested) {
		return classifiers;
	}

	return classifiers.filter(
		(classifier) => classifier.pluginId !== 'lexical' && classifier.pluginId !== 'plain-text'
	);
}

function shouldShortCircuitUrlFirstFallback(request: ClassificationRequest): boolean {
	return request.inputIntent === 'url-first' && !isHttpUrlInput(request.input.trim());
}

function buildClassificationNoOpMessage(request: ClassificationRequest): string {
	if (request.inputIntent === 'url-first') {
		return 'No supported URL or identifier matched. URL-first mode expects an HTTP(S) URL or an explicitly supported identifier.';
	}

	return 'No deterministic classifier matched the input.';
}

function isHttpUrlInput(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function mergeProgressiveResolution(input: {
	resolved: ClassificationResolvedPayload;
	classification: ClassificationClientClassificationHint;
	clientResult: ClientResultHint;
	clientClassification?: ClassificationClientClassificationHint;
	userEditedFields: Set<string>;
	timestamp: string;
}): {
	resolved: ClassificationResolvedPayload;
	provenance: ClassificationFieldProvenanceMap;
	merged: boolean;
} {
	const serverPrimary = input.resolved.atoms[0];
	if (!serverPrimary) {
		return {
			resolved: input.resolved,
			provenance: {},
			merged: false,
		};
	}

	const clientAtom = createClientHintAtom({
		classification: input.classification,
		clientResult: input.clientResult,
		fallbackCategory: serverPrimary.category,
	});

	const mergeOutcome = mergeServerAndClientAtom({
		serverAtom: serverPrimary,
		clientAtom,
		serverResolverId: input.resolved.resolverId,
		clientResolverId: input.clientResult.resolvedBy,
		timestamp: input.timestamp,
		serverConfidence: clampConfidence(Math.max(input.classification.confidence, 0.8)),
		clientConfidence: clampConfidence(
			input.clientClassification?.confidence ?? input.classification.confidence
		),
		userEditedFields: input.userEditedFields,
	});

	const resolverChain = [...input.resolved.resolverChain];
	const clientHintResolver = `client-hint:${input.clientResult.resolvedBy}`;
	if (!resolverChain.includes(clientHintResolver)) {
		resolverChain.push(clientHintResolver);
	}

	const mergedResolved = buildResolvedPayload({
		classification: input.classification,
		resolverId: input.resolved.resolverId,
		resolverChain,
		atoms: [mergeOutcome.atom, ...input.resolved.atoms.slice(1)],
		fetchedAt: input.timestamp,
		fallbackUsed: input.resolved.fallbackUsed,
	});

	return {
		resolved: mergedResolved,
		provenance: {
			...mergeOutcome.provenance,
			'/resolved/dedupeKey': createProvenanceEntry({
				source: mergeOutcome.merged ? 'merged' : 'server',
				timestamp: input.timestamp,
				serverConfidence: mergeOutcome.serverConfidence,
				clientConfidence: mergeOutcome.clientConfidence,
				serverResolverId: input.resolved.resolverId,
				clientResolverId: input.clientResult.resolvedBy,
			}),
		},
		merged: mergeOutcome.merged,
	};
}

function mergeServerAndClientAtom(input: {
	serverAtom: ClassificationResolvedAtom;
	clientAtom: ClassificationResolvedAtom;
	serverResolverId: string;
	clientResolverId: string;
	timestamp: string;
	serverConfidence: number;
	clientConfidence: number;
	userEditedFields: Set<string>;
}): {
	atom: ClassificationResolvedAtom;
	provenance: ClassificationFieldProvenanceMap;
	merged: boolean;
	serverConfidence: number;
	clientConfidence: number;
} {
	const provenance: ClassificationFieldProvenanceMap = {};
	let merged = false;

	const titleChoice = chooseMergedField({
		path: 'title',
		serverValue: input.serverAtom.title,
		clientValue: input.clientAtom.title,
		serverConfidence: input.serverConfidence,
		clientConfidence: input.clientConfidence,
		userEditedFields: input.userEditedFields,
	});
	const title = toStringMaybe(titleChoice.value) ?? input.serverAtom.title;
	provenance['/resolved/atoms/0/title'] = createProvenanceEntry({
		source: titleChoice.source,
		timestamp: input.timestamp,
		serverConfidence: input.serverConfidence,
		clientConfidence: input.clientConfidence,
		serverResolverId: input.serverResolverId,
		clientResolverId: input.clientResolverId,
	});
	merged = merged || titleChoice.fromClient;

	const descriptionChoice = chooseMergedField({
		path: 'description',
		serverValue: input.serverAtom.description,
		clientValue: input.clientAtom.description,
		serverConfidence: input.serverConfidence,
		clientConfidence: input.clientConfidence,
		userEditedFields: input.userEditedFields,
	});
	const description = toStringMaybe(descriptionChoice.value);
	if (description) {
		provenance['/resolved/atoms/0/description'] = createProvenanceEntry({
			source: descriptionChoice.source,
			timestamp: input.timestamp,
			serverConfidence: input.serverConfidence,
			clientConfidence: input.clientConfidence,
			serverResolverId: input.serverResolverId,
			clientResolverId: input.clientResolverId,
		});
	}
	merged = merged || descriptionChoice.fromClient;

	const canonicalId = toStringMaybe(input.serverAtom.canonicalId ?? input.clientAtom.canonicalId);
	const canonicalSource = toStringMaybe(input.serverAtom.canonicalId) ? 'server' : 'client';
	if (canonicalId) {
		provenance['/resolved/atoms/0/canonicalId'] = createProvenanceEntry({
			source: canonicalSource,
			timestamp: input.timestamp,
			serverConfidence: input.serverConfidence,
			clientConfidence: input.clientConfidence,
			serverResolverId: input.serverResolverId,
			clientResolverId: input.clientResolverId,
		});
	}
	merged =
		merged ||
		(!toStringMaybe(input.serverAtom.canonicalId) && !!toStringMaybe(input.clientAtom.canonicalId));

	const serverSameAs = normalizeStringArray(input.serverAtom.sameAs ?? []);
	const clientSameAs = normalizeStringArray(input.clientAtom.sameAs ?? []);
	const mergedSameAs = mergeUniqueArrays(serverSameAs, clientSameAs);
	let sameAsSource: ProvenanceSource = 'server';

	if (matchesUserEditedField(input.userEditedFields, 'sameAs') && clientSameAs.length > 0) {
		sameAsSource = 'user';
	} else if (clientSameAs.some((value) => !serverSameAs.includes(value))) {
		sameAsSource = 'merged';
	}

	if (mergedSameAs.length > 0) {
		provenance['/resolved/atoms/0/sameAs'] = createProvenanceEntry({
			source: sameAsSource,
			timestamp: input.timestamp,
			serverConfidence: input.serverConfidence,
			clientConfidence: input.clientConfidence,
			serverResolverId: input.serverResolverId,
			clientResolverId: input.clientResolverId,
		});
	}
	merged = merged || sameAsSource !== 'server';

	const mergedData: Record<string, unknown> = {};
	const serverData = toRecordMaybe(input.serverAtom.data) ?? {};
	const clientData = toRecordMaybe(input.clientAtom.data) ?? {};
	const dataKeys = Array.from(
		new Set([...Object.keys(serverData), ...Object.keys(clientData)])
	).sort((left, right) => left.localeCompare(right));

	for (const key of dataKeys) {
		const choice = chooseMergedField({
			path: `data.${key}`,
			serverValue: serverData[key],
			clientValue: clientData[key],
			serverConfidence: input.serverConfidence,
			clientConfidence: input.clientConfidence,
			userEditedFields: input.userEditedFields,
		});

		if (choice.value === undefined) {
			continue;
		}

		mergedData[key] = choice.value;
		provenance[`/resolved/atoms/0/data/${escapeJsonPointer(key)}`] = createProvenanceEntry({
			source: choice.source,
			timestamp: input.timestamp,
			serverConfidence: input.serverConfidence,
			clientConfidence: input.clientConfidence,
			serverResolverId: input.serverResolverId,
			clientResolverId: input.clientResolverId,
		});
		merged = merged || choice.fromClient;
	}

	const mergedMetadata = {
		...(toRecordMaybe(input.serverAtom.metadata) ?? {}),
		...(toRecordMaybe(input.clientAtom.metadata) ?? {}),
	};
	const mergedHints = {
		...(toRecordMaybe(input.serverAtom.hints) ?? {}),
		...(toRecordMaybe(input.clientAtom.hints) ?? {}),
	};
	const source = merged ? 'merged' : input.serverAtom.source;
	const mergedAtom = classificationResolvedAtomSchema.parse({
		...input.serverAtom,
		title,
		description,
		canonicalId,
		sameAs: mergedSameAs,
		source,
		confidence: clampConfidence(
			Math.max(
				toNumberMaybe(input.serverAtom.confidence) ?? input.serverConfidence,
				toNumberMaybe(input.clientAtom.confidence) ?? input.clientConfidence
			)
		),
		hints: mergedHints,
		metadata: mergedMetadata,
		data: mergedData,
	});

	provenance['/resolved/atoms/0/source'] = createProvenanceEntry({
		source: merged ? 'merged' : 'server',
		timestamp: input.timestamp,
		serverConfidence: input.serverConfidence,
		clientConfidence: input.clientConfidence,
		serverResolverId: input.serverResolverId,
		clientResolverId: input.clientResolverId,
	});

	return {
		atom: mergedAtom,
		provenance,
		merged,
		serverConfidence: input.serverConfidence,
		clientConfidence: input.clientConfidence,
	};
}

function createClientHintAtom(input: {
	classification: ClassificationClientClassificationHint;
	clientResult: ClientResultHint;
	fallbackCategory: ClassificationResolvedAtom['category'];
}): ClassificationResolvedAtom {
	const explicitData = toRecordMaybe(input.clientResult.data) ?? {};
	const title =
		toStringMaybe(explicitData.name) ??
		toStringMaybe(explicitData.title) ??
		toStringMaybe(explicitData.headline) ??
		toStringMaybe(explicitData.label) ??
		inferFallbackClientTitle(input.classification);

	const description =
		toStringMaybe(explicitData.description) ?? toStringMaybe(explicitData.summary);
	const canonicalId =
		toStringMaybe(explicitData.canonicalId) ?? toStringMaybe(explicitData.identifier);

	const sameAs = normalizeStringArray(
		[
			...extractStringArray(explicitData.sameAs),
			toStringMaybe(explicitData.url),
			toStringMaybe(explicitData.canonicalUrl),
		].filter((value): value is string => !!value)
	);

	return classificationResolvedAtomSchema.parse({
		schemaType: input.clientResult.schemaType,
		category: input.clientResult.category ?? input.fallbackCategory,
		title,
		description,
		canonicalId,
		sameAs,
		source: input.clientResult.source ?? `client:${input.clientResult.resolvedBy}`,
		confidence: clampConfidence(
			toNumberMaybe(input.clientResult.confidence) ?? input.classification.confidence
		),
		pluginId: 'client-hints',
		resolverId: `client-hint:${input.clientResult.resolvedBy}`,
		hints: toRecordMaybe(input.clientResult.hints) ?? {},
		metadata: {
			...(toRecordMaybe(input.clientResult.metadata) ?? {}),
			clientHint: true,
		},
		data: buildAtomDataShape({
			schemaType: input.clientResult.schemaType,
			title,
			description,
			canonicalId,
			sameAs,
			explicitData,
		}),
	});
}

function chooseMergedField(input: {
	path: string;
	serverValue: unknown;
	clientValue: unknown;
	serverConfidence: number;
	clientConfidence: number;
	userEditedFields: Set<string>;
}): { value: unknown; source: ProvenanceSource; fromClient: boolean } {
	const hasServer = hasMeaningfulValue(input.serverValue);
	const hasClient = hasMeaningfulValue(input.clientValue);
	const userEdited = matchesUserEditedField(input.userEditedFields, input.path);

	if (userEdited && hasClient) {
		return {
			value: input.clientValue,
			source: 'user',
			fromClient: !valuesEqual(input.serverValue, input.clientValue),
		};
	}

	if (hasServer && !hasClient) {
		return {
			value: input.serverValue,
			source: 'server',
			fromClient: false,
		};
	}

	if (!hasServer && hasClient) {
		return {
			value: input.clientValue,
			source: 'client',
			fromClient: true,
		};
	}

	if (!hasServer && !hasClient) {
		return {
			value: undefined,
			source: 'server',
			fromClient: false,
		};
	}

	if (valuesEqual(input.serverValue, input.clientValue)) {
		return {
			value: input.serverValue,
			source: 'server',
			fromClient: false,
		};
	}

	if (input.clientConfidence > input.serverConfidence) {
		return {
			value: input.clientValue,
			source: 'client',
			fromClient: true,
		};
	}

	return {
		value: input.serverValue,
		source: 'server',
		fromClient: false,
	};
}

function createProvenanceEntry(input: {
	source: ProvenanceSource;
	timestamp: string;
	serverConfidence: number;
	clientConfidence: number;
	serverResolverId: string;
	clientResolverId: string;
}): ClassificationFieldProvenanceMap[string] {
	const tierBySource: Record<ProvenanceSource, 0 | 1 | 2 | 3> = {
		user: 0,
		client: 1,
		server: 2,
		merged: 3,
	};

	const confidenceBySource: Record<ProvenanceSource, number> = {
		user: 1,
		client: input.clientConfidence,
		server: input.serverConfidence,
		merged: Math.max(input.serverConfidence, input.clientConfidence),
	};

	return {
		source: input.source,
		confidence: clampConfidence(confidenceBySource[input.source]),
		updatedAt: input.timestamp,
		tier: tierBySource[input.source],
		resolverId:
			input.source === 'client'
				? input.clientResolverId
				: input.source === 'user'
					? undefined
					: input.serverResolverId,
	};
}

function extractUserEditedFields(metadata: Record<string, unknown> | undefined): Set<string> {
	const raw = toRecordMaybe(metadata)?.userEditedFields;
	if (!Array.isArray(raw)) {
		return new Set();
	}

	const fields = raw
		.filter((value): value is string => typeof value === 'string')
		.map((value) => value.trim())
		.filter(Boolean);

	return new Set(fields);
}

function matchesUserEditedField(userEditedFields: Set<string>, path: string): boolean {
	if (userEditedFields.size === 0) {
		return false;
	}

	const pointer = `/${path.replaceAll('.', '/')}`;
	const resolvedPointer = `/resolved/atoms/0/${path.replaceAll('.', '/')}`;
	return (
		userEditedFields.has(path) ||
		userEditedFields.has(pointer) ||
		userEditedFields.has(resolvedPointer)
	);
}

function inferFallbackClientTitle(classification: ClassificationClientClassificationHint): string {
	const resourceId = toStringMaybe(classification.meta.resourceId);
	if (resourceId) {
		return `${classification.domain}:${resourceId}`;
	}

	return `${classification.domain}:${classification.subtype}`;
}

function createInputPreview(input: string): string {
	const collapsed = input.replace(/\s+/g, ' ').trim();
	if (collapsed.length <= 120) {
		return collapsed;
	}

	return `${collapsed.slice(0, 117)}...`;
}

function normalizeError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	return new Error('Unknown runtime execution error.');
}

function normalizeResolverAtoms(
	atoms: ResolverAtom[],
	input: {
		resolverId: string;
		pluginId: string;
		classificationConfidence: number;
	}
): ClassificationResolvedAtom[] {
	const normalized = atoms.map((atom) => {
		const explicitData = toRecordMaybe(atom.data) ?? {};
		const sameAs = normalizeStringArray(atom.sameAs ?? []);
		const description = toStringMaybe(atom.description);
		const canonicalId = toStringMaybe(atom.canonicalId);

		return classificationResolvedAtomSchema.parse({
			schemaType: atom.schemaType,
			category: atom.category,
			title: atom.title,
			description,
			canonicalId,
			sameAs,
			source: atom.source ?? input.resolverId,
			confidence: clampConfidence(
				toNumberMaybe(atom.confidence) ??
					toNumberMaybe(explicitData.confidence) ??
					input.classificationConfidence
			),
			pluginId: input.pluginId,
			resolverId: input.resolverId,
			hints: toRecordMaybe(atom.hints) ?? {},
			metadata: toRecordMaybe(atom.metadata) ?? {},
			data:
				Object.keys(explicitData).length > 0 && shouldPreserveExplicitResolverData(atom.schemaType)
					? mergeDataSameAs(explicitData, sameAs)
					: buildAtomDataShape({
							schemaType: atom.schemaType,
							title: atom.title,
							description,
							canonicalId,
							sameAs,
							explicitData,
						}),
		});
	});

	return dedupeAtoms(normalized);
}

function normalizeResolverOutput(input: {
	output: {
		atoms?: ResolverAtom[];
		classifications?: ResolverClassification[];
		metadata?: Record<string, unknown>;
	};
	resolverId: string;
	pluginId: string;
	classificationConfidence: number;
	fetchedAt: string;
}): {
	atoms: ClassificationResolvedAtom[];
	classifications: ClassificationCanonicalEnvelope[];
	metaMismatches: string[];
} {
	const normalizedLegacyAtoms = input.output.atoms
		? normalizeResolverAtoms(input.output.atoms, {
				resolverId: input.resolverId,
				pluginId: input.pluginId,
				classificationConfidence: input.classificationConfidence,
			})
		: [];
	const normalizedLegacyClassifications = normalizedLegacyAtoms.map((atom) =>
		toCanonicalClassification({
			atom,
			fetchedAt: input.fetchedAt,
			defaultPluginId: input.pluginId,
			defaultProvider: input.resolverId,
		})
	);

	const normalizedCanonicalClassifications = input.output.classifications
		? normalizeResolverClassifications(input.output.classifications, {
				resolverId: input.resolverId,
				pluginId: input.pluginId,
				classificationConfidence: input.classificationConfidence,
				fetchedAt: input.fetchedAt,
			})
		: [];

	if (normalizedCanonicalClassifications.length > 0) {
		const canonical = dedupeCanonicalClassifications(normalizedCanonicalClassifications);
		const atoms = dedupeAtoms(
			canonical.map((classification) =>
				toLegacyAtomFromCanonical({
					classification,
					resolverId: input.resolverId,
					classificationConfidence: input.classificationConfidence,
				})
			)
		);
		const metaMismatches: string[] = [];

		if (normalizedLegacyClassifications.length > 0) {
			const legacySignatures = normalizedLegacyClassifications
				.map((classification) => canonicalClassificationSignature(classification))
				.sort((left, right) => left.localeCompare(right));
			const canonicalSignatures = canonical
				.map((classification) => canonicalClassificationSignature(classification))
				.sort((left, right) => left.localeCompare(right));
			if (stableStringify(legacySignatures) !== stableStringify(canonicalSignatures)) {
				metaMismatches.push('canonical-and-legacy-resolver-payloads-diverged');
			}
		}

		return {
			atoms,
			classifications: canonical,
			metaMismatches,
		};
	}

	return {
		atoms: normalizedLegacyAtoms,
		classifications: dedupeCanonicalClassifications(normalizedLegacyClassifications),
		metaMismatches: [],
	};
}

function normalizeResolverClassifications(
	classifications: ResolverClassification[],
	input: {
		resolverId: string;
		pluginId: string;
		classificationConfidence: number;
		fetchedAt: string;
	}
): ClassificationCanonicalEnvelope[] {
	const normalized: ClassificationCanonicalEnvelope[] = [];

	for (const classification of classifications) {
		const type = toStringMaybe(classification.type);
		const data = toRecordMaybe(classification.data) ?? {};
		const metaRecord = toRecordMaybe(classification.meta) ?? {};
		const fetchedAt =
			toStringMaybe(metaRecord.fetchedAt) ?? toStringMaybe(metaRecord.updatedAt) ?? input.fetchedAt;
		const sourceUrl =
			toStringMaybe(metaRecord.sourceUrl) ?? extractSourceUrlFromCanonicalData(data);
		const confidence = clampConfidence(
			toNumberMaybe(metaRecord.confidence) ?? input.classificationConfidence
		);
		const sameAs = normalizeStringArray([
			...extractStringArray(data.sameAs),
			...(sourceUrl ? [sourceUrl] : []),
		]);
		const normalizedData = mergeDataSameAs(data, sameAs);

		if (!type) {
			continue;
		}

		normalized.push(
			classificationCanonicalEnvelopeSchema.parse({
				type,
				data: normalizedData,
				meta: {
					pluginId: toStringMaybe(metaRecord.pluginId) ?? input.pluginId,
					provider: toStringMaybe(metaRecord.provider) ?? input.resolverId,
					fetchedAt,
					sourceUrl,
					confidence,
					resolutionMode:
						toStringMaybe(metaRecord.resolutionMode) === 'enriched'
							? 'enriched'
							: toStringMaybe(metaRecord.resolutionMode) === 'identity-only'
								? 'identity-only'
								: undefined,
					sourceFamily: normalizeSourceFamily(metaRecord.sourceFamily),
					fieldPolicies: normalizeFieldPolicies(metaRecord.fieldPolicies),
				},
			})
		);
	}

	return normalized;
}

function toCanonicalClassification(input: {
	atom: ClassificationResolvedAtom;
	fetchedAt: string;
	defaultPluginId: string;
	defaultProvider: string;
}): ClassificationCanonicalEnvelope {
	const metadata = toRecordMaybe(input.atom.metadata) ?? {};
	const sourceUrl =
		toStringMaybe(metadata.sourceUrl) ??
		extractSourceUrlFromCanonicalData(input.atom.data) ??
		input.atom.sameAs.find((value) => isHttpUrl(value)) ??
		(toStringMaybe(input.atom.canonicalId) && isHttpUrl(input.atom.canonicalId)
			? input.atom.canonicalId
			: undefined);
	const data =
		Object.keys(input.atom.data).length > 0
			? input.atom.data
			: buildAtomDataShape({
					schemaType: input.atom.schemaType,
					title: input.atom.title,
					description: input.atom.description,
					canonicalId: input.atom.canonicalId,
					sameAs: input.atom.sameAs,
				});

	return classificationCanonicalEnvelopeSchema.parse({
		type: input.atom.schemaType,
		data,
		meta: {
			pluginId:
				toStringMaybe(metadata.pluginId) ??
				toStringMaybe(input.atom.pluginId) ??
				input.defaultPluginId,
			provider:
				toStringMaybe(metadata.provider) ??
				toStringMaybe(input.atom.source) ??
				input.defaultProvider,
			fetchedAt: toStringMaybe(metadata.fetchedAt) ?? input.fetchedAt,
			sourceUrl,
			confidence: clampConfidence(
				toNumberMaybe(metadata.confidence) ?? input.atom.confidence ?? 0.5
			),
			resolutionMode:
				toStringMaybe(metadata.resolutionMode) === 'enriched'
					? 'enriched'
					: toStringMaybe(metadata.resolutionMode) === 'identity-only'
						? 'identity-only'
						: undefined,
			sourceFamily: normalizeSourceFamily(metadata.sourceFamily),
			fieldPolicies: normalizeFieldPolicies(metadata.fieldPolicies),
		},
	});
}

function projectPublishableClassifications(
	classifications: ClassificationCanonicalEnvelope[],
	typeRegistry: JsonLdTypeRegistry
): ClassificationCanonicalEnvelope[] {
	return dedupeCanonicalClassifications(
		classifications
			.map((classification) =>
				projectPublishableClassification(classification, typeRegistry.get(classification.type))
			)
			.filter(
				(classification): classification is ClassificationCanonicalEnvelope => !!classification
			)
	);
}

function projectPublishableClassification(
	classification: ClassificationCanonicalEnvelope,
	definition: JsonLdTypeDefinition | undefined
): ClassificationCanonicalEnvelope | null {
	const data = toRecordMaybe(classification.data) ?? {};
	const projectedData = filterPublishableData(data, classification, definition);
	if (Object.keys(projectedData).length === 0) {
		const sourceUrl = toStringMaybe(classification.meta.sourceUrl);
		if (!sourceUrl) {
			return null;
		}

		projectedData.sameAs = [sourceUrl];
	}

	if (!projectedData.sameAs && classification.meta.sourceUrl) {
		projectedData.sameAs = [classification.meta.sourceUrl];
	}

	return classificationCanonicalEnvelopeSchema.parse({
		...classification,
		data: projectedData,
	});
}

function filterPublishableData(
	data: Record<string, unknown>,
	classification: ClassificationCanonicalEnvelope,
	definition: JsonLdTypeDefinition | undefined
): Record<string, unknown> {
	const allowedKeys = new Set<string>([
		...(definition?.requiredFields ?? []),
		...(definition?.identityFields ?? []),
		...PUBLISHABLE_STABLE_FIELDS,
	]);

	const projected: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		const fieldPolicy = getFieldPolicy(classification.meta, key);
		if (
			NON_PUBLISHABLE_MEDIA_FIELDS.has(key) ||
			NON_PUBLISHABLE_VOLATILE_FIELDS.has(key) ||
			fieldPolicy?.promotionTier === 'volatile'
		) {
			continue;
		}

		const isAllowedByIdentityPolicy =
			fieldPolicy?.promotionTier === 'identity' || key.startsWith('@') || allowedKeys.has(key);
		const isAllowedByRichPublicPolicy =
			fieldPolicy?.promotionTier === 'rich-public' &&
			isRichPublicFieldAllowed(classification.meta, key);

		if (!isAllowedByIdentityPolicy && !isAllowedByRichPublicPolicy) {
			continue;
		}

		const normalizedValue = normalizePublishableValue(key, value);
		if (normalizedValue === undefined) {
			continue;
		}

		projected[key] = normalizedValue;
	}

	return projected;
}

function normalizePublishableValue(key: string, value: unknown): unknown {
	if (typeof value === 'string') {
		const normalized = value.trim();
		return normalized.length > 0 ? normalized : undefined;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}

	if (Array.isArray(value)) {
		const normalizedArray = value
			.filter((entry): entry is string => typeof entry === 'string')
			.map((entry) => entry.trim())
			.filter(Boolean);
		return normalizedArray.length > 0 ? normalizedArray : undefined;
	}

	const record = toRecordMaybe(value);
	if (!record) {
		return undefined;
	}

	const nestedAllowedKeys =
		key === 'brand' ? new Set(['name', 'url', 'sameAs', 'identifier']) : PUBLISHABLE_STABLE_FIELDS;
	const normalizedRecord: Record<string, unknown> = {};

	for (const [nestedKey, nestedValue] of Object.entries(record)) {
		if (
			NON_PUBLISHABLE_MEDIA_FIELDS.has(nestedKey) ||
			NON_PUBLISHABLE_VOLATILE_FIELDS.has(nestedKey) ||
			!nestedAllowedKeys.has(nestedKey)
		) {
			continue;
		}

		const normalizedNestedValue = normalizePublishableValue(nestedKey, nestedValue);
		if (normalizedNestedValue === undefined) {
			continue;
		}

		normalizedRecord[nestedKey] = normalizedNestedValue;
	}

	return Object.keys(normalizedRecord).length > 0 ? normalizedRecord : undefined;
}

function normalizeSourceFamily(value: unknown): ClassificationSourceFamily | undefined {
	const normalized = toStringMaybe(value);
	switch (normalized) {
		case 'jsonld':
		case 'oembed':
		case 'opengraph':
		case 'public-json':
		case 'domain-html':
		case 'domain-api':
			return normalized;
		default:
			return undefined;
	}
}

function normalizeFieldPolicies(value: unknown): ClassificationCanonicalFieldPolicyMap | undefined {
	const record = toRecordMaybe(value);
	if (!record) {
		return undefined;
	}

	const normalized: ClassificationCanonicalFieldPolicyMap = {};
	for (const [key, entry] of Object.entries(record)) {
		const entryRecord = toRecordMaybe(entry);
		if (!entryRecord) {
			continue;
		}

		const promotionTier = toStringMaybe(entryRecord.promotionTier);
		if (
			promotionTier !== 'identity' &&
			promotionTier !== 'rich-public' &&
			promotionTier !== 'volatile'
		) {
			continue;
		}

		normalized[key] = {
			promotionTier,
			sourceFamily: normalizeSourceFamily(entryRecord.sourceFamily),
		};
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toLegacyAtomFromCanonical(input: {
	classification: ClassificationCanonicalEnvelope;
	resolverId: string;
	classificationConfidence: number;
}): ClassificationResolvedAtom {
	const data = toRecordMaybe(input.classification.data) ?? {};
	const sameAs = normalizeStringArray(
		[
			...extractStringArray(data.sameAs),
			toStringMaybe(data.url),
			toStringMaybe(data.contentUrl),
			toStringMaybe(input.classification.meta.sourceUrl),
		].filter((value): value is string => !!value)
	);
	const canonicalId = resolveCanonicalIdFromClassification(input.classification, sameAs);
	const description = resolveCanonicalDescription(data);
	const title = resolveCanonicalTitle(input.classification.type, data, canonicalId, sameAs);

	return classificationResolvedAtomSchema.parse({
		schemaType: input.classification.type,
		category: resolveLegacyCategoryForCanonicalType(input.classification.type),
		title,
		description,
		canonicalId,
		sameAs,
		source: input.classification.meta.provider,
		confidence: clampConfidence(
			input.classification.meta.confidence ?? input.classificationConfidence
		),
		pluginId: input.classification.meta.pluginId,
		resolverId: input.resolverId,
		hints: {},
		metadata: {
			pluginId: input.classification.meta.pluginId,
			provider: input.classification.meta.provider,
			fetchedAt: input.classification.meta.fetchedAt,
			sourceUrl: input.classification.meta.sourceUrl,
			confidence: input.classification.meta.confidence,
			resolutionMode: input.classification.meta.resolutionMode,
			canonicalType: input.classification.type,
		},
		data,
	});
}

function resolveLegacyCategoryForCanonicalType(
	type: string
): ClassificationResolvedAtom['category'] {
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
	if (normalized === 'product' || normalized === 'ethereumerc20' || normalized === 'brand') {
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

function resolveCanonicalTitle(
	type: string,
	data: Record<string, unknown>,
	canonicalId: string | undefined,
	sameAs: string[]
): string {
	const name = toStringMaybe(data.name);
	if (name) {
		return name;
	}

	if (type === 'Person') {
		const givenName = toStringMaybe(data.givenName);
		const familyName = toStringMaybe(data.familyName);
		if (givenName && familyName) {
			return `${givenName} ${familyName}`;
		}
		if (givenName || familyName) {
			return givenName ?? familyName ?? type;
		}
	}

	if (type === 'EthereumAccount' || type === 'EthereumSmartContract' || type === 'EthereumERC20') {
		const address = toStringMaybe(data.address);
		if (address) {
			return `${type} ${address}`;
		}
	}

	if (type === 'Book') {
		const isbn = toStringMaybe(data.isbn);
		if (isbn) {
			return `Book (ISBN ${isbn})`;
		}
	}

	return (
		canonicalId ??
		sameAs[0] ??
		toStringMaybe(data.identifier) ??
		toStringMaybe(data.termCode) ??
		type
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

function resolveCanonicalIdFromClassification(
	classification: ClassificationCanonicalEnvelope,
	sameAs: string[]
): string | undefined {
	const data = toRecordMaybe(classification.data) ?? {};
	const identifier = toStringMaybe(data.identifier);
	if (identifier) {
		return identifier;
	}

	const isbn = toStringMaybe(data.isbn);
	if (isbn) {
		return `isbn:${isbn}`;
	}

	const termCode = toStringMaybe(data.termCode);
	if (termCode) {
		return `term:${termCode}`;
	}

	if (
		classification.type === 'EthereumAccount' ||
		classification.type === 'EthereumSmartContract' ||
		classification.type === 'EthereumERC20'
	) {
		const address = toStringMaybe(data.address);
		if (address) {
			const normalizedAddress = address.toLowerCase();
			const chainId = toStringMaybe(data.chainId) ?? '1';
			return `eip155:${chainId}:${normalizedAddress}`;
		}
	}

	const url = toStringMaybe(data.url) ?? toStringMaybe(classification.meta.sourceUrl);
	if (url) {
		return url;
	}

	return sameAs[0];
}

function extractSourceUrlFromCanonicalData(data: Record<string, unknown>): string | undefined {
	const urlCandidates = [
		toStringMaybe(data.url),
		toStringMaybe(data.contentUrl),
		toStringMaybe(data.canonicalUrl),
		...extractStringArray(data.sameAs),
	].filter((value): value is string => !!value);

	return urlCandidates.find((value) => isHttpUrl(value));
}

function dedupeCanonicalClassifications(
	classifications: ClassificationCanonicalEnvelope[]
): ClassificationCanonicalEnvelope[] {
	const seen = new Set<string>();
	const deduped: ClassificationCanonicalEnvelope[] = [];

	for (const classification of classifications) {
		const signature = canonicalClassificationSignature(classification);
		if (seen.has(signature)) {
			continue;
		}

		seen.add(signature);
		deduped.push(classification);
	}

	return deduped;
}

function canonicalClassificationSignature(classification: ClassificationCanonicalEnvelope): string {
	const data = toRecordMaybe(classification.data) ?? {};
	return stableStringify({
		type: classification.type.toLowerCase(),
		data,
	});
}

function atomCompatibilitySignature(atom: ClassificationResolvedAtom): string {
	return canonicalClassificationSignature(
		toCanonicalClassification({
			atom,
			fetchedAt: '1970-01-01T00:00:00.000Z',
			defaultPluginId: atom.pluginId ?? 'resolver',
			defaultProvider: atom.source,
		})
	);
}

function createFallbackAtom(
	classification: ClassificationClientClassificationHint,
	input: string,
	source: string
): ClassificationResolvedAtom {
	const mapping = mapClassificationToEntity(classification, input);
	const description = toStringMaybe(mapping.description);
	const canonicalId = toStringMaybe(mapping.canonicalId);
	const sameAs = normalizeStringArray(mapping.sameAs);

	return classificationResolvedAtomSchema.parse({
		schemaType: mapping.schemaType,
		category: mapping.category,
		title: mapping.title,
		description,
		canonicalId,
		sameAs,
		source,
		confidence: clampConfidence(classification.confidence),
		pluginId: 'engine',
		resolverId: 'deterministic-fallback',
		hints: {},
		metadata: {
			fallback: true,
			classification,
		},
		data: buildAtomDataShape({
			schemaType: mapping.schemaType,
			title: mapping.title,
			description,
			canonicalId,
			sameAs,
		}),
	});
}

function mapClassificationToEntity(
	classification: ClassificationClientClassificationHint,
	input: string
): {
	schemaType: string;
	category: ClassificationResolvedAtom['category'];
	title: string;
	description?: string;
	canonicalId?: string;
	sameAs: string[];
} {
	const text = input.trim();
	const canonicalUrl = toStringMaybe(classification.meta.canonicalUrl);
	return {
		schemaType: 'Thing',
		category: 'thing' as const,
		title: text,
		description: `Deterministic fallback for ${classification.domain}/${classification.subtype}`,
		canonicalId: undefined,
		sameAs: canonicalUrl ? [canonicalUrl] : [],
	};
}

function buildResolvedPayload(input: {
	classification: ClassificationClientClassificationHint;
	resolverId: string;
	resolverChain: string[];
	atoms: ClassificationResolvedAtom[];
	classifications?: ClassificationCanonicalEnvelope[];
	fetchedAt: string;
	fallbackUsed: boolean;
}): ClassificationResolvedPayload {
	const atoms = dedupeAtoms(input.atoms);
	const classifications = dedupeCanonicalClassifications(
		(input.classifications && input.classifications.length > 0
			? input.classifications
			: atoms.map((atom) =>
					toCanonicalClassification({
						atom,
						fetchedAt: input.fetchedAt,
						defaultPluginId: atom.pluginId ?? input.resolverId,
						defaultProvider: input.resolverId,
					})
				)) as ClassificationCanonicalEnvelope[]
	);
	const dedupeKey = createResolvedDedupeKey(input.classification, atoms);
	return classificationResolvedPayloadSchema.parse({
		resolverId: input.resolverId,
		resolverChain: input.resolverChain,
		dedupeKey,
		fallbackUsed: input.fallbackUsed,
		classifications,
		atoms,
	});
}

function shouldRunResolverForPolicy(
	policy: ClassificationResult['policy'],
	resolver: RegisteredResolver
): boolean {
	if (policy.runServerEnrichment) {
		return true;
	}

	return resolver.executionMode === 'deterministic';
}

function rankResolverCandidates(
	candidates: ResolverAtomCandidate[]
): Array<{ atom: ClassificationResolvedAtom; resolverId: string; fallbackUsed: boolean }> {
	return candidates.flatMap((candidate) => {
		const sortedAtoms = [...candidate.atoms].sort((left, right) => {
			if (left.confidence !== right.confidence) {
				return right.confidence - left.confidence;
			}
			const leftCanonical = left.canonicalId?.toLowerCase() ?? '';
			const rightCanonical = right.canonicalId?.toLowerCase() ?? '';
			return leftCanonical.localeCompare(rightCanonical);
		});

		return sortedAtoms.map((atom) => ({
			atom,
			resolverId: candidate.resolverId,
			fallbackUsed: candidate.fallbackUsed,
		}));
	});
}

function mergeResolverCandidateMetadata(
	candidates: ResolverAtomCandidate[]
): Record<string, unknown> {
	const metadata: Record<string, unknown> = {};

	for (const candidate of candidates) {
		if (!candidate.metadata) {
			continue;
		}
		Object.assign(metadata, candidate.metadata);
	}

	return metadata;
}

function createResolvedDedupeKey(
	classification: ClassificationClientClassificationHint,
	atoms: ClassificationResolvedAtom[]
): string {
	const canonicalId = atoms
		.map((atom) => atom.canonicalId?.trim().toLowerCase())
		.filter((value): value is string => !!value)
		.sort((left, right) => left.localeCompare(right))[0];

	if (canonicalId) {
		return `canonical:${canonicalId}`;
	}

	const normalizedAtomPayload = stableStringify({
		atoms: atoms.map((atom) => ({
			schemaType: atom.schemaType.toLowerCase(),
			category: atom.category,
			title: atom.title.trim().toLowerCase(),
			description: atom.description?.trim().toLowerCase(),
			canonicalId: atom.canonicalId?.trim().toLowerCase(),
			sameAs: normalizeStringArray(atom.sameAs ?? []),
			confidence: atom.confidence,
			data: atom.data ?? {},
		})),
	});

	if (normalizedAtomPayload.length > 2) {
		return `content-hash:${fnv1aHash(normalizedAtomPayload)}`;
	}

	return createFallbackDedupeKey(classification, atoms);
}

function createFallbackDedupeKey(
	classification: ClassificationClientClassificationHint,
	atoms: ClassificationResolvedAtom[]
): string {
	const resourceCandidate =
		toStringMaybe(classification.meta.resourceId) ??
		toStringMaybe(classification.meta.normalizedIsbn) ??
		toStringMaybe(classification.meta.address) ??
		toStringMaybe(classification.meta.canonicalUrl) ??
		toStringMaybe(atoms[0]?.title) ??
		'unknown';

	const normalizedResource = normalizeDedupeToken(resourceCandidate);
	return `fallback:${classification.domain}:${classification.subtype}:${normalizedResource}`;
}

function deriveProvenance(
	result: ClassificationResult,
	runtime: ClassificationRuntime,
	timestamp: string
): ClassificationResult['provenance'] {
	if (!result.classification) {
		return {};
	}

	const provenance: NonNullable<ClassificationResult['provenance']> = {
		'/classification': {
			source: RUNTIME_TO_PROVENANCE_SOURCE[runtime],
			confidence: result.classification.confidence,
			updatedAt: timestamp,
			tier: 0,
		},
	};

	if (result.resolved) {
		provenance['/resolved'] = {
			source: RUNTIME_TO_PROVENANCE_SOURCE[runtime],
			confidence: 0.9,
			updatedAt: timestamp,
			tier: 2,
			resolverId: result.resolved.resolverId,
		};
	}

	return provenance;
}

function inferGenericClassification(
	input: string
): ClassificationClientClassificationHint | undefined {
	const match = matchPlainTextInput(input);
	if (!match) {
		return undefined;
	}

	return {
		type: 'text',
		domain: 'plain-text',
		subtype: match.tokenCount <= 1 ? 'word' : 'phrase',
		confidence: match.tokenCount <= 1 ? 0.65 : 0.62,
		meta: {
			tokenCount: match.tokenCount,
		},
	};
}

function dedupeAtoms(atoms: ClassificationResolvedAtom[]): ClassificationResolvedAtom[] {
	const seen = new Set<string>();
	const deduped: ClassificationResolvedAtom[] = [];

	for (const atom of atoms) {
		const signature = [
			atom.canonicalId?.toLowerCase() ?? '',
			atom.sameAs
				.map((value) => value.toLowerCase())
				.sort((a, b) => a.localeCompare(b))
				.join('|'),
			atom.schemaType.toLowerCase(),
			atom.title.toLowerCase(),
		].join('::');

		if (seen.has(signature)) {
			continue;
		}

		seen.add(signature);
		deduped.push(atom);
	}

	return deduped;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toNumberMaybe(value: unknown): number | undefined {
	if (typeof value !== 'number' || Number.isNaN(value)) {
		return undefined;
	}

	return value;
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
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

function extractStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function normalizeStringArray(values: string[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed) {
			continue;
		}

		const signature = trimmed.toLowerCase();
		if (seen.has(signature)) {
			continue;
		}

		seen.add(signature);
		normalized.push(trimmed);
	}

	return normalized;
}

function mergeUniqueArrays(left: string[], right: string[]): string[] {
	const merged: string[] = [];
	const seen = new Set<string>();

	for (const value of [...left, ...right]) {
		if (seen.has(value)) {
			continue;
		}
		seen.add(value);
		merged.push(value);
	}

	return merged;
}

function buildAtomDataShape(input: {
	schemaType: string;
	title: string;
	description?: string;
	canonicalId?: string;
	sameAs: string[];
	explicitData?: Record<string, unknown>;
}): Record<string, unknown> {
	const explicitData = input.explicitData ?? {};
	const sameAs = normalizeStringArray([
		...input.sameAs,
		...extractStringArray(explicitData.sameAs),
	]);
	const shape: Record<string, unknown> = {
		'@context': 'https://schema.org',
		'@type': input.schemaType,
		name: input.title,
	};

	if (input.description) {
		shape.description = input.description;
	}

	return {
		...shape,
		...explicitData,
		...(sameAs.length > 0 ? { sameAs } : {}),
	};
}

function mergeDataSameAs(data: Record<string, unknown>, sameAs: string[]): Record<string, unknown> {
	const mergedSameAs = normalizeStringArray([...sameAs, ...extractStringArray(data.sameAs)]);
	if (mergedSameAs.length === 0) {
		return data;
	}

	return {
		...data,
		sameAs: mergedSameAs,
	};
}

function shouldPreserveExplicitResolverData(schemaType: string): boolean {
	return schemaType.trim().toLowerCase().startsWith('ethereum');
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === undefined || value === null) {
		return false;
	}

	if (typeof value === 'string') {
		return value.trim().length > 0;
	}

	if (Array.isArray(value)) {
		return value.length > 0;
	}

	return true;
}

function valuesEqual(left: unknown, right: unknown): boolean {
	return stableStringify(left) === stableStringify(right);
}

function escapeJsonPointer(segment: string): string {
	return segment.replaceAll('~', '~0').replaceAll('/', '~1');
}

function clampConfidence(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}

	if (value < 0) {
		return 0;
	}

	if (value > 1) {
		return 1;
	}

	return value;
}

function normalizeResolverCacheTtlMs(value: number | undefined): number | undefined {
	if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
		return undefined;
	}

	const normalized = Math.floor(value);
	if (normalized <= 0) {
		return undefined;
	}

	return normalized;
}

function normalizeDedupeToken(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
		left.localeCompare(right)
	);
	return `{${entries
		.map(([key, innerValue]) => `${JSON.stringify(key)}:${stableStringify(innerValue)}`)
		.join(',')}}`;
}

function fnv1aHash(input: string): string {
	let hash = 0x811c9dc5;

	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, '0');
}

function cloneRequest(request: ClassificationRequest): ClassificationRequest {
	return structuredCloneSafe(request);
}

function cloneResult(result: ClassificationResult): ClassificationResult {
	return structuredCloneSafe(result);
}

function cloneClassification(
	classification: ClassificationClientClassificationHint
): ClassificationClientClassificationHint {
	return structuredCloneSafe(classification);
}

function cloneRecord(record: Record<string, unknown>): Record<string, unknown> {
	return structuredCloneSafe(record);
}

function structuredCloneSafe<T>(value: T): T {
	if (typeof structuredClone === 'function') {
		return structuredClone(value);
	}

	return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
	if (!isFreezable(value)) {
		return value;
	}

	for (const key of Object.getOwnPropertyNames(value)) {
		const maybeChild = (value as Record<string, unknown>)[key];
		if (isFreezable(maybeChild)) {
			deepFreeze(maybeChild);
		}
	}

	return Object.freeze(value);
}

function isFreezable(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object';
}
