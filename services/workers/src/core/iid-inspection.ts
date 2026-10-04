import type { ParseResult } from '@0xintuition/atom-parser/types';
import { WorkerConfigurationError } from '../shared/errors';
import type { SemanticContractProvenance } from './identity-contract';
import { type CompactParseResult, toCompactParseResult } from './parse';

export type PublicIidInspection =
	| {
			readonly valid: true;
			readonly iid: string;
			readonly scheme: string;
			readonly value: string;
			readonly class: 'A' | 'B' | 'C';
			readonly typing: 'unambiguous' | 'polymorphic';
			readonly anchorEligible: boolean;
			readonly anchorIneligibilityReason?: 'class-c' | 'polymorphic-scheme';
	  }
	| {
			readonly valid: false;
			readonly reason: 'malformed' | 'unknown-scheme' | 'noncanonical';
			readonly scheme?: string;
			readonly value?: string;
			readonly canonical?: string;
	  };

export type IidFallbackReason = Extract<PublicIidInspection, { valid: false }>['reason'];

export type IidInspectionAdapter = {
	inspect(rawInput: string): PublicIidInspection;
	provenance: SemanticContractProvenance;
};

export type IidParseOutcome = {
	result: CompactParseResult;
	fallbackReason?: IidFallbackReason;
};

/**
 * Binds Core to the public inspection function without copying IID grammar or
 * committing an unpublished package dependency. The composition root must pass
 * the exact consumed package/corpus versions when the packages become eligible.
 */
export function createIidInspectionAdapter(input: {
	inspectIntuitionId: (rawInput: string) => PublicIidInspection;
	packageVersion: string;
	specificationVersion?: string;
}): IidInspectionAdapter {
	return {
		inspect: input.inspectIntuitionId,
		provenance: {
			producer: '@0xintuition/iid/inspectIntuitionId',
			version: requireVersion(input.packageVersion, '@0xintuition/iid'),
			...(input.specificationVersion
				? {
						specificationVersion: requireVersion(
							input.specificationVersion,
							'@0xintuition/iid-spec'
						),
					}
				: {}),
		},
	};
}

/**
 * Runs public IID inspection before generic parsing only when the real read flag
 * is enabled. Invalid historical values take the unchanged legacy parser path;
 * even a supplied canonical repair is deliberately ignored here.
 */
export async function parseAtomWithIidRead(input: {
	rawInput: string;
	iidReadEnabled: boolean;
	adapter?: IidInspectionAdapter;
	parseLegacy: () => ParseResult | Promise<ParseResult>;
}): Promise<IidParseOutcome> {
	if (!input.iidReadEnabled) {
		return { result: toCompactParseResult(await input.parseLegacy()) };
	}

	if (!input.adapter) {
		throw new WorkerConfigurationError(
			'WORKERS_IID_READ_ENABLED requires an @0xintuition/iid inspection adapter.'
		);
	}

	const inspection = input.adapter.inspect(input.rawInput);
	if (!inspection.valid) {
		const result = toCompactParseResult(await input.parseLegacy());
		return {
			result: {
				...result,
				iidFallback: {
					reason: inspection.reason,
					provenance: input.adapter.provenance,
				},
			},
			fallbackReason: inspection.reason,
		};
	}

	return {
		result: {
			kind: 'iid',
			normalizedInput: inspection.iid,
			canonicalId: inspection.iid,
			identity: {
				raw: input.rawInput,
				canonical: inspection.iid,
				scheme: inspection.scheme,
				value: inspection.value,
				class: inspection.class,
				typing: inspection.typing,
				anchorEligible: inspection.anchorEligible,
				...(inspection.anchorIneligibilityReason
					? { anchorIneligibilityReason: inspection.anchorIneligibilityReason }
					: {}),
				provenance: input.adapter.provenance,
			},
		},
	};
}

function requireVersion(value: string, packageName: string): string {
	const version = value.trim();
	if (!version) {
		throw new WorkerConfigurationError(`${packageName} adapter requires an exact version.`);
	}
	return version;
}
