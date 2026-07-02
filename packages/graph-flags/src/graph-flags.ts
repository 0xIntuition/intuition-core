/**
 * Graph feature flags for the SurrealDB -> Postgres migration.
 *
 * Controls the rollout of graph database reads, writes, search,
 * recommendations, and event recording via environment variables.
 * All flags default to `false` (safe default). Any parse error,
 * missing env var, or malformed value falls back to `false`.
 *
 * Env var format:
 * - `GRAPH_DB_WRITES_ENABLED=posts,follows` (comma-separated, or `*` for all)
 * - `GRAPH_DB_READS_ENABLED=post_detail,follow_list` (comma-separated, or `*` for all)
 * - `GRAPH_SEARCH_ENABLED=true`
 * - `GRAPH_RECOMMENDATIONS_ENABLED=true`
 * - `GRAPH_EVENT_RECORDING_ENABLED=social,market` (comma-separated, or `*` for all)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Entity families controlled by the dual-write projector gate. */
export type GraphEntityKind =
	| 'posts'
	| 'follows'
	| 'artifacts'
	| 'enrichments'
	| 'social_events'
	| 'market_events';

/** Read surfaces that can be individually flipped to the graph DB. */
export type GraphReadSurface =
	| 'post_detail'
	| 'follow_list'
	| 'recommendations'
	| 'search'
	| 'neighborhood'
	| 'node_detail';

/** Event kind families for social/market event recording. */
export type EventKind = 'social' | 'market';

// Canonical value sets (used for validation)
const GRAPH_ENTITY_KINDS: ReadonlySet<string> = new Set<GraphEntityKind>([
	'posts',
	'follows',
	'artifacts',
	'enrichments',
	'social_events',
	'market_events',
]);

const GRAPH_READ_SURFACES: ReadonlySet<string> = new Set<GraphReadSurface>([
	'post_detail',
	'follow_list',
	'recommendations',
	'search',
	'neighborhood',
	'node_detail',
]);

const EVENT_KINDS: ReadonlySet<string> = new Set<EventKind>(['social', 'market']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated env var into a Set of validated, lowercased values.
 * Supports `*` or `all` shorthand to enable every valid value at once.
 * Invalid tokens are logged as warnings and dropped.
 * Returns an empty set on any error.
 */
function parseCsvSet(envValue: string | undefined, validValues: ReadonlySet<string>): Set<string> {
	if (!envValue) {
		return new Set();
	}

	try {
		const trimmed = envValue.trim().toLowerCase();

		// Support wildcard shorthand
		if (trimmed === '*' || trimmed === 'all') {
			return new Set(validValues);
		}

		const result = new Set<string>();
		for (const raw of envValue.split(',')) {
			const token = raw.trim().toLowerCase();
			if (token.length === 0) continue;
			if (validValues.has(token)) {
				result.add(token);
			} else {
				console.warn(
					`[graph-flags] Unknown token "${token}" in env var — valid values: ${[...validValues].join(', ')}`
				);
			}
		}
		return result;
	} catch {
		return new Set();
	}
}

/** Parse a boolean env var. Returns `false` for any non-truthy value. */
function parseBooleanEnv(envValue: string | undefined): boolean {
	if (!envValue) {
		return false;
	}

	try {
		const normalized = envValue.trim().toLowerCase();
		return ['1', 'true', 't', 'yes', 'y', 'on'].includes(normalized);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Env source (allows override for testing without mutating process.env)
// ---------------------------------------------------------------------------

type EnvSource = Record<string, string | undefined>;

let envSource: EnvSource | undefined;

// Cache for parsed CSV sets — invalidated when env source changes
const csvCache = new Map<string, Set<string>>();

/**
 * Override the environment source used by all flag helpers.
 * Pass `undefined` to revert to `process.env`.
 *
 * @internal Intended for testing only — do not use in production code.
 */
export function setGraphFlagEnvSource(source: EnvSource | undefined): void {
	envSource = source;
	csvCache.clear();
}

function getEnv(key: string): string | undefined {
	const src = envSource ?? process.env;
	return src[key];
}

/** Get or compute a cached CSV set for a given env var key. */
function getCachedCsvSet(envKey: string, validValues: ReadonlySet<string>): Set<string> {
	const cached = csvCache.get(envKey);
	if (cached) return cached;

	const parsed = parseCsvSet(getEnv(envKey), validValues);
	csvCache.set(envKey, parsed);
	return parsed;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Check whether dual-write is enabled for a specific entity family.
 *
 * Reads `GRAPH_DB_WRITES_ENABLED` (comma-separated list of entity kinds).
 * Returns `true` only if the given entity is present in that list.
 *
 * @example
 * ```ts
 * // GRAPH_DB_WRITES_ENABLED=posts,follows
 * graphWritesEnabled('posts');   // true
 * graphWritesEnabled('artifacts'); // false
 * ```
 *
 * **Integration point:** Use in projectors (`backend/api/src/projectors/`)
 * to gate whether a mutation is also written to the graph database.
 * Each projector should call this before executing its write path:
 *
 * ```ts
 * if (graphWritesEnabled('posts')) {
 *   await postProjector.project(event);
 * }
 * ```
 */
export function graphWritesEnabled(entity: GraphEntityKind): boolean {
	return getCachedCsvSet('GRAPH_DB_WRITES_ENABLED', GRAPH_ENTITY_KINDS).has(entity);
}

/**
 * Check whether graph DB reads are enabled for a specific surface.
 *
 * Reads `GRAPH_DB_READS_ENABLED` (comma-separated list of read surfaces).
 * Returns `true` only if the given surface is present in that list.
 *
 * @example
 * ```ts
 * // GRAPH_DB_READS_ENABLED=post_detail,follow_list
 * graphReadsEnabled('post_detail');    // true
 * graphReadsEnabled('recommendations'); // false
 * ```
 *
 * **Integration point:** Use in tRPC routers (`packages/trpc/src/router/kg-*.ts`)
 * to decide whether to serve data from the graph DB or fall back to SurrealDB.
 *
 * ```ts
 * if (graphReadsEnabled('post_detail')) {
 *   return kgGraphClient.getPost(id);
 * }
 * return surrealClient.getPost(id);
 * ```
 */
export function graphReadsEnabled(surface: GraphReadSurface): boolean {
	return getCachedCsvSet('GRAPH_DB_READS_ENABLED', GRAPH_READ_SURFACES).has(surface);
}

/**
 * Check whether search should be routed to the graph DB.
 *
 * Reads `GRAPH_SEARCH_ENABLED` (boolean). Returns `true` only if
 * the env var is explicitly set to a truthy value.
 *
 * **Integration point:** Use in the search router (`packages/trpc/src/router/kg-search.ts`)
 * to flip search traffic from SurrealDB to graph DB.
 *
 * ```ts
 * if (graphSearchEnabled()) {
 *   return kgSearchClient.search(query);
 * }
 * return surrealClient.search(query);
 * ```
 */
export function graphSearchEnabled(): boolean {
	return parseBooleanEnv(getEnv('GRAPH_SEARCH_ENABLED'));
}

/**
 * Check whether recommendations should be routed to PgGraphCandidateSource.
 *
 * Reads `GRAPH_RECOMMENDATIONS_ENABLED` (boolean). Returns `true` only if
 * the env var is explicitly set to a truthy value.
 *
 * **Integration point:** Use in the recommendation router
 * (`packages/trpc/src/router/kg-rec.ts`) to flip recommendation traffic.
 *
 * ```ts
 * if (graphRecommendationsEnabled()) {
 *   return pgGraphCandidateSource.getCandidates(userId);
 * }
 * return surrealCandidateSource.getCandidates(userId);
 * ```
 */
export function graphRecommendationsEnabled(): boolean {
	return parseBooleanEnv(getEnv('GRAPH_RECOMMENDATIONS_ENABLED'));
}

/**
 * Check whether event recording is enabled for a specific event kind.
 *
 * Reads `GRAPH_EVENT_RECORDING_ENABLED` (comma-separated list of event kinds).
 * Returns `true` only if the given event kind is present in that list.
 *
 * @example
 * ```ts
 * // GRAPH_EVENT_RECORDING_ENABLED=social
 * graphEventRecordingEnabled('social'); // true
 * graphEventRecordingEnabled('market'); // false
 * ```
 *
 * **Integration point:** Use in the events router
 * (`packages/trpc/src/router/kg-events.ts` and `backend/api/src/clients/kg-events.ts`)
 * to gate whether events are written to `social.events` / `market.events` tables.
 *
 * ```ts
 * if (graphEventRecordingEnabled('social')) {
 *   await kgEventsClient.recordSocialEvent(event);
 * }
 * ```
 */
export function graphEventRecordingEnabled(eventKind: EventKind): boolean {
	return getCachedCsvSet('GRAPH_EVENT_RECORDING_ENABLED', EVENT_KINDS).has(eventKind);
}

// ---------------------------------------------------------------------------
// Admin introspection
// ---------------------------------------------------------------------------

type CsvFlagState = {
	raw: string;
	parsed: string[];
};

type BooleanFlagState = {
	raw: string;
	enabled: boolean;
};

export type GraphFlagState = {
	GRAPH_DB_WRITES_ENABLED: CsvFlagState;
	GRAPH_DB_READS_ENABLED: CsvFlagState;
	GRAPH_SEARCH_ENABLED: BooleanFlagState;
	GRAPH_RECOMMENDATIONS_ENABLED: BooleanFlagState;
	GRAPH_EVENT_RECORDING_ENABLED: CsvFlagState;
};

/**
 * Return the current state of all graph feature flags.
 *
 * Designed for admin/ops endpoints that need to inspect which flags
 * are active at runtime without side-effects.
 */
export function getAllGraphFlagState(): GraphFlagState {
	const writesRaw = getEnv('GRAPH_DB_WRITES_ENABLED') ?? '';
	const readsRaw = getEnv('GRAPH_DB_READS_ENABLED') ?? '';
	const searchRaw = getEnv('GRAPH_SEARCH_ENABLED') ?? '';
	const recsRaw = getEnv('GRAPH_RECOMMENDATIONS_ENABLED') ?? '';
	const eventsRaw = getEnv('GRAPH_EVENT_RECORDING_ENABLED') ?? '';

	return {
		GRAPH_DB_WRITES_ENABLED: {
			raw: writesRaw,
			parsed: [...getCachedCsvSet('GRAPH_DB_WRITES_ENABLED', GRAPH_ENTITY_KINDS)],
		},
		GRAPH_DB_READS_ENABLED: {
			raw: readsRaw,
			parsed: [...getCachedCsvSet('GRAPH_DB_READS_ENABLED', GRAPH_READ_SURFACES)],
		},
		GRAPH_SEARCH_ENABLED: {
			raw: searchRaw,
			enabled: parseBooleanEnv(searchRaw),
		},
		GRAPH_RECOMMENDATIONS_ENABLED: {
			raw: recsRaw,
			enabled: parseBooleanEnv(recsRaw),
		},
		GRAPH_EVENT_RECORDING_ENABLED: {
			raw: eventsRaw,
			parsed: [...getCachedCsvSet('GRAPH_EVENT_RECORDING_ENABLED', EVENT_KINDS)],
		},
	};
}
