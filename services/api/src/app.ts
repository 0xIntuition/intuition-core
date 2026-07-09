import {
	accounts,
	artifacts,
	createKgConnection,
	type KgDb,
	kgEvents,
	nodeStats,
	nodes,
	predicates,
	triples,
} from '@0xintuition/database-kg';
import {
	ensureNodeWithCreation,
	ensureTripleWithCreation,
	type KgNodeRawType,
} from '@0xintuition/database-kg/actions';
import { and, desc, eq, getTableColumns, ilike, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { getConnInfo } from 'hono/bun';
import { cors } from 'hono/cors';
import { type ApiKeyIdentity, bearerToken, resolveApiKey } from './auth';
import type { ApiConfig } from './config';
import { createRateLimiter } from './rate-limit';
import { type KgSchemaMetadata, loadKgSchemaMetadata } from './schema';

type AppEnv = {
	Variables: {
		apiKey: ApiKeyIdentity | null;
	};
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;
const GATED_PUBLIC_PATHS = new Set(['/health', '/api/schema']);

export function isGatedPublicPath(path: string): boolean {
	return GATED_PUBLIC_PATHS.has(path);
}

/** Escape LIKE metacharacters so user search text matches literally. */
function escapeLikePattern(input: string): string {
	return input.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function parsePagination(query: Record<string, string | undefined>) {
	const limit = Math.min(
		Math.max(Number.parseInt(query.limit ?? `${DEFAULT_PAGE_SIZE}`, 10) || DEFAULT_PAGE_SIZE, 1),
		MAX_PAGE_SIZE
	);
	const offset = Math.max(Number.parseInt(query.offset ?? '0', 10) || 0, 0);
	return { limit, offset };
}

/** Only active, public rows are served — the public read model. */
const publicNodes = and(eq(nodes.status, 'active'), eq(nodes.visibility, 'public'));
const publicTriples = and(eq(triples.status, 'active'), eq(triples.visibility, 'public'));

// Aliased node joins for `?expand=terms` — one per triple position. Drizzle
// collapses an all-null joined selection to `null`, so missing terms arrive
// as `subject: null` with no extra normalization.
const subjectNodes = alias(nodes, 'subject_nodes');
const predicateNodes = alias(nodes, 'predicate_nodes');
const objectNodes = alias(nodes, 'object_nodes');

type PipelineStage = 'parse' | 'classification' | 'enrichment';
const PIPELINE_STAGES: readonly PipelineStage[] = ['parse', 'classification', 'enrichment'];

/** Fold grouped (parse, classification, enrichment, count) rows into per-stage status counts. */
export function aggregatePipelineStats(
	rows: ReadonlyArray<Record<PipelineStage, string> & { count: number }>
): Record<PipelineStage, Record<string, number>> {
	const stages: Record<PipelineStage, Record<string, number>> = {
		parse: {},
		classification: {},
		enrichment: {},
	};
	for (const row of rows) {
		for (const stage of PIPELINE_STAGES) {
			const status = row[stage];
			stages[stage][status] = (stages[stage][status] ?? 0) + row.count;
		}
	}
	return stages;
}

/**
 * Cheap raw-type detection for ingest. The parse worker performs the
 * authoritative parse afterward — this only picks the storage lane.
 */
export function detectRawType(input: string): KgNodeRawType {
	const trimmed = input.trim();
	if (/^https?:\/\//i.test(trimmed)) {
		return 'http_uri';
	}
	if (/^ipfs:\/\//i.test(trimmed)) {
		return 'ipfs_uri';
	}
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			JSON.parse(trimmed);
			return 'json';
		} catch {
			return 'string';
		}
	}
	return 'string';
}

export function createApp(config: ApiConfig) {
	const connection = createKgConnection({ connectionString: config.databaseKgUrl });
	const db: KgDb = connection.db;
	let schemaMetadataPromise: Promise<KgSchemaMetadata> | null = null;

	const app = new Hono<AppEnv>();

	app.use(
		'*',
		cors(
			config.allowedOrigins.length > 0
				? { origin: config.allowedOrigins }
				: { origin: (origin) => origin }
		)
	);

	// Resolve an API key when presented; reject bad keys outright so callers
	// never silently proceed unauthenticated with a typo'd key.
	app.use('*', async (c, next) => {
		const token = bearerToken(c.req.header('authorization'));
		if (!token) {
			c.set('apiKey', null);
			return next();
		}
		const identity = await resolveApiKey(db, token);
		if (!identity) {
			return c.json({ error: 'invalid_api_key' }, 401);
		}
		c.set('apiKey', identity);
		return next();
	});

	// `gated` mode: everything (except liveness) requires a key.
	app.use('*', async (c, next) => {
		if (config.authMode === 'gated' && !isGatedPublicPath(c.req.path) && !c.get('apiKey')) {
			return c.json({ error: 'api_key_required' }, 401);
		}
		return next();
	});

	// Rate limiting: per API key when presented, per client IP otherwise. The
	// effective limit is the key's own override when set, else the global
	// default. 0 (either level) means unlimited.
	const limiter = createRateLimiter();
	app.use('*', async (c, next) => {
		if (c.req.path === '/health') {
			return next();
		}

		const identity = c.get('apiKey');
		// x-forwarded-for is client-controlled; only honor it when the operator
		// says a trusted proxy sets it (API_TRUST_PROXY=1). Otherwise bucket by
		// the socket address so spoofed headers can't mint fresh buckets.
		let anonymousBucket: string;
		if (config.trustProxy) {
			anonymousBucket = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
		} else {
			try {
				anonymousBucket = getConnInfo(c).remote.address ?? 'unknown';
			} catch {
				anonymousBucket = 'unknown';
			}
		}
		const bucket = identity ? `key:${identity.keyId}` : `ip:${anonymousBucket}`;
		const limit = identity?.rateLimitRpm ?? config.rateLimitRpm;

		const decision = limiter.check(bucket, limit);
		if (decision.limit > 0) {
			c.header('x-ratelimit-limit', String(decision.limit));
			c.header('x-ratelimit-remaining', String(decision.remaining));
			c.header('x-ratelimit-reset', String(decision.resetAtMs));
		}
		if (!decision.allowed) {
			c.header('retry-after', String(decision.retryAfterSeconds));
			return c.json({ error: 'rate_limited' }, 429);
		}
		return next();
	});

	/** Gate for write endpoints per the configured auth mode. */
	const requireWriter = (c: {
		get: (k: 'apiKey') => ApiKeyIdentity | null;
	}): { error: string; status: 401 | 403 } | { identity: ApiKeyIdentity | null } => {
		const identity = c.get('apiKey');
		if (config.authMode === 'open') {
			return { identity };
		}
		if (!identity) {
			return { error: 'api_key_required', status: 401 };
		}
		if (!identity.canWrite) {
			return { error: 'api_key_not_writable', status: 403 };
		}
		return { identity };
	};

	app.onError((error, c) => {
		console.error('[api] error:', error);
		return c.json({ error: 'internal_error' }, 500);
	});

	app.get('/health', async (c) => {
		try {
			await db.execute(sql`SELECT 1`);
			return c.json({ status: 'ok' });
		} catch {
			return c.json({ status: 'degraded', database: 'unreachable' }, 503);
		}
	});

	app.get('/api/schema', async (c) => {
		schemaMetadataPromise ??= loadKgSchemaMetadata(db).catch((error) => {
			schemaMetadataPromise = null;
			throw error;
		});
		const metadata = await schemaMetadataPromise;
		return c.json({ data: metadata });
	});

	// ── Atoms (kg.nodes) ────────────────────────────────────────────────────

	// Ingest: create an atom from any raw input (URL, string, or JSON). The ID
	// is a pure function of the bytes — the same protocol atom ID MultiVault
	// would register — so this endpoint is idempotent: posting the same input
	// twice returns the same atom. The parse → classify → enrich workers pick
	// it up from `pending` automatically. Requires a write-scoped API key
	// (unless API_AUTH=open); the atom's `created_by` is the key's account.
	app.post('/api/atoms', async (c) => {
		const writer = requireWriter(c);
		if ('error' in writer) {
			return c.json({ error: writer.error }, writer.status);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: 'invalid_json' }, 400);
		}

		const input = (body as { input?: unknown }).input;
		if (typeof input !== 'string' || input.trim().length === 0) {
			return c.json({ error: 'invalid_input', message: 'body must be { "input": string }' }, 400);
		}
		if (input.length > 64_000) {
			return c.json({ error: 'input_too_large', message: 'input must be under 64KB' }, 413);
		}

		const { nodeId, created } = await ensureNodeWithCreation(db, {
			rawType: detectRawType(input),
			classificationType: 'Unknown',
			data: input,
			createdBy: writer.identity?.accountId ?? null,
		});

		return c.json(
			{ data: { id: nodeId, created, createdBy: writer.identity?.accountId ?? null } },
			created ? 201 : 200
		);
	});

	app.get('/api/atoms', async (c) => {
		const query = c.req.query();
		const { limit, offset } = parsePagination(query);

		const filters = [publicNodes];
		if (query.classification_type) {
			filters.push(eq(nodes.classificationType, query.classification_type));
		}
		if (query.q) {
			filters.push(ilike(nodes.searchText, `%${escapeLikePattern(query.q)}%`));
		}

		const rows = await db
			.select({
				id: nodes.id,
				createdAt: nodes.createdAt,
				isOnchain: nodes.isOnchain,
				rawType: nodes.rawType,
				data: nodes.data,
				dataResolved: nodes.dataResolved,
				classificationType: nodes.classificationType,
				parseStatus: nodes.parseStatus,
				classificationStatus: nodes.classificationStatus,
				enrichmentStatus: nodes.enrichmentStatus,
			})
			.from(nodes)
			.where(and(...filters))
			.orderBy(desc(nodes.createdAt), desc(nodes.id))
			.limit(limit)
			.offset(offset);

		return c.json({ data: rows, pagination: { limit, offset, count: rows.length } });
	});

	app.get('/api/atoms/:id', async (c) => {
		const id = c.req.param('id');
		const [row] = await db
			.select()
			.from(nodes)
			.where(and(eq(nodes.id, id), publicNodes))
			.limit(1);

		if (!row) {
			return c.json({ error: 'not_found' }, 404);
		}

		// Graph-degree stats are maintained by the adjacency projections; absent
		// until the node participates in a triple.
		const [stats] = await db.select().from(nodeStats).where(eq(nodeStats.nodeId, id)).limit(1);

		return c.json({
			data: {
				...row,
				stats: stats
					? {
							inDegree: Number(stats.inDegree),
							outDegree: Number(stats.outDegree),
							neighborKindCounts: stats.neighborKindCounts,
							predicateCounts: stats.predicateCounts,
							updatedAt: stats.updatedAt,
						}
					: null,
			},
		});
	});

	// Enrichment artifacts attached to an atom (opengraph, provider payloads, …).
	// Served only for atoms in the public read model.
	app.get('/api/atoms/:id/artifacts', async (c) => {
		const id = c.req.param('id');
		const { limit, offset } = parsePagination(c.req.query());

		const [node] = await db
			.select({ id: nodes.id })
			.from(nodes)
			.where(and(eq(nodes.id, id), publicNodes))
			.limit(1);
		if (!node) {
			return c.json({ error: 'not_found' }, 404);
		}

		const rows = await db
			.select({
				id: artifacts.id,
				createdAt: artifacts.createdAt,
				updatedAt: artifacts.updatedAt,
				artifactKind: artifacts.artifactKind,
				artifactVersion: artifacts.artifactVersion,
				status: artifacts.status,
				sourceUri: artifacts.sourceUri,
				data: artifacts.data,
				extracted: artifacts.extracted,
				error: artifacts.error,
			})
			.from(artifacts)
			.where(eq(artifacts.nodeId, id))
			.orderBy(desc(artifacts.createdAt), desc(artifacts.id))
			.limit(limit)
			.offset(offset);

		return c.json({ data: rows, pagination: { limit, offset, count: rows.length } });
	});

	/**
	 * Triples with `{id, data, classificationType, rawType}` summaries joined
	 * in for each S/P/O term (`?expand=terms`) — a triple table is unreadable
	 * as bare 32-byte ids.
	 */
	const selectExpandedTriples = () =>
		db
			.select({
				...getTableColumns(triples),
				subject: {
					id: subjectNodes.id,
					data: subjectNodes.data,
					classificationType: subjectNodes.classificationType,
					rawType: subjectNodes.rawType,
				},
				predicate: {
					id: predicateNodes.id,
					data: predicateNodes.data,
					classificationType: predicateNodes.classificationType,
					rawType: predicateNodes.rawType,
				},
				object: {
					id: objectNodes.id,
					data: objectNodes.data,
					classificationType: objectNodes.classificationType,
					rawType: objectNodes.rawType,
				},
			})
			.from(triples)
			// Public-read-model filter ON THE JOIN, not just the triple: a term
			// whose atom is draft/unlisted must come back null, never leak its
			// data through a public triple.
			.leftJoin(
				subjectNodes,
				and(
					eq(triples.subjectId, subjectNodes.id),
					eq(subjectNodes.status, 'active'),
					eq(subjectNodes.visibility, 'public')
				)
			)
			.leftJoin(
				predicateNodes,
				and(
					eq(triples.predicateId, predicateNodes.id),
					eq(predicateNodes.status, 'active'),
					eq(predicateNodes.visibility, 'public')
				)
			)
			.leftJoin(
				objectNodes,
				and(
					eq(triples.objectId, objectNodes.id),
					eq(objectNodes.status, 'active'),
					eq(objectNodes.visibility, 'public')
				)
			);

	const wantsExpandedTerms = (query: Record<string, string | undefined>) =>
		query.expand === 'terms';

	// All triples touching an atom, in any position — served by the hexastore.
	app.get('/api/atoms/:id/triples', async (c) => {
		const id = c.req.param('id');
		const query = c.req.query();
		const { limit, offset } = parsePagination(query);

		const where = and(
			or(eq(triples.subjectId, id), eq(triples.predicateId, id), eq(triples.objectId, id)),
			publicTriples
		);

		if (wantsExpandedTerms(query)) {
			const rows = await selectExpandedTriples()
				.where(where)
				.orderBy(desc(triples.createdAt), desc(triples.id))
				.limit(limit)
				.offset(offset);
			return c.json({
				data: rows,
				pagination: { limit, offset, count: rows.length },
			});
		}

		const rows = await db
			.select()
			.from(triples)
			.where(where)
			.orderBy(desc(triples.createdAt), desc(triples.id))
			.limit(limit)
			.offset(offset);

		return c.json({ data: rows, pagination: { limit, offset, count: rows.length } });
	});

	// ── Triples (kg.triples) ────────────────────────────────────────────────

	// Ingest: create a claim between existing terms. The triple ID is a pure
	// function of (subject, predicate, object) — idempotent like atoms.
	// Requires a write-scoped API key (unless API_AUTH=open); `created_by` is
	// the key's account.
	app.post('/api/triples', async (c) => {
		const writer = requireWriter(c);
		if ('error' in writer) {
			return c.json({ error: writer.error }, writer.status);
		}

		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: 'invalid_json' }, 400);
		}

		const { subject_id, predicate_id, object_id } = body as Record<string, unknown>;
		for (const [field, value] of Object.entries({ subject_id, predicate_id, object_id })) {
			if (typeof value !== 'string' || value.trim().length === 0) {
				return c.json(
					{
						error: 'invalid_input',
						message: `body must include ${field} as a 32-byte protocol term id`,
					},
					400
				);
			}
		}

		try {
			const { tripleId, created } = await ensureTripleWithCreation(db, {
				subject: { type: 'node', id: subject_id as string },
				predicate: { type: 'node', id: predicate_id as string },
				object: { type: 'node', id: object_id as string },
				createdBy: writer.identity?.accountId ?? null,
				source: 'api',
			});
			return c.json(
				{ data: { id: tripleId, created, createdBy: writer.identity?.accountId ?? null } },
				created ? 201 : 200
			);
		} catch (error) {
			// Term-id validation errors are client errors, not 500s.
			const message = error instanceof Error ? error.message : 'invalid term id';
			if (message.includes('protocol term id')) {
				return c.json({ error: 'invalid_term_id', message }, 400);
			}
			throw error;
		}
	});

	app.get('/api/triples', async (c) => {
		const query = c.req.query();
		const { limit, offset } = parsePagination(query);

		const filters = [publicTriples];
		if (query.subject_id) {
			filters.push(eq(triples.subjectId, query.subject_id));
		}
		if (query.predicate_id) {
			filters.push(eq(triples.predicateId, query.predicate_id));
		}
		if (query.object_id) {
			filters.push(eq(triples.objectId, query.object_id));
		}

		if (wantsExpandedTerms(query)) {
			const rows = await selectExpandedTriples()
				.where(and(...filters))
				.orderBy(desc(triples.createdAt), desc(triples.id))
				.limit(limit)
				.offset(offset);
			return c.json({
				data: rows,
				pagination: { limit, offset, count: rows.length },
			});
		}

		const rows = await db
			.select()
			.from(triples)
			.where(and(...filters))
			.orderBy(desc(triples.createdAt), desc(triples.id))
			.limit(limit)
			.offset(offset);

		return c.json({ data: rows, pagination: { limit, offset, count: rows.length } });
	});

	app.get('/api/triples/:id', async (c) => {
		const id = c.req.param('id');

		if (wantsExpandedTerms(c.req.query())) {
			const [row] = await selectExpandedTriples()
				.where(and(eq(triples.id, id), publicTriples))
				.limit(1);
			if (!row) {
				return c.json({ error: 'not_found' }, 404);
			}
			return c.json({ data: row });
		}

		const [row] = await db
			.select()
			.from(triples)
			.where(and(eq(triples.id, id), publicTriples))
			.limit(1);

		if (!row) {
			return c.json({ error: 'not_found' }, 404);
		}
		return c.json({ data: row });
	});

	// ── Events (kg.events) ──────────────────────────────────────────────────

	// Append-only activity feed: node/triple/predicate/artifact creations,
	// onchain and offchain. Filterable by entity kind/type/id.
	app.get('/api/events', async (c) => {
		const query = c.req.query();
		const { limit, offset } = parsePagination(query);

		const filters = [];
		if (query.entity_kind) {
			filters.push(eq(kgEvents.entityKind, query.entity_kind));
		}
		if (query.event_type) {
			filters.push(eq(kgEvents.eventType, query.event_type));
		}
		if (query.entity_id) {
			filters.push(eq(kgEvents.entityId, query.entity_id));
		}

		const rows = await db
			.select({
				id: kgEvents.id,
				eventTime: kgEvents.eventTime,
				eventType: kgEvents.eventType,
				entityKind: kgEvents.entityKind,
				entityId: kgEvents.entityId,
				actorId: kgEvents.actorId,
				classificationType: kgEvents.classificationType,
				isOnchain: kgEvents.isOnchain,
				blockNumber: kgEvents.blockNumber,
				txHash: kgEvents.txHash,
				payload: kgEvents.payload,
			})
			.from(kgEvents)
			.where(filters.length > 0 ? and(...filters) : undefined)
			.orderBy(desc(kgEvents.eventTime), desc(kgEvents.id))
			.limit(limit)
			.offset(offset);

		return c.json({
			data: rows.map((row) => ({
				...row,
				blockNumber: row.blockNumber === null ? null : Number(row.blockNumber),
			})),
			pagination: { limit, offset, count: rows.length },
		});
	});

	// ── Predicates & stats ──────────────────────────────────────────────────

	app.get('/api/predicates', async (c) => {
		const rows = await db.select().from(predicates).orderBy(predicates.slug);
		return c.json({ data: rows });
	});

	// Worker-pipeline health: how many public atoms sit in each stage/status.
	// One grouped scan; statuses come from the CHECK-constrained columns.
	app.get('/api/stats/pipeline', async (c) => {
		const rows = await db
			.select({
				parse: nodes.parseStatus,
				classification: nodes.classificationStatus,
				enrichment: nodes.enrichmentStatus,
				count: sql<number>`count(*)::int`,
			})
			.from(nodes)
			.where(publicNodes)
			.groupBy(nodes.parseStatus, nodes.classificationStatus, nodes.enrichmentStatus);

		return c.json({ data: aggregatePipelineStats(rows) });
	});

	app.get('/api/stats', async (c) => {
		const [counts] = await db
			.select({
				atoms: sql<number>`(SELECT count(*) FROM ${nodes} WHERE ${publicNodes})::int`,
				triples: sql<number>`(SELECT count(*) FROM ${triples} WHERE ${publicTriples})::int`,
				accounts: sql<number>`(SELECT count(*) FROM ${accounts})::int`,
				predicates: sql<number>`(SELECT count(*) FROM ${predicates})::int`,
			})
			.from(sql`(SELECT 1) AS one`);

		return c.json({ data: counts });
	});

	return { app, close: connection.close };
}
