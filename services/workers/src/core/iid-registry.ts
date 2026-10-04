import { WorkerConfigurationError } from '../shared/errors';
import type {
	IdentityClassificationDecision,
	IdentityProviderHint,
	IdentityProviderPlan,
	NormalizedAtomIdentity,
	SemanticContractProvenance,
} from './identity-contract';

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
