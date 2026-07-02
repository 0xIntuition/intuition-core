import { and, asc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';

import { nodes } from '../schema';
import { createArtifacts, hashArtifactPayload } from './artifacts';
import { invalidInput, notFound } from './errors';
import { normalizeProtocolTermId } from './ids';
import { inKgTransaction, type KgActionDb } from './types';

export type NodeProcessingStage = 'parse' | 'classification' | 'enrichment';

export const NODE_PROCESSING_STAGES: readonly NodeProcessingStage[] = [
	'parse',
	'classification',
	'enrichment',
];

export type NodeProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped';

export type NodeProcessingError = {
	code: string;
	message: string;
	retriable: boolean;
	observedAt?: Date | string;
	details?: unknown;
};

export type NodeProcessingPromotedFields = {
	dataResolved?: unknown;
	searchText?: string;
	classificationType?: string;
};

export type NodeProcessingPrerequisite = {
	stage: NodeProcessingStage;
	status?: NodeProcessingStatus;
};

export type NodeEnrichmentArtifactInput = {
	artifactKind: string;
	artifactVersion?: string;
	status?: string;
	sourceUri?: string | null;
	sourceHash?: string | null;
	data: unknown;
	meta?: unknown;
	extracted?: unknown;
	error?: unknown;
};

export async function getNodeForProcessing(db: KgActionDb, nodeId: string) {
	const [node] = await db
		.select()
		.from(nodes)
		.where(eq(nodes.id, normalizeProtocolTermId(nodeId, 'nodeId')))
		.limit(1);

	return node ?? null;
}

export async function claimNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		workerId: string;
		leaseMs: number;
		maxAttempts?: number;
		prerequisiteStage?: NodeProcessingPrerequisite;
	}
) {
	assertPositiveLease(input.leaseMs);
	if (input.maxAttempts !== undefined) {
		assertPositiveInteger(input.maxAttempts, 'maxAttempts');
	}
	const fields = stageFields(input.stage);
	const startedAt = new Date();
	const runId = crypto.randomUUID();
	const leaseExpiresAt = new Date(startedAt.getTime() + input.leaseMs);
	const processingMeta = JSON.stringify({
		[fields.workerIdMetaKey]: input.workerId,
		[fields.runIdMetaKey]: runId,
	});

	const [node] = await db
		.update(nodes)
		.set({
			[fields.statusKey]: 'processing',
			[fields.attemptsKey]: sql`${fields.attemptsColumn} + 1`,
			[fields.startedAtKey]: startedAt,
			[fields.leaseExpiresAtKey]: leaseExpiresAt,
			[fields.errorKey]: null,
			processingMeta: sql`${nodes.processingMeta} || ${processingMeta}::jsonb`,
			updatedAt: startedAt,
		})
		.where(
			and(
				eq(nodes.id, normalizeProtocolTermId(input.nodeId, 'nodeId')),
				...(input.maxAttempts !== undefined ? [lt(fields.attemptsColumn, input.maxAttempts)] : []),
				...(input.prerequisiteStage
					? [
							eq(
								stageFields(input.prerequisiteStage.stage).statusColumn,
								input.prerequisiteStage.status ?? 'completed'
							),
						]
					: []),
				or(
					eq(fields.statusColumn, 'pending'),
					and(
						eq(fields.statusColumn, 'failed'),
						sql`(${fields.errorColumn}->>'retriable')::boolean IS TRUE`
					),
					and(
						eq(fields.statusColumn, 'processing'),
						or(isNull(fields.leaseExpiresAtColumn), lt(fields.leaseExpiresAtColumn, startedAt))
					)
				)
			)
		)
		.returning();

	return node ?? null;
}

export async function listNodeProcessingCandidates(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		limit: number;
		maxAttempts: number;
		includeFailed?: boolean;
		prerequisiteStage?: NodeProcessingPrerequisite;
	}
) {
	assertPositiveInteger(input.limit, 'limit');
	assertPositiveInteger(input.maxAttempts, 'maxAttempts');
	const fields = stageFields(input.stage);
	const now = new Date();
	const eligibilityFilters = [
		and(eq(fields.statusColumn, 'pending'), lt(fields.attemptsColumn, input.maxAttempts)),
		and(
			eq(fields.statusColumn, 'processing'),
			lt(fields.attemptsColumn, input.maxAttempts),
			or(isNull(fields.leaseExpiresAtColumn), lt(fields.leaseExpiresAtColumn, now))
		),
	];

	if (input.includeFailed) {
		eligibilityFilters.push(
			and(
				eq(fields.statusColumn, 'failed'),
				lt(fields.attemptsColumn, input.maxAttempts),
				sql`(${fields.errorColumn}->>'retriable')::boolean IS TRUE`
			)
		);
	}

	const filters = [or(...eligibilityFilters)];

	if (input.prerequisiteStage) {
		const prerequisite = stageFields(input.prerequisiteStage.stage);
		filters.push(eq(prerequisite.statusColumn, input.prerequisiteStage.status ?? 'completed'));
	}

	return db
		.select()
		.from(nodes)
		.where(and(...filters))
		.orderBy(asc(nodes.createdAt))
		.limit(input.limit);
}

export async function listNodeProcessingDeadLetters(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		limit: number;
	}
): Promise<
	{
		id: string;
		status: NodeProcessingStatus;
		attempts: number;
		error: NodeProcessingError | null;
		updatedAt: Date;
	}[]
> {
	assertPositiveInteger(input.limit, 'limit');
	const fields = stageFields(input.stage);

	// Skipped rows are intentionally excluded: they are terminal-but-expected
	// outcomes, not poison rows that need operator replay.
	const rows = await db
		.select({
			id: nodes.id,
			status: fields.statusColumn,
			attempts: fields.attemptsColumn,
			error: fields.errorColumn,
			updatedAt: nodes.updatedAt,
		})
		.from(nodes)
		.where(
			and(
				eq(fields.statusColumn, 'failed'),
				sql`${fields.errorColumn} IS NOT NULL`,
				or(
					sql`${fields.errorColumn}->>'code' = 'MAX_ATTEMPTS_EXCEEDED'`,
					and(
						sql`${fields.errorColumn}->'details'->>'maxAttempts' ~ '^[0-9]+$'`,
						sql`${fields.attemptsColumn} >= (${fields.errorColumn}->'details'->>'maxAttempts')::integer`
					)
				)
			)
		)
		.orderBy(asc(nodes.updatedAt))
		.limit(input.limit);

	return rows.map((row) => ({
		...row,
		status: row.status as NodeProcessingStatus,
		error: row.error as NodeProcessingError | null,
	}));
}

export async function completeNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
		data?: unknown;
		promotedFields?: NodeProcessingPromotedFields;
	}
) {
	const fields = stageFields(input.stage);
	const completedAt = new Date();
	const patch: Record<string, unknown> = {
		[fields.statusKey]: 'completed',
		[fields.leaseExpiresAtKey]: null,
		[fields.errorKey]: null,
		[fields.completedAtKey]: completedAt,
		updatedAt: completedAt,
	};

	if (fields.resultKey && input.data !== undefined) {
		patch[fields.resultKey] = input.data;
	}
	if (input.promotedFields?.dataResolved !== undefined) {
		patch.dataResolved = input.promotedFields.dataResolved;
	}
	if (input.promotedFields?.searchText !== undefined) {
		patch.searchText = input.promotedFields.searchText;
	}
	if (input.promotedFields?.classificationType !== undefined) {
		patch.classificationType = input.promotedFields.classificationType;
	}

	const [node] = await db
		.update(nodes)
		.set(patch)
		.where(stageRunGuard(input.stage, input.nodeId, input.runId))
		.returning();

	if (!node) {
		throw notFound('Processing stage is not claimed by this run.');
	}

	return node;
}

export async function failNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
		error: NodeProcessingError;
	}
) {
	const fields = stageFields(input.stage);
	const now = new Date();
	const [node] = await db
		.update(nodes)
		.set({
			[fields.statusKey]: 'failed',
			[fields.leaseExpiresAtKey]: null,
			[fields.errorKey]: normalizeProcessingError(input.error, now),
			updatedAt: now,
		})
		.where(stageRunGuard(input.stage, input.nodeId, input.runId))
		.returning();

	if (!node) {
		throw notFound('Processing stage is not claimed by this run.');
	}

	return node;
}

export async function markNodeProcessingStageSkipped(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
		reason: string;
	}
) {
	return failOrSkipNodeProcessingStage(db, {
		...input,
		status: 'skipped',
		error: {
			code: 'SKIPPED',
			message: input.reason,
			retriable: false,
		},
	});
}

export async function markNodeProcessingStagesSkipped(
	db: KgActionDb,
	input: {
		nodeId: string;
		stages: NodeProcessingStage[];
		reason: string;
	}
): Promise<void> {
	if (input.stages.length === 0) {
		return;
	}

	const nodeId = normalizeProtocolTermId(input.nodeId, 'nodeId');
	const now = new Date();
	const error = normalizeProcessingError(
		{
			code: 'SKIPPED',
			message: input.reason,
			retriable: false,
		},
		now
	);

	await inKgTransaction(db, async (tx) => {
		for (const stage of input.stages) {
			const fields = stageFields(stage);
			await tx
				.update(nodes)
				.set({
					[fields.statusKey]: 'skipped',
					[fields.leaseExpiresAtKey]: null,
					[fields.errorKey]: error,
					updatedAt: now,
				})
				.where(and(eq(nodes.id, nodeId), sql`${fields.statusColumn} IN ('pending', 'failed')`));
		}
	});
}

export async function requeueNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		reason: string;
		/**
		 * When true (default) downstream stages are reset to pending so
		 * prerequisite-driven workers re-run against fresh upstream output.
		 * Pass false to requeue only the requested stage.
		 */
		cascadeDownstream?: boolean;
		/**
		 * When false (default) refuse to requeue a stage that is currently in
		 * `processing` with a still-valid lease — clobbering a live worker's row
		 * causes the worker's next `complete()` / `fail()` call to throw and
		 * leaves the operator chasing a phantom failure. Set true to override
		 * for genuine recovery scenarios (e.g. the worker pod is gone but the
		 * lease has not yet expired).
		 */
		force?: boolean;
	}
) {
	const nodeId = normalizeProtocolTermId(input.nodeId, 'nodeId');
	const cascade = input.cascadeDownstream ?? true;
	const force = input.force ?? false;
	const stagesToReset: NodeProcessingStage[] = cascade
		? [input.stage, ...downstreamStages(input.stage)]
		: [input.stage];

	return inKgTransaction(db, async (tx) => {
		const now = new Date();

		if (!force) {
			const stagesToCheck: NodeProcessingStage[] = stagesToReset;
			const checkFilters = stagesToCheck.map((stage) => {
				const fields = stageFields(stage);
				return and(
					eq(fields.statusColumn, 'processing'),
					sql`${fields.leaseExpiresAtColumn} IS NOT NULL`,
					gte(fields.leaseExpiresAtColumn, now)
				);
			});
			const [activeLease] = await tx
				.select({ id: nodes.id })
				.from(nodes)
				.where(and(eq(nodes.id, nodeId), or(...checkFilters)))
				.limit(1);
			if (activeLease) {
				throw invalidInput(
					`Cannot requeue node ${nodeId}: stage ${input.stage} (or a downstream stage) is currently being processed with a valid lease. Pass force: true to override.`
				);
			}
		}

		const patch: Record<string, unknown> = { updatedAt: now };

		for (const stage of stagesToReset) {
			const fields = stageFields(stage);
			patch[fields.statusKey] = 'pending';
			patch[fields.attemptsKey] = 0;
			patch[fields.startedAtKey] = null;
			patch[fields.leaseExpiresAtKey] = null;
			patch[fields.errorKey] = null;
			patch[fields.completedAtKey] = null;
			if (fields.resultKey) {
				patch[fields.resultKey] = null;
			}
		}

		const metaPatch: Record<string, unknown> = {
			[`${input.stage}RequeueReason`]: input.reason,
			[`${input.stage}LastRequeuedAt`]: now.toISOString(),
		};
		if (cascade) {
			metaPatch[`${input.stage}RequeueCascaded`] = downstreamStages(input.stage);
		}
		if (force) {
			metaPatch[`${input.stage}RequeueForced`] = true;
		}
		const processingMeta = JSON.stringify(metaPatch);
		patch.processingMeta = sql`${nodes.processingMeta} || ${processingMeta}::jsonb`;

		const [node] = await tx.update(nodes).set(patch).where(eq(nodes.id, nodeId)).returning();

		if (!node) {
			throw notFound('Node not found.');
		}

		return node;
	});
}

/**
 * Reset an entire stage column back to pending.
 *
 * Intended for operator-driven backfill / replay flows. Caller is responsible
 * for scoping rows with `eligibleStatuses` (the default keeps the recovery
 * intent: only pull `failed` and `skipped` rows back into the queue and never
 * touch `processing` or `completed` work). Attempts are reset to zero so that
 * rows that previously hit `WORKERS_MAX_ATTEMPTS` actually become claimable
 * again.
 */
export async function resetNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		eligibleStatuses?: readonly NodeProcessingStatus[];
		limit?: number;
		nodeIds?: string[];
		reason?: string;
	}
): Promise<{ updated: number; ids: string[] }> {
	const eligibleStatuses = input.eligibleStatuses ?? ['failed', 'skipped'];
	if (eligibleStatuses.length === 0) {
		throw invalidInput('eligibleStatuses must not be empty.');
	}
	if (eligibleStatuses.includes('processing')) {
		throw invalidInput('Refusing to reset rows currently in processing.');
	}
	if (input.limit !== undefined) {
		assertPositiveInteger(input.limit, 'limit');
	}

	const fields = stageFields(input.stage);
	const now = new Date();
	const reason = input.reason ?? `manual_reset_${input.stage}`;
	const metaPatch = JSON.stringify({
		[`${input.stage}ResetReason`]: reason,
		[`${input.stage}LastResetAt`]: now.toISOString(),
	});

	const filters: ReturnType<typeof and>[] = [
		sql`${fields.statusColumn} IN (${sql.join(
			eligibleStatuses.map((status) => sql`${status}`),
			sql`, `
		)})`,
	];
	if (input.nodeIds && input.nodeIds.length > 0) {
		const normalizedIds = input.nodeIds.map((id) => normalizeProtocolTermId(id, 'nodeId'));
		filters.push(
			sql`${nodes.id} IN (${sql.join(
				normalizedIds.map((id) => sql`${id}`),
				sql`, `
			)})`
		);
	}

	const patch: Record<string, unknown> = {
		[fields.statusKey]: 'pending',
		[fields.attemptsKey]: 0,
		[fields.startedAtKey]: null,
		[fields.leaseExpiresAtKey]: null,
		[fields.errorKey]: null,
		[fields.completedAtKey]: null,
		processingMeta: sql`${nodes.processingMeta} || ${metaPatch}::jsonb`,
		updatedAt: now,
	};
	if (fields.resultKey) {
		patch[fields.resultKey] = null;
	}

	if (input.limit === undefined) {
		const rows = await db
			.update(nodes)
			.set(patch)
			.where(and(...filters))
			.returning({ id: nodes.id });
		return { updated: rows.length, ids: rows.map((row) => row.id) };
	}

	return inKgTransaction(db, async (tx) => {
		const candidates = await tx
			.select({ id: nodes.id })
			.from(nodes)
			.where(and(...filters))
			.orderBy(asc(nodes.createdAt))
			.limit(input.limit!);
		if (candidates.length === 0) {
			return { updated: 0, ids: [] };
		}
		const ids = candidates.map((row) => row.id);
		const rows = await tx
			.update(nodes)
			.set(patch)
			.where(
				sql`${nodes.id} IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `
				)})`
			)
			.returning({ id: nodes.id });
		return { updated: rows.length, ids: rows.map((row) => row.id) };
	});
}

/**
 * Expire the lease on any rows still in `processing` for the given stage that
 * are tagged with this `workerId` in `processingMeta`. Intended to be called
 * during graceful shutdown after the in-flight scheduler drains. Without this
 * sweep, on SIGTERM rows that were claimed but did not reach `complete()` /
 * `fail()` in time stay in `processing` until `lease_expires_at` passes (up
 * to `WORKERS_LEASE_MS`, default 60s). For a `replicas: 1` deployment this
 * means a 30-60s blackout on every rolling restart.
 *
 * Returns the rows whose leases were expired. Best-effort — a hard kill
 * (SIGKILL, OOM) cannot run this path.
 */
export async function releaseClaimedProcessingStageLeases(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		workerId: string;
	}
): Promise<{ released: number; ids: string[] }> {
	const fields = stageFields(input.stage);
	const now = new Date();

	const rows = await db
		.update(nodes)
		.set({
			[fields.leaseExpiresAtKey]: now,
			updatedAt: now,
		})
		.where(
			and(
				eq(fields.statusColumn, 'processing'),
				sql`${nodes.processingMeta}->>${fields.workerIdMetaKey} = ${input.workerId}`
			)
		)
		.returning({ id: nodes.id });

	return { released: rows.length, ids: rows.map((row) => row.id) };
}

/**
 * Transition rows that have been stuck in `processing` past `maxAttempts` with
 * an expired lease into a terminal `failed` state. Without this sweep such
 * rows are never re-claimed (claim filter requires `attempts < maxAttempts`)
 * and never appear as failures in operator dashboards.
 */
export async function reapStuckProcessingNodes(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		maxAttempts: number;
		limit?: number;
	}
): Promise<{ reaped: number; ids: string[] }> {
	assertPositiveInteger(input.maxAttempts, 'maxAttempts');
	if (input.limit !== undefined) {
		assertPositiveInteger(input.limit, 'limit');
	}
	const fields = stageFields(input.stage);
	const now = new Date();
	const error = normalizeProcessingError(
		{
			code: 'MAX_ATTEMPTS_EXCEEDED',
			message: `Stage ${input.stage} stuck in processing past maxAttempts; reaped by stuck-row sweep.`,
			retriable: false,
			details: { maxAttempts: input.maxAttempts },
		},
		now
	);

	const filters = [
		eq(fields.statusColumn, 'processing'),
		gte(fields.attemptsColumn, input.maxAttempts),
		and(sql`${fields.leaseExpiresAtColumn} IS NOT NULL`, lt(fields.leaseExpiresAtColumn, now)),
	];

	if (input.limit === undefined) {
		const rows = await db
			.update(nodes)
			.set({
				[fields.statusKey]: 'failed',
				[fields.leaseExpiresAtKey]: null,
				[fields.errorKey]: error,
				updatedAt: now,
			})
			.where(and(...filters))
			.returning({ id: nodes.id });
		return { reaped: rows.length, ids: rows.map((row) => row.id) };
	}

	return inKgTransaction(db, async (tx) => {
		const candidates = await tx
			.select({ id: nodes.id })
			.from(nodes)
			.where(and(...filters))
			.orderBy(asc(nodes.createdAt))
			.limit(input.limit!);
		if (candidates.length === 0) {
			return { reaped: 0, ids: [] };
		}
		const ids = candidates.map((row) => row.id);
		const rows = await tx
			.update(nodes)
			.set({
				[fields.statusKey]: 'failed',
				[fields.leaseExpiresAtKey]: null,
				[fields.errorKey]: error,
				updatedAt: now,
			})
			.where(
				sql`${nodes.id} IN (${sql.join(
					ids.map((id) => sql`${id}`),
					sql`, `
				)})`
			)
			.returning({ id: nodes.id });
		return { reaped: rows.length, ids: rows.map((row) => row.id) };
	});
}

function downstreamStages(stage: NodeProcessingStage): NodeProcessingStage[] {
	const index = NODE_PROCESSING_STAGES.indexOf(stage);
	return index < 0 ? [] : [...NODE_PROCESSING_STAGES.slice(index + 1)];
}

export async function renewNodeProcessingLease(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
		leaseMs: number;
	}
): Promise<boolean> {
	assertPositiveLease(input.leaseMs);
	const fields = stageFields(input.stage);
	const now = new Date();
	const rows = await db
		.update(nodes)
		.set({
			[fields.leaseExpiresAtKey]: new Date(now.getTime() + input.leaseMs),
			updatedAt: now,
		})
		.where(stageRunGuard(input.stage, input.nodeId, input.runId))
		.returning({ id: nodes.id });

	return rows.length > 0;
}

export async function persistNodeEnrichmentArtifacts(
	db: KgActionDb,
	input: {
		nodeId: string;
		artifactVersion: string;
		targetUrl?: string | null;
		traceId?: string | null;
		artifacts: NodeEnrichmentArtifactInput[];
		timings?: unknown;
		errors?: unknown;
		skipped?: unknown;
	}
): Promise<string[]> {
	const nodeId = normalizeProtocolTermId(input.nodeId, 'nodeId');

	if (input.artifacts.length === 0) {
		return [];
	}

	// The artifact ID is stable across retries (see stableEnrichmentArtifactSourceHash),
	// so retries upsert into the same row. The `data` column below mixes the
	// deterministic payload (`classification`, `data`, `meta`) with run-scoped
	// fields (`traceId`, `timings`, `errors`, `skipped`) that change every retry.
	// Consumers MUST treat the run-scoped fields as best-effort metadata for the
	// most recent run only — never as immutable values keyed off the artifact ID.
	return createArtifacts(
		db,
		input.artifacts.map((artifact) => {
			const extracted = artifact.extracted ?? extractEnrichmentArtifactFields(artifact);

			return {
				nodeId,
				artifactKind: artifact.artifactKind,
				artifactVersion: artifact.artifactVersion ?? input.artifactVersion,
				status: artifact.status ?? (artifact.error ? 'failed' : 'active'),
				sourceUri: artifact.sourceUri ?? input.targetUrl,
				sourceHash: artifact.sourceHash ?? stableEnrichmentArtifactSourceHash(artifact),
				data: {
					classification: artifact.artifactKind,
					data: artifact.data,
					meta: artifact.meta,
					// run-scoped fields below: rewritten on every retry, do not rely on stability
					traceId: input.traceId,
					timings: input.timings,
					errors: input.errors,
					skipped: input.skipped,
				},
				extracted,
				error: artifact.error,
			};
		})
	);
}

export async function completeNodeEnrichmentStageWithArtifacts(
	db: KgActionDb,
	input: {
		nodeId: string;
		runId: string;
		artifactVersion: string;
		targetUrl?: string | null;
		traceId?: string | null;
		artifacts: NodeEnrichmentArtifactInput[];
		timings?: unknown;
		errors?: unknown;
		skipped?: unknown;
	}
) {
	return inKgTransaction(db, async (tx) => {
		await lockClaimedProcessingStage(tx, {
			stage: 'enrichment',
			nodeId: input.nodeId,
			runId: input.runId,
		});
		const artifactIds = await persistNodeEnrichmentArtifacts(tx, input);
		const node = await completeNodeProcessingStage(tx, {
			stage: 'enrichment',
			nodeId: input.nodeId,
			runId: input.runId,
		});

		return { node, artifactIds };
	});
}

async function failOrSkipNodeProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
		status: 'failed' | 'skipped';
		error: NodeProcessingError;
	}
) {
	const fields = stageFields(input.stage);
	const now = new Date();
	const [node] = await db
		.update(nodes)
		.set({
			[fields.statusKey]: input.status,
			[fields.leaseExpiresAtKey]: null,
			[fields.errorKey]: normalizeProcessingError(input.error, now),
			updatedAt: now,
		})
		.where(stageRunGuard(input.stage, input.nodeId, input.runId))
		.returning();

	if (!node) {
		throw notFound('Processing stage is not claimed by this run.');
	}

	return node;
}

async function lockClaimedProcessingStage(
	db: KgActionDb,
	input: {
		stage: NodeProcessingStage;
		nodeId: string;
		runId: string;
	}
) {
	const rows = await db
		.update(nodes)
		.set({ processingMeta: sql`${nodes.processingMeta}` })
		.where(stageRunGuard(input.stage, input.nodeId, input.runId))
		.returning({ id: nodes.id });

	if (rows.length === 0) {
		throw notFound('Processing stage is not claimed by this run.');
	}
}

function stageRunGuard(stage: NodeProcessingStage, nodeId: string, runId: string) {
	const fields = stageFields(stage);

	return and(
		eq(nodes.id, normalizeProtocolTermId(nodeId, 'nodeId')),
		eq(fields.statusColumn, 'processing'),
		sql`${nodes.processingMeta}->>${fields.runIdMetaKey} = ${runId}`
	);
}

function stageFields(stage: NodeProcessingStage) {
	switch (stage) {
		case 'parse':
			return {
				statusKey: 'parseStatus',
				statusColumn: nodes.parseStatus,
				attemptsKey: 'parseAttempts',
				attemptsColumn: nodes.parseAttempts,
				startedAtKey: 'parseStartedAt',
				leaseExpiresAtKey: 'parseLeaseExpiresAt',
				leaseExpiresAtColumn: nodes.parseLeaseExpiresAt,
				completedAtKey: 'parsedAt',
				errorKey: 'parseError',
				errorColumn: nodes.parseError,
				resultKey: 'parseResult',
				workerIdMetaKey: 'parseWorkerId',
				runIdMetaKey: 'parseRunId',
			} as const;
		case 'classification':
			return {
				statusKey: 'classificationStatus',
				statusColumn: nodes.classificationStatus,
				attemptsKey: 'classificationAttempts',
				attemptsColumn: nodes.classificationAttempts,
				startedAtKey: 'classificationStartedAt',
				leaseExpiresAtKey: 'classificationLeaseExpiresAt',
				leaseExpiresAtColumn: nodes.classificationLeaseExpiresAt,
				completedAtKey: 'classifiedAt',
				errorKey: 'classificationError',
				errorColumn: nodes.classificationError,
				resultKey: 'classificationResult',
				workerIdMetaKey: 'classificationWorkerId',
				runIdMetaKey: 'classificationRunId',
			} as const;
		case 'enrichment':
			return {
				statusKey: 'enrichmentStatus',
				statusColumn: nodes.enrichmentStatus,
				attemptsKey: 'enrichmentAttempts',
				attemptsColumn: nodes.enrichmentAttempts,
				startedAtKey: 'enrichmentStartedAt',
				leaseExpiresAtKey: 'enrichmentLeaseExpiresAt',
				leaseExpiresAtColumn: nodes.enrichmentLeaseExpiresAt,
				completedAtKey: 'enrichedAt',
				errorKey: 'enrichmentError',
				errorColumn: nodes.enrichmentError,
				resultKey: undefined,
				workerIdMetaKey: 'enrichmentWorkerId',
				runIdMetaKey: 'enrichmentRunId',
			} as const;
		default:
			throw invalidInput(`Unknown processing stage: ${stage satisfies never}`);
	}
}

function normalizeProcessingError(error: NodeProcessingError, now: Date): NodeProcessingError {
	return {
		...error,
		observedAt: error.observedAt ?? now.toISOString(),
	};
}

function stableEnrichmentArtifactSourceHash(artifact: NodeEnrichmentArtifactInput): string {
	return hashArtifactPayload({
		data: artifact.data,
		extracted: artifact.extracted ?? {},
		error: artifact.error ?? null,
	});
}

function extractEnrichmentArtifactFields(
	artifact: NodeEnrichmentArtifactInput
): Record<string, unknown> {
	const data = toRecordMaybe(artifact.data);
	const meta = toRecordMaybe(artifact.meta);
	const extracted: Record<string, unknown> = {};
	const title = firstString(data.title, data.name);
	const description = firstString(data.description, data.summary);
	const imageUrl = firstString(data.imageUrl, data.image, data.logoUrl);
	const iconUrl = firstString(
		data.iconUrl,
		artifact.artifactKind === 'favicon' ? data.url : undefined
	);
	const normalizedUrl = firstString(
		data.url,
		data.canonicalUrl,
		artifact.sourceUri,
		meta.sourceUrl
	);
	const provider = firstString(meta.provider, meta.pluginId);
	const providerId = firstString(
		data.providerId,
		data.id,
		data.brandId,
		data.spotifyId,
		data.githubId
	);
	const primaryColor = firstString(data.primaryColor);
	const secondaryColor = firstString(data.secondaryColor);

	if (title) {
		extracted.title = title;
	}
	if (description) {
		extracted.description = description;
	}
	if (imageUrl) {
		extracted.imageUrl = imageUrl;
	}
	if (iconUrl) {
		extracted.iconUrl = iconUrl;
	}
	if (normalizedUrl) {
		extracted.normalizedUrl = normalizedUrl;
	}
	if (provider) {
		extracted.provider = provider;
	}
	if (providerId) {
		extracted.providerId = providerId;
	}
	if (primaryColor || secondaryColor) {
		extracted.colors = {
			...(primaryColor ? { primary: primaryColor } : {}),
			...(secondaryColor ? { secondary: secondaryColor } : {}),
		};
	}

	return extracted;
}

function toRecordMaybe(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}

	return undefined;
}

function assertPositiveLease(leaseMs: number): void {
	assertPositiveInteger(leaseMs, 'leaseMs');
	if (leaseMs < 1000) {
		throw invalidInput('leaseMs must be at least 1000.');
	}
}

function assertPositiveInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 1) {
		throw invalidInput(`${label} must be a positive integer.`);
	}
}
