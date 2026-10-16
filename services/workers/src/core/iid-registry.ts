import { WorkerConfigurationError } from '../shared/errors';
import type {
	IdentityClassificationDecision,
	IdentityProviderHint,
	IdentityProviderPlan,
	NormalizedAtomIdentity,
	SemanticContractProvenance,
} from './identity-contract';
import type { IidInspectionAdapter } from './iid-inspection';

export type PublicIidClassification = {
	readonly slug: string;
	readonly schemaType: string;
	readonly displayName: string;
	readonly category: string;
};

export type IidSemanticResolution = {
	identityDecision: IdentityClassificationDecision;
	providerPlan: IdentityProviderPlan;
};

export type IidRegistryAdapter = {
	resolve(identity: NormalizedAtomIdentity): IidSemanticResolution;
	/** Present only when canonical public IID inspection was injected. */
	resolveAlias?(iid: string): IdentityProviderPlan | undefined;
};

/**
 * Maps only public iid-registry calls into Core DTOs. Scheme typing comes from
 * the already-inspected identity; every classification, provider order, and
 * identifier hint remains owned by the registry package.
 */
export function createIidRegistryAdapter(input: {
	classificationForIid: (iid: string) => PublicIidClassification | undefined;
	providersForIid: (iid: string) => readonly string[];
	identifierHintsForIid: (iid: string) => Record<string, string>;
	packageVersion: string;
	inspect?: IidInspectionAdapter['inspect'];
}): IidRegistryAdapter {
	const packageVersion = requireVersion(input.packageVersion);
	const classificationProvenance: SemanticContractProvenance = {
		producer: '@0xintuition/iid-registry/classificationForIid',
		version: packageVersion,
	};
	const providerProvenance: SemanticContractProvenance = {
		producer: '@0xintuition/iid-registry/providersForIid+identifierHintsForIid',
		version: packageVersion,
	};

	return {
		...(input.inspect
			? {
					resolveAlias(iid: string): IdentityProviderPlan | undefined {
						const inspected = input.inspect!(iid);
						if (!inspected.valid || inspected.iid !== iid) return undefined;
						const providers = input.providersForIid(iid);
						if (providers.length === 0) return undefined;
						const identifierHints = toIdentifierHints(input.identifierHintsForIid(iid));
						// An alias earns a provider only through an identifier hint; a provider
						// with nothing alias-specific to look up would run on the primary's
						// search text, which the alias does not justify.
						if (identifierHints.length === 0) return undefined;
						return {
							status: 'planned',
							targets: providers.map((provider) => ({
								provider,
								capabilities: [provider],
								identifierHints,
							})),
							provenance: providerProvenance,
						};
					},
				}
			: {}),
		resolve(identity) {
			const classification = input.classificationForIid(identity.canonical);
			const providers = input.providersForIid(identity.canonical);
			const identifierHints = toIdentifierHints(input.identifierHintsForIid(identity.canonical));

			return {
				identityDecision: classification
					? {
							status: 'classified',
							classificationSlug: classification.slug,
							schemaType: classification.schemaType,
							category: classification.category,
							provenance: classificationProvenance,
						}
					: {
							status: identity.typing === 'polymorphic' ? 'ambiguous' : 'unmapped',
							provenance: classificationProvenance,
						},
				providerPlan: {
					status: providers.length > 0 ? 'planned' : 'unsupported',
					targets: providers.map((provider) => ({
						provider,
						// Registry provider slugs are capability identifiers. Keep their
						// ordering and spelling intact for the execution adapter in C10.
						capabilities: [provider],
						identifierHints,
					})),
					provenance: providerProvenance,
				},
			};
		},
	};
}

export type DroppedAliasHint = IdentityProviderHint & { iid: string; keptValue: string };

/** Merge execution targets without changing primary identity or persisted handoffs. */
export function extendProviderPlanWithAliases(input: {
	primaryPlan?: IdentityProviderPlan;
	primaryIid?: string;
	aliasIids: readonly string[];
	registry: IidRegistryAdapter;
}): {
	providerPlan?: IdentityProviderPlan;
	skippedAliasIids: number;
	droppedAliasHints: DroppedAliasHint[];
} {
	if (!input.registry.resolveAlias) {
		throw new WorkerConfigurationError(
			'Alias enrichment requires injected IID inspection and registry adapters.'
		);
	}
	const targets = new Map<string, IdentityProviderPlan['targets'][number]>();
	const hints = new Map<string, string>();
	for (const target of input.primaryPlan?.targets ?? []) {
		for (const hint of target.identifierHints) {
			if (hints.has(hint.kind) && hints.get(hint.kind) !== hint.value) {
				throw new Error(
					`IID provider plan supplied conflicting values for identifier hint "${hint.kind}".`
				);
			}
			hints.set(hint.kind, hint.value);
		}
		const previous = targets.get(target.provider);
		targets.set(
			target.provider,
			previous
				? {
						...previous,
						identifierHints: [...previous.identifierHints, ...target.identifierHints],
					}
				: target
		);
	}
	let provenance = input.primaryPlan?.provenance;
	let skippedAliasIids = 0;
	const droppedAliasHints: DroppedAliasHint[] = [];
	for (const iid of new Set(input.aliasIids)) {
		if (iid === input.primaryIid) continue;
		const alias = input.registry.resolveAlias(iid);
		if (!alias) {
			skippedAliasIids++;
			continue;
		}
		provenance ??= alias.provenance;
		const dropped = new Set<string>();
		for (const target of alias.targets) {
			const accepted = target.identifierHints.filter((hint) => {
				const keptValue = hints.get(hint.kind);
				if (keptValue !== undefined && keptValue !== hint.value) {
					const key = JSON.stringify(hint);
					if (!dropped.has(key)) droppedAliasHints.push({ iid, ...hint, keptValue });
					dropped.add(key);
					return false;
				}
				hints.set(hint.kind, hint.value);
				return true;
			});
			const previous = targets.get(target.provider);
			const merged = new Map((previous?.identifierHints ?? []).map((hint) => [hint.kind, hint]));
			for (const hint of accepted) merged.set(hint.kind, hint);
			targets.set(target.provider, {
				...(previous ?? target),
				identifierHints: [...merged.values()],
			});
		}
	}
	return {
		providerPlan: provenance
			? {
					status: targets.size ? 'planned' : 'unsupported',
					targets: [...targets.values()],
					provenance,
				}
			: input.primaryPlan,
		skippedAliasIids,
		droppedAliasHints,
	};
}

function toIdentifierHints(hints: Record<string, string>): readonly IdentityProviderHint[] {
	return Object.entries(hints)
		.filter(([kind, value]) => kind.trim().length > 0 && value.trim().length > 0)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([kind, value]) => ({ kind, value }));
}

function requireVersion(value: string): string {
	const version = value.trim();
	if (!version) {
		throw new WorkerConfigurationError(
			'@0xintuition/iid-registry adapter requires an exact version.'
		);
	}
	return version;
}
