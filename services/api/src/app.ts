import {
	accounts,
	createKgConnection,
	type KgDb,
	nodes,
	predicates,
	triples,
} from '@0xintuition/database-kg';
import {
	ensureNodeWithCreation,
	ensureTripleWithCreation,
	type KgNodeRawType,
} from '@0xintuition/database-kg/actions';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { type ApiKeyIdentity, bearerToken, resolveApiKey } from './auth';
import type { ApiConfig } from './config';

type AppEnv = {
	Variables: {
		apiKey: ApiKeyIdentity | null;
	};
};

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

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
		if (config.authMode === 'gated' && c.req.path !== '/health' && !c.get('apiKey')) {
			return c.json({ error: 'api_key_required' }, 401);
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
			filters.push(ilike(nodes.searchText, `%${query.q}%`));
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
		return c.json({ data: row });
	});

	// All triples touching an atom, in any position — served by the hexastore.
	app.get('/api/atoms/:id/triples', async (c) => {
		const id = c.req.param('id');
		const { limit, offset } = parsePagination(c.req.query());

		const rows = await db
			.select()
			.from(triples)
			.where(
				and(
					or(eq(triples.subjectId, id), eq(triples.predicateId, id), eq(triples.objectId, id)),
					publicTriples
				)
			)
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

	// ── Predicates & stats ──────────────────────────────────────────────────

	app.get('/api/predicates', async (c) => {
		const rows = await db.select().from(predicates).orderBy(predicates.slug);
		return c.json({ data: rows });
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
