import { accounts, nodes } from '../schema';
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
			searchText: input.searchText ?? input.data ?? input.id,
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

function createNodeId(input: EnsureNodeInput): string {
	const atomData = input.dataHex ?? input.data;
	if (!atomData) {
		throw new Error('Node id or atom data is required to create a protocol atom id.');
	}

	return kgAtomId(atomData);
}
