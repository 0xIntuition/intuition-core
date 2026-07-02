import type { ResolverAtom } from '../../plugins';
import type {
	ClassificationCanonicalFieldPolicyMap,
	ClassificationSourceFamily,
} from '../../types';
import type { PlatformDomain, PlatformStageAdapter, PlatformStageInput } from './platform';

export type PublicMetadataSourceResult = {
	atom: ResolverAtom;
	fieldPolicies?: ClassificationCanonicalFieldPolicyMap;
};

export type PublicMetadataSource = {
	id: string;
	family: ClassificationSourceFamily;
	resolve:
		| ((input: PlatformStageInput) => PublicMetadataSourceResult | null | undefined)
		| ((input: PlatformStageInput) => Promise<PublicMetadataSourceResult | null | undefined>);
};

export type PublicMetadataPlatformAdapterOptions = {
	domains?: PlatformDomain[];
	sources: PublicMetadataSource[];
};

export type PublicMetadataPlatformAdapter = PlatformStageAdapter;

export function createPublicMetadataPlatformAdapter(
	options: PublicMetadataPlatformAdapterOptions
): PublicMetadataPlatformAdapter {
	return async (input) => {
		if (input.runtime !== 'server') {
			return null;
		}

		if (options.domains && !options.domains.includes(input.domain)) {
			return null;
		}

		for (const source of options.sources) {
			const result = await Promise.resolve(source.resolve(input));
			if (!result?.atom) {
				continue;
			}

			return {
				...result.atom,
				metadata: {
					...(result.atom.metadata ?? {}),
					sourceFamily: source.family,
					fieldPolicies: result.fieldPolicies,
					publicSourceId: source.id,
				},
			};
		}

		return null;
	};
}
