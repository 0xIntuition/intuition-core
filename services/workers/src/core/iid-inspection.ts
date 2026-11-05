import type { ParseResult } from '@0xintuition/atom-parser/types';
import { type IidInspection, inspectIntuitionId } from '@0xintuition/iid';
import iidManifest from '@0xintuition/iid/package.json';
import { WorkerConfigurationError } from '../shared/errors';
import type { SemanticContractProvenance } from './identity-contract';
import { type CompactParseResult, toCompactParseResult } from './parse';

export type IidFallbackReason = Extract<IidInspection, { valid: false }>['reason'];

export type IidInspectionAdapter = {
	inspect(rawInput: string): IidInspection;
	provenance: SemanticContractProvenance;
};

export type IidParseOutcome = {
	result: CompactParseResult;
	fallbackReason?: IidFallbackReason;
};

export const iidInspection: IidInspectionAdapter = {
	inspect: inspectIntuitionId,
	provenance: { producer: '@0xintuition/iid/inspectIntuitionId', version: iidManifest.version },
};

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
