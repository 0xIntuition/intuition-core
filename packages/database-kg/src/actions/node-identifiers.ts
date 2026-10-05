import { and, asc, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';

import { nodeIdentifiers, nodes } from '../schema';
import { invalidInput } from './errors';
import type { KgActionDb } from './types';

export const IDENTIFIER_RUNG_MAX_ITEMS = 32;
const ROWS_PER_INSERT = 13_107; // 65,535 PostgreSQL binds / five supplied columns.
const PRIMARY_LOOKUP_MAX_ITEMS = 32_000; // One query for a maximum 1,000-node backfill page.

type IdentifierRow = Pick<
	typeof nodeIdentifiers.$inferInsert,
	'nodeId' | 'iid' | 'scheme' | 'rung' | 'source'
>;

/** Store only supplied IID strings; semantic admission belongs to the producer. */
export function projectNodeIdentifiers(
	nodeId: string,
	identityRungs: unknown,
	primaryIid?: string | null
): IdentifierRow[] {
	if (!isStoredIdentityRungProjection(identityRungs)) return [];
	const rows: IdentifierRow[] = [];
	const seen = new Set<string>();
	const primaryScheme = primaryIid?.split(':')[1];
	for (const entry of identityRungs.rungs) {
		if (
			!isRecord(entry) ||
			typeof entry.iid !== 'string' ||
			!entry.iid ||
			typeof entry.rung !== 'string'
		)
			continue;
		const iid = entry.iid;
		const scheme = iid.split(':')[1];
		if (
			!scheme ||
			iid === primaryIid ||
			(primaryScheme && scheme === primaryScheme) ||
			seen.has(iid)
		)
			continue;
		seen.add(iid);
		rows.push({ nodeId, iid, scheme, rung: entry.rung, source: 'rung' });
		if (rows.length === IDENTIFIER_RUNG_MAX_ITEMS) break;
	}
	return rows;
}

/** Check all primary owners, including draft/private nodes, inside the caller's transaction. */
export async function excludeNodeIdentifierPrimaryClaims(
	tx: KgActionDb,
	rows: readonly IdentifierRow[]
): Promise<IdentifierRow[]> {
	const iids = [...new Set(rows.map((row) => row.iid))];
	const owners = new Map<string, Set<string>>();
	for (let offset = 0; offset < iids.length; offset += PRIMARY_LOOKUP_MAX_ITEMS) {
		const matches = await tx
			.select({ id: nodes.id, iid: nodes.iid })
			.from(nodes)
			.where(inArray(nodes.iid, iids.slice(offset, offset + PRIMARY_LOOKUP_MAX_ITEMS)));
		for (const owner of matches) {
			if (owner.iid === null) continue;
			const ids = owners.get(owner.iid) ?? new Set<string>();
			ids.add(owner.id);
			owners.set(owner.iid, ids);
		}
	}
	// R38 accepts a concurrent primary creation after this read. Core has no
	// create-reservation path like v2, so this transaction cannot fence that race.
	return rows.filter((row) => ![...(owners.get(row.iid) ?? [])].some((id) => id !== row.nodeId));
}

export async function upsertNodeIdentifierRows(
	db: KgActionDb,
	rows: readonly IdentifierRow[]
): Promise<void> {
	for (let offset = 0; offset < rows.length; offset += ROWS_PER_INSERT) {
		await db
			.insert(nodeIdentifiers)
			.values(
				rows
					.slice(offset, offset + ROWS_PER_INSERT)
					.map(({ nodeId, iid, scheme, rung, source }) => ({
						nodeId,
						iid,
						scheme,
						rung,
						source,
					}))
			)
			.onConflictDoNothing({ target: [nodeIdentifiers.nodeId, nodeIdentifiers.iid] });
	}
}

/** The caller supplies the transaction that also owns the node write. */
export async function reconcileNodeIdentifiers(
	tx: KgActionDb,
	nodeId: string,
	identityRungs: unknown,
	primaryIid?: string | null
): Promise<void> {
	if (!isStoredIdentityRungProjection(identityRungs)) return;
	const rows = await excludeNodeIdentifierPrimaryClaims(
		tx,
		projectNodeIdentifiers(nodeId, identityRungs, primaryIid)
	);
	await tx.delete(nodeIdentifiers).where(
		and(
			eq(nodeIdentifiers.nodeId, nodeId),
			eq(nodeIdentifiers.source, 'rung'),
			...(rows.length
				? [
						notInArray(
							nodeIdentifiers.iid,
							rows.map((row) => row.iid)
						),
					]
				: [])
		)
	);
	await upsertNodeIdentifierRows(tx, rows);
}

export async function listIdentifierBackfillCandidates(
	db: KgActionDb,
	input: { limit: number; after?: string; lock?: boolean }
) {
	if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) {
		throw invalidInput('Identifier backfill limit must be an integer between 1 and 1000.');
	}
	const query = db
		.select({ id: nodes.id, iid: nodes.iid, classificationResult: nodes.classificationResult })
		.from(nodes)
		.where(
			and(
				sql`${nodes.classificationResult}->'identityRungs' IS NOT NULL`,
				...(input.after ? [gt(nodes.id, input.after)] : [])
			)
		)
		.orderBy(asc(nodes.id))
		.limit(input.limit);
	// Applying backfills serializes against classification UPDATE without blocking FK key-share reads.
	return input.lock ? query.for('no key update') : query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Shape-only persistence guard; identity grammar and admission remain producer-owned. */
export function isStoredIdentityRungProjection(value: unknown): value is {
	rungs: Array<{ rung: string; value: string; iid?: string; aliasOnly: boolean }>;
} {
	if (!isRecord(value) || !isOptionalString(value.category)) return false;
	if (
		value.primary !== undefined &&
		(!isRecord(value.primary) || !isString(value.primary.rung) || !isString(value.primary.iid))
	)
		return false;
	if (
		!isRecord(value.provenance) ||
		!isString(value.provenance.producer) ||
		!isString(value.provenance.version) ||
		!isOptionalString(value.provenance.specificationVersion)
	)
		return false;
	return (
		Array.isArray(value.rungs) &&
		value.rungs.every(
			(entry) =>
				isRecord(entry) &&
				isString(entry.rung) &&
				isString(entry.value) &&
				isOptionalString(entry.iid) &&
				typeof entry.aliasOnly === 'boolean'
		)
	);
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || isString(value);
}
