import { triples } from '../schemas/kg';
import { kgTripleId, normalizeProtocolTermId } from './ids';
import { ensureAccount } from './nodes';
import type { KgActionDb, KgActionRef, TripleInput } from './types';

export type EnsureTripleInput = TripleInput & {
	createdBy?: string | null;
	edgeKind?: string;
	source?: string;
	sourceUri?: string;
	metadata?: Record<string, unknown>;
	provenance?: Record<string, unknown>;
};

export type EnsureTripleResult = {
	tripleId: string;
	created: boolean;
};

function normalizeRef(ref: KgActionRef, label: string): KgActionRef {
	return { type: ref.type, id: normalizeProtocolTermId(ref.id, `${label}.id`) };
}

/**
 * Idempotently create a triple. The ID is a pure function of the
 * (subject, predicate, object) term ids — the same triple ID the protocol
 * would register onchain — so repeated calls with the same refs return the
 * same triple.
 */
export async function ensureTripleWithCreation(
	db: KgActionDb,
	input: EnsureTripleInput
): Promise<EnsureTripleResult> {
	const subject = normalizeRef(input.subject, 'subject');
	const predicate = normalizeRef(input.predicate, 'predicate');
	const object = normalizeRef(input.object, 'object');
	const tripleId = kgTripleId({ subject, predicate, object });
	const source = input.source ?? 'api';

	if (input.createdBy) {
		await ensureAccount(db, input.createdBy);
	}

	const inserted = await db
		.insert(triples)
		.values({
			id: tripleId,
			subjectId: subject.id,
			subjectType: subject.type,
			predicateId: predicate.id,
			predicateType: predicate.type,
			objectId: object.id,
			objectType: object.type,
			edgeKind: input.edgeKind ?? 'claim',
			source,
			sourceUri: input.sourceUri,
			createdBy: input.createdBy,
			metadata: input.metadata ?? {},
			provenance: input.provenance ?? { source },
		})
		.onConflictDoNothing({ target: triples.id })
		.returning({ id: triples.id });

	return { tripleId, created: inserted.length > 0 };
}
