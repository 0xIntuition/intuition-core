/**
 * Typed client for the Intuition Core query API.
 *
 * This file doubles as usage documentation: every endpoint the explorer
 * consumes is one small function over plain `fetch`, with the response shape
 * spelled out as a zod schema. Point `VITE_API_URL` at any Core node.
 */
import { z } from 'zod';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// ── Response schemas ────────────────────────────────────────────────────────

const looseRecord = z.record(z.string(), z.unknown());
const anyJson = z.unknown();

export const atomListItemSchema = z.looseObject({
	id: z.string(),
	createdAt: z.string(),
	isOnchain: z.boolean(),
	rawType: z.string(),
	data: z.string().nullable(),
	dataResolved: anyJson,
	classificationType: z.string(),
	parseStatus: z.string(),
	classificationStatus: z.string(),
	enrichmentStatus: z.string(),
});
export type AtomListItem = z.infer<typeof atomListItemSchema>;

export const atomDetailSchema = atomListItemSchema.extend({
	updatedAt: z.string().optional(),
	createdBy: z.string().nullable().optional(),
	parseResult: anyJson,
	parseError: anyJson,
	classificationResult: anyJson,
	classificationError: anyJson,
	enrichmentError: anyJson,
	searchText: z.string().nullable().optional(),
	stats: z
		.looseObject({
			inDegree: z.number(),
			outDegree: z.number(),
			neighborKindCounts: anyJson,
			predicateCounts: anyJson,
		})
		.nullable()
		.optional(),
});
export type AtomDetail = z.infer<typeof atomDetailSchema>;

export const termSummarySchema = z
	.looseObject({
		id: z.string(),
		data: z.string().nullable(),
		classificationType: z.string(),
		rawType: z.string(),
	})
	.nullable();
export type TermSummary = z.infer<typeof termSummarySchema>;

export const tripleSchema = z.looseObject({
	id: z.string(),
	createdAt: z.string(),
	isOnchain: z.boolean().optional(),
	subjectId: z.string(),
	predicateId: z.string(),
	objectId: z.string(),
	subject: termSummarySchema.optional(),
	predicate: termSummarySchema.optional(),
	object: termSummarySchema.optional(),
});
export type Triple = z.infer<typeof tripleSchema>;

export const artifactSchema = z.looseObject({
	id: z.string(),
	createdAt: z.string(),
	artifactKind: z.string(),
	artifactVersion: z.string(),
	status: z.string(),
	sourceUri: z.string().nullable(),
	data: anyJson,
	extracted: anyJson,
	error: anyJson,
});
export type Artifact = z.infer<typeof artifactSchema>;

export const eventSchema = z.looseObject({
	id: z.string(),
	eventTime: z.string(),
	eventType: z.string(),
	entityKind: z.string(),
	entityId: z.string(),
	actorId: z.string().nullable(),
	classificationType: z.string().nullable(),
	isOnchain: z.boolean(),
	blockNumber: z.number().nullable(),
	txHash: z.string().nullable(),
	payload: anyJson,
});
export type KgEvent = z.infer<typeof eventSchema>;

export const predicateSchema = z.looseObject({
	id: z.string(),
	slug: z.string().nullable().optional(),
});
export type Predicate = z.infer<typeof predicateSchema>;

export const statsSchema = z.object({
	atoms: z.number(),
	triples: z.number(),
	accounts: z.number(),
	predicates: z.number(),
});
export type Stats = z.infer<typeof statsSchema>;

const stageCountsSchema = z.record(z.string(), z.number());
export const pipelineStatsSchema = z.object({
	parse: stageCountsSchema,
	classification: stageCountsSchema,
	enrichment: stageCountsSchema,
});
export type PipelineStats = z.infer<typeof pipelineStatsSchema>;

export const paginationSchema = z.object({
	limit: z.number(),
	offset: z.number(),
	count: z.number(),
});
export type Pagination = z.infer<typeof paginationSchema>;

// ── Request plumbing ────────────────────────────────────────────────────────

export class ApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, body: unknown) {
		const code =
			typeof body === 'object' && body !== null && 'error' in body
				? String((body as { error: unknown }).error)
				: `http_${status}`;
		super(code);
		this.name = 'ApiError';
		this.status = status;
		this.body = body;
	}
}

export type QueryParams = Record<string, string | number | boolean | undefined>;

export function buildUrl(path: string, params?: QueryParams): string {
	const url = new URL(path, API_URL);
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value !== undefined && value !== '') {
			url.searchParams.set(key, String(value));
		}
	}
	return url.toString();
}

async function request<T>(
	schema: z.ZodType<T>,
	path: string,
	options: { params?: QueryParams; method?: string; body?: unknown; apiKey?: string } = {}
): Promise<T> {
	const headers: Record<string, string> = {};
	if (options.body !== undefined) {
		headers['content-type'] = 'application/json';
	}
	if (options.apiKey) {
		headers.authorization = `Bearer ${options.apiKey}`;
	}

	const response = await fetch(buildUrl(path, options.params), {
		method: options.method ?? 'GET',
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});

	const payload = await response.json().catch(() => null);
	if (!response.ok) {
		throw new ApiError(response.status, payload);
	}
	return schema.parse(payload);
}

const listOf = <T extends z.ZodType>(item: T) =>
	z.object({ data: z.array(item), pagination: paginationSchema.optional() });
const one = <T extends z.ZodType>(item: T) => z.object({ data: item });

// ── Reads ───────────────────────────────────────────────────────────────────

export type Page = { limit?: number; offset?: number };

export const api = {
	stats: () => request(one(statsSchema), '/api/stats'),

	pipelineStats: () => request(one(pipelineStatsSchema), '/api/stats/pipeline'),

	atoms: (params: Page & { q?: string; classification_type?: string } = {}) =>
		request(listOf(atomListItemSchema), '/api/atoms', { params }),

	atom: (id: string) => request(one(atomDetailSchema), `/api/atoms/${id}`),

	atomTriples: (id: string, params: Page = {}) =>
		request(listOf(tripleSchema), `/api/atoms/${id}/triples`, {
			params: { ...params, expand: 'terms' },
		}),

	atomArtifacts: (id: string, params: Page = {}) =>
		request(listOf(artifactSchema), `/api/atoms/${id}/artifacts`, { params }),

	triples: (
		params: Page & { subject_id?: string; predicate_id?: string; object_id?: string } = {}
	) => request(listOf(tripleSchema), '/api/triples', { params: { ...params, expand: 'terms' } }),

	triple: (id: string) =>
		request(one(tripleSchema), `/api/triples/${id}`, { params: { expand: 'terms' } }),

	predicates: () => request(z.object({ data: z.array(predicateSchema) }), '/api/predicates'),

	events: (params: Page & { entity_kind?: string; event_type?: string; entity_id?: string } = {}) =>
		request(listOf(eventSchema), '/api/events', { params }),

	schema: () => request(one(looseRecord), '/api/schema'),

	// ── Writes (need a write-scoped key unless the node runs API_AUTH=open) ──

	createAtom: (input: string, apiKey?: string) =>
		request(one(z.looseObject({ id: z.string(), created: z.boolean() })), '/api/atoms', {
			method: 'POST',
			body: { input },
			apiKey,
		}),

	createTriple: (
		terms: { subject_id: string; predicate_id: string; object_id: string },
		apiKey?: string
	) =>
		request(one(z.looseObject({ id: z.string(), created: z.boolean() })), '/api/triples', {
			method: 'POST',
			body: terms,
			apiKey,
		}),
};

/** The curl equivalent of a client call — shown in the playground. */
export function buildCurl(options: {
	path: string;
	params?: QueryParams;
	method?: string;
	body?: unknown;
	apiKey?: string;
}): string {
	const parts = ['curl'];
	if (options.method && options.method !== 'GET') {
		parts.push(`-X ${options.method}`);
	}
	parts.push(`"${buildUrl(options.path, options.params)}"`);
	if (options.apiKey) {
		parts.push(`-H "Authorization: Bearer ${options.apiKey}"`);
	}
	if (options.body !== undefined) {
		parts.push(`-H 'Content-Type: application/json'`, `-d '${JSON.stringify(options.body)}'`);
	}
	return parts.join(' \\\n  ');
}
