import { and, asc, gt, ilike, isNotNull, or } from 'drizzle-orm';

import { nodes } from '../schema';
import { invalidInput } from './errors';
import type { KgActionDb } from './types';

export type IidReconciliationCandidate = {
	id: string;
	data: string | null;
	iid: string | null;
	parseStatus: string;
	classificationStatus: string;
	enrichmentStatus: string;
};

/**
 * Lists a deterministic, bounded page of nodes that are either already
 * promoted to an IID cluster or look like historical `int:` input. The public
 * IID adapter remains authoritative; this query never classifies by prefix.
 */
export async function listIidReconciliationCandidates(
	db: KgActionDb,
	input: { limit: number; after?: string }
): Promise<IidReconciliationCandidate[]> {
	if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
		throw invalidInput('IID reconciliation limit must be an integer between 1 and 1000.');
	}

	return db
		.select({
			id: nodes.id,
			data: nodes.data,
			iid: nodes.iid,
			parseStatus: nodes.parseStatus,
			classificationStatus: nodes.classificationStatus,
			enrichmentStatus: nodes.enrichmentStatus,
		})
		.from(nodes)
		.where(
			and(
				or(isNotNull(nodes.iid), ilike(nodes.data, 'int:%')),
				...(input.after ? [gt(nodes.id, input.after)] : [])
			)
		)
		.orderBy(asc(nodes.id))
		.limit(input.limit);
}
