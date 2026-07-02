import type {
	ClassificationClientClassificationHint,
	ClassificationRequest,
	ClassificationResolvedAtom,
	ClassificationRuntime,
} from './types';

export interface ClassificationCacheAdapter {
	get(key: string): Promise<ClassificationResolverCachedEntry | null>;
	set(key: string, entry: ClassificationResolverCachedEntry, ttlMs: number): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface ClassificationResolverCachedEntry {
	atoms: ClassificationResolvedAtom[];
	fallbackUsed: boolean;
	metadata?: Record<string, unknown>;
	cachedAt: string;
	ttlMs: number;
}

type CreateMemoryClassificationCacheAdapterOptions = {
	maxEntries?: number;
	now?: () => number;
};

type StoredEntry = {
	entry: ClassificationResolverCachedEntry;
	expiresAt: number;
	lastAccessedAt: number;
};

type CreateUpstashClassificationCacheAdapterOptions = {
	baseUrl: string;
	token: string;
	fetcher?: typeof fetch;
	httpTimeoutMs?: number;
};

type CreateUpstashClassificationCacheAdapterFromEnvOptions = {
	env?: Record<string, string | undefined>;
	fetcher?: typeof fetch;
	httpTimeoutMs?: number;
};

const DEFAULT_UPSTASH_HTTP_TIMEOUT_MS = 1_500;

export function createMemoryClassificationCacheAdapter(
	options: CreateMemoryClassificationCacheAdapterOptions = {}
): ClassificationCacheAdapter {
	const storage = new Map<string, StoredEntry>();
	const getNow = options.now ?? (() => Date.now());

	return {
		async get(key) {
			const stored = storage.get(key);
			if (!stored) {
				return null;
			}

			if (stored.expiresAt <= getNow()) {
				storage.delete(key);
				return null;
			}

			stored.lastAccessedAt = getNow();
			storage.set(key, stored);
			return cloneCachedEntry(stored.entry);
		},

		async set(key, entry, ttlMs) {
			const now = getNow();
			storage.set(key, {
				entry: cloneCachedEntry(entry),
				expiresAt: now + ttlMs,
				lastAccessedAt: now,
			});

			if (options.maxEntries && options.maxEntries > 0 && storage.size > options.maxEntries) {
				evictLeastRecentlyUsed(storage);
			}
		},

		async delete(key) {
			storage.delete(key);
		},
	};
}

export function createUpstashClassificationCacheAdapterFromEnv(
	options: CreateUpstashClassificationCacheAdapterFromEnvOptions = {}
): ClassificationCacheAdapter | undefined {
	const env = options.env ?? process.env;
	const baseUrl = env.UPSTASH_REDIS_REST_URL?.trim();
	const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

	if (!baseUrl || !token) {
		return undefined;
	}

	return createUpstashClassificationCacheAdapter({
		baseUrl,
		token,
		fetcher: options.fetcher,
		httpTimeoutMs: options.httpTimeoutMs,
	});
}

export function createUpstashClassificationCacheAdapter(
	options: CreateUpstashClassificationCacheAdapterOptions
): ClassificationCacheAdapter {
	const baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl.slice(0, -1) : options.baseUrl;
	const token = options.token;
	const fetcher = options.fetcher ?? fetch;
	const httpTimeoutMs = Math.max(1, options.httpTimeoutMs ?? DEFAULT_UPSTASH_HTTP_TIMEOUT_MS);
	const headers = {
		Authorization: `Bearer ${token}`,
	};

	return {
		async get(key) {
			const payload = await callUpstashCommand({
				baseUrl,
				fetcher,
				command: 'get',
				args: [key],
				headers,
				httpTimeoutMs,
			});
			const result = payload?.result;
			if (typeof result !== 'string') {
				return null;
			}

			try {
				const parsed = JSON.parse(result) as ClassificationResolverCachedEntry;
				return isClassificationResolverCachedEntry(parsed) ? parsed : null;
			} catch {
				return null;
			}
		},

		async set(key, entry, ttlMs) {
			await callUpstashCommand({
				baseUrl,
				fetcher,
				command: 'set',
				args: [key, JSON.stringify(entry)],
				query: {
					px: String(Math.max(1, Math.floor(ttlMs))),
				},
				headers,
				httpTimeoutMs,
			});
		},

		async delete(key) {
			await callUpstashCommand({
				baseUrl,
				fetcher,
				command: 'del',
				args: [key],
				headers,
				httpTimeoutMs,
			});
		},
	};
}

export function buildClassificationResolverCacheKey(input: {
	pluginId: string;
	resolverId: string;
	runtime: ClassificationRuntime;
	request: Pick<
		ClassificationRequest,
		'input' | 'mode' | 'inputIntent' | 'pluginIds' | 'policy' | 'clientHints'
	>;
	classification: ClassificationClientClassificationHint;
}): string {
	const fingerprint = stableStringify({
		pluginId: input.pluginId,
		resolverId: input.resolverId,
		runtime: input.runtime,
		request: {
			input: input.request.input.trim(),
			mode: input.request.mode,
			inputIntent: input.request.inputIntent,
			pluginIds: normalizePluginIds(input.request.pluginIds),
			policy: input.request.policy ?? null,
			clientHints: input.request.clientHints ?? null,
		},
		classification: {
			type: input.classification.type,
			domain: input.classification.domain,
			subtype: input.classification.subtype,
			confidence: input.classification.confidence,
			meta: input.classification.meta ?? {},
		},
	});

	return `classification:${input.runtime}:${input.pluginId}:${input.resolverId}:${hashString(fingerprint)}`;
}

export function isClassificationResolverCachedEntryFresh(
	entry: ClassificationResolverCachedEntry,
	now = Date.now()
): boolean {
	const cachedAtMs = Date.parse(entry.cachedAt);
	if (Number.isNaN(cachedAtMs)) {
		return false;
	}

	return cachedAtMs + entry.ttlMs > now;
}

export function isClassificationResolverCachedEntry(
	value: unknown
): value is ClassificationResolverCachedEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const entry = value as Partial<ClassificationResolverCachedEntry>;
	return (
		Array.isArray(entry.atoms) &&
		typeof entry.fallbackUsed === 'boolean' &&
		typeof entry.cachedAt === 'string' &&
		typeof entry.ttlMs === 'number'
	);
}

async function callUpstashCommand(params: {
	baseUrl: string;
	fetcher: typeof fetch;
	command: string;
	args: string[];
	query?: Record<string, string>;
	headers: Record<string, string>;
	httpTimeoutMs: number;
}): Promise<{ result?: unknown }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), params.httpTimeoutMs);

	try {
		const response = await params.fetcher(
			buildUpstashCommandUrl(params.baseUrl, params.command, params.args, params.query),
			{
				method: 'POST',
				headers: params.headers,
				signal: controller.signal,
			}
		);

		const payload = (await response.json()) as { error?: string; result?: unknown };
		if (!response.ok) {
			throw new Error(payload.error ?? `Upstash cache command failed (${response.status})`);
		}

		if (payload.error) {
			throw new Error(payload.error);
		}

		return payload;
	} finally {
		clearTimeout(timeout);
	}
}

function buildUpstashCommandUrl(
	baseUrl: string,
	command: string,
	args: string[],
	query?: Record<string, string>
): string {
	const encodedArgs = args.map((value) => encodeURIComponent(value)).join('/');
	const search = query ? new URLSearchParams(query).toString() : '';
	return `${baseUrl}/${command}${encodedArgs ? `/${encodedArgs}` : ''}${search ? `?${search}` : ''}`;
}

function normalizePluginIds(pluginIds: string[] | undefined): string[] {
	if (!pluginIds || pluginIds.length === 0) {
		return [];
	}

	return Array.from(new Set(pluginIds)).sort((left, right) => left.localeCompare(right));
}

function stableStringify(value: unknown): string {
	if (value === null || value === undefined) {
		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	}

	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

		return `{${entries.join(',')}}`;
	}

	return JSON.stringify(value);
}

function hashString(value: string): string {
	let hash = 5381;
	for (let index = 0; index < value.length; index += 1) {
		hash = (hash * 33) ^ value.charCodeAt(index);
	}

	return (hash >>> 0).toString(16);
}

function cloneCachedEntry(
	entry: ClassificationResolverCachedEntry
): ClassificationResolverCachedEntry {
	return {
		atoms: entry.atoms.map((atom) => cloneAtom(atom)),
		fallbackUsed: entry.fallbackUsed,
		metadata: entry.metadata ? cloneMetadata(entry.metadata) : undefined,
		cachedAt: entry.cachedAt,
		ttlMs: entry.ttlMs,
	};
}

function cloneAtom(atom: ClassificationResolvedAtom): ClassificationResolvedAtom {
	if (typeof structuredClone === 'function') {
		return structuredClone(atom);
	}

	return JSON.parse(JSON.stringify(atom)) as ClassificationResolvedAtom;
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
	if (typeof structuredClone === 'function') {
		return structuredClone(metadata);
	}

	return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
}

function evictLeastRecentlyUsed(storage: Map<string, StoredEntry>): void {
	let oldestKey: string | undefined;
	let oldestAccess = Number.POSITIVE_INFINITY;

	for (const [key, value] of storage.entries()) {
		if (value.lastAccessedAt < oldestAccess) {
			oldestAccess = value.lastAccessedAt;
			oldestKey = key;
		}
	}

	if (oldestKey) {
		storage.delete(oldestKey);
	}
}
