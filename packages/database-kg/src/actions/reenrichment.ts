import { sql } from 'drizzle-orm';
import { invalidInput } from './errors';
import type { KgActionDb } from './types';

/** Operator batch selection; any active artifact from the plugin counts as served. */
export async function listReenrichmentCandidates(
	db: KgActionDb,
	input: {
		missingPlugin: string;
		missingArtifactKind?: string;
		rungs: readonly string[];
		createdSince?: Date;
		limit?: number;
		cursor?: string;
	}
): Promise<{ ids: string[]; nextCursor?: string }> {
	const limit = input.limit ?? 1000;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
		throw invalidInput('limit must be an integer between 1 and 5000.');
	}
	if (input.createdSince !== undefined && !Number.isFinite(input.createdSince.getTime())) {
		throw invalidInput('createdSince must be a valid date.');
	}
	if (input.rungs.length === 0) return { ids: [] };
	const rows = await db.execute<{ id: string }>(sql`
		SELECT n.id FROM kg.nodes n
		WHERE n.raw_type = ${'iid'} AND n.enrichment_status = ${'completed'}
		AND EXISTS (
			SELECT 1 FROM kg.node_identifiers i
			WHERE i.node_id = n.id AND i.rung = ANY(${sql.param([...input.rungs])}::text[])
		)
		AND NOT EXISTS (
			SELECT 1 FROM kg.artifacts a
			WHERE a.node_id = n.id AND a.status = 'active'
			AND a.data->'meta'->>'pluginId' = ${input.missingPlugin}
			${input.missingArtifactKind !== undefined ? sql`AND a.artifact_kind = ${input.missingArtifactKind}` : sql``}
		)
		${input.createdSince !== undefined ? sql`AND n.created_at >= ${input.createdSince.toISOString()}::timestamptz` : sql``}
		${input.cursor !== undefined ? sql`AND n.id > ${input.cursor}` : sql``}
		ORDER BY n.id LIMIT ${limit + 1}
	`);
	const ids = rows.slice(0, limit).map((row) => row.id);
	return { ids, ...(rows.length > limit ? { nextCursor: ids.at(-1) } : {}) };
}
