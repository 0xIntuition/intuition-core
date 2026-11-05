import { inspectIntuitionId } from '@0xintuition/iid';
import * as registry from '@0xintuition/iid-registry';
import registryManifest from '@0xintuition/iid-registry/package.json';
import { WorkerConfigurationError } from '../shared/errors';
import type {
	IdentityClassificationDecision,
	IdentityProviderHint,
	IdentityProviderPlan,
	NormalizedAtomIdentity,
	SemanticContractProvenance,
} from './identity-contract';
import type { IidInspectionAdapter } from './iid-inspection';

export type IidSemanticResolution = {
	identityDecision: IdentityClassificationDecision;
	providerPlan: IdentityProviderPlan;
};

export type IidRegistryAdapter = {
	resolve(identity: NormalizedAtomIdentity): IidSemanticResolution;
	/** Present only when canonical public IID inspection was injected. */
	resolveAlias?(iid: string): IdentityProviderPlan | undefined;
};

type RegistryCalls = Pick<
	typeof registry,
	'classificationForIid' | 'providersForIid' | 'identifierHintsForIid'
>;
const classificationProvenance = {
	producer: '@0xintuition/iid-registry/classificationForIid',
	version: registryManifest.version,
};
const providerProvenance = {
	producer: '@0xintuition/iid-registry/providersForIid+identifierHintsForIid',
	version: registryManifest.version,
};

export function resolveIidAlias(
	iid: string,
	calls: RegistryCalls = registry,
	inspect: IidInspectionAdapter['inspect'] = inspectIntuitionId,
	provenance: SemanticContractProvenance = providerProvenance
): IdentityProviderPlan | undefined {
	const inspected = inspect(iid);
	if (!inspected.valid || inspected.iid !== iid) return undefined;
	const providers = calls.providersForIid(iid);
	const identifierHints = toIdentifierHints(calls.identifierHintsForIid(iid));
	if (!providers.length || !identifierHints.length) return undefined;
	return {
		status: 'planned',
		targets: providers.map((provider) => ({ provider, capabilities: [provider], identifierHints })),
		provenance,
	};
}

export function resolveIidIdentity(
	identity: NormalizedAtomIdentity,
	calls: RegistryCalls = registry,
	version: string = registryManifest.version
): IidSemanticResolution {
	const classification = calls.classificationForIid(identity.canonical);
	const providers = calls.providersForIid(identity.canonical);
	const identifierHints = toIdentifierHints(calls.identifierHintsForIid(identity.canonical));
	return {
		identityDecision: classification
			? {
					status: 'classified',
					classificationSlug: classification.slug,
					schemaType: classification.schemaType,
					category: classification.category,
					provenance: { ...classificationProvenance, version },
				}
			: {
					status: identity.typing === 'polymorphic' ? 'ambiguous' : 'unmapped',
					provenance: { ...classificationProvenance, version },
				},
		providerPlan: {
			status: providers.length ? 'planned' : 'unsupported',
			targets: providers.map((provider) => ({
				provider,
				capabilities: [provider],
				identifierHints,
			})),
			provenance: { ...providerProvenance, version },
		},
	};
}

export const iidRegistry: IidRegistryAdapter = {
	resolve: resolveIidIdentity,
	resolveAlias: resolveIidAlias,
};

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
