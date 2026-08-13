import { and, asc, desc, eq } from 'drizzle-orm';

import { accounts, nodeContexts, nodes } from '../schema';
import { invalidInput } from './errors';
import { kgAtomId, normalizeProtocolTermId } from './ids';
import type { EnsureNodeInput, KgActionDb } from './types';

export async function ensureAccount(db: KgActionDb, accountId: string): Promise<string> {
	assertAccountIdIsNotAuthScoped(accountId);
	await db.insert(accounts).values({ id: accountId }).onConflictDoNothing();

	return accountId;
}

function assertAccountIdIsNotAuthScoped(accountId: string): void {
	if (accountId.startsWith('auth:')) {
		throw invalidInput('Auth-scoped account IDs are not valid KG accounts.');
	}
}

export type EnsureNodeResult = {
	nodeId: string;
	/**
	 * `true` only when this call actually inserted the node. Nodes are
	 * content-addressed, so re-submitting an existing atom is a no-op upsert
	 * (`onConflictDoNothing`) and reports `created: false`. Activity-feed
	 * producers rely on this to avoid emitting `item_created` on re-submission.
	 */
	created: boolean;
};

/**
 * Idempotently upsert a node and report whether it was newly created.
 *
 * `ON CONFLICT DO NOTHING ... RETURNING` returns the inserted row only when an
 * insert actually happened; a conflict skips the write and returns no rows.
 */
export async function ensureNodeWithCreation(
	db: KgActionDb,
	input: EnsureNodeInput
): Promise<EnsureNodeResult> {
	const nodeId = input.id ? normalizeProtocolTermId(input.id, 'node.id') : createNodeId(input);

	if (input.createdBy) {
		await ensureAccount(db, input.createdBy);
	}

	const inserted = await db
		.insert(nodes)
		.values({
			id: nodeId,
			rawType: input.rawType,
			classificationType: input.classificationType,
			data: input.data,
			dataHex: input.dataHex,
			dataResolved: input.dataResolved ?? {},
			// Search text is a presentation projection, not a fallback copy of the
			// atom's opaque/content-addressed input. Callers that understand the
			// value must opt in; parse/enrichment workers promote it later.
			searchText: input.searchText ?? '',
			createdBy: input.createdBy,
		})
		.onConflictDoNothing()
		.returning({ id: nodes.id });

	return { nodeId, created: inserted.length > 0 };
}

export async function ensureNode(db: KgActionDb, input: EnsureNodeInput): Promise<string> {
	const { nodeId } = await ensureNodeWithCreation(db, input);
	return nodeId;
}

/** Read immutable on-chain context in contract event/array order. */
export async function listNodeContexts(db: KgActionDb, nodeId: string) {
	return db
		.select({
			nodeId: nodeContexts.nodeId,
			eventSequence: nodeContexts.eventSequence,
			blockNumber: nodeContexts.blockNumber,
			blockTimestamp: nodeContexts.blockTimestamp,
			blockHash: nodeContexts.blockHash,
			transactionHash: nodeContexts.transactionHash,
			logIndex: nodeContexts.logIndex,
			ordinal: nodeContexts.ordinal,
			registrant: nodeContexts.registrant,
			uriHex: nodeContexts.uriHex,
			uriText: nodeContexts.uriText,
		})
		.from(nodeContexts)
		.where(eq(nodeContexts.nodeId, nodeId))
		.orderBy(asc(nodeContexts.eventSequence), asc(nodeContexts.ordinal))
		.execute();
}

/**
 * Exact same-identity cluster read. The equality predicate is backed by
 * `idx_nodes_iid`; no prefix parsing, normalization, or fuzzy search occurs.
 */
export async function listPublicNodesByIid(
	db: KgActionDb,
	iid: string,
	options: { limit: number; offset: number }
) {
	return db
		.select({
			id: nodes.id,
			createdAt: nodes.createdAt,
			isOnchain: nodes.isOnchain,
			rawType: nodes.rawType,
			data: nodes.data,
			iid: nodes.iid,
			dataResolved: nodes.dataResolved,
			parseResult: nodes.parseResult,
			classificationType: nodes.classificationType,
			parseStatus: nodes.parseStatus,
			classificationStatus: nodes.classificationStatus,
			classificationResult: nodes.classificationResult,
			enrichmentStatus: nodes.enrichmentStatus,
			enrichmentError: nodes.enrichmentError,
			enrichedAt: nodes.enrichedAt,
		})
		.from(nodes)
		.where(and(eq(nodes.iid, iid), eq(nodes.status, 'active'), eq(nodes.visibility, 'public')))
		.orderBy(desc(nodes.createdAt), desc(nodes.id))
		.limit(options.limit)
		.offset(options.offset)
		.execute();
}

function createNodeId(input: EnsureNodeInput): string {
	const atomData = input.dataHex ?? input.data;
	if (!atomData) {
		throw new Error('Node id or atom data is required to create a protocol atom id.');
	}

	return kgAtomId(atomData);
}
