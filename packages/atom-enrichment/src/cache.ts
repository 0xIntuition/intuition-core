import type { EnrichmentArtifact } from './types';

export interface CacheAdapter {
	get(key: string): Promise<CachedEntry | null>;
	set(key: string, entry: CachedEntry, ttlMs: number): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface CachedEntry {
	artifacts: EnrichmentArtifact[];
	cachedAt: string;
	ttlMs: number;
}

type CreateMemoryCacheAdapterOptions = {
	maxEntries?: number;
	now?: () => number;
};

type StoredEntry = {
	entry: CachedEntry;
	expiresAt: number;
	lastAccessedAt: number;
};

type CreateUpstashCacheAdapterOptions = {
	baseUrl: string;
	token: string;
	fetcher?: typeof fetch;
	httpTimeoutMs?: number;
};

type CreateUpstashCacheAdapterFromEnvOptions = {
	env?: Record<string, string | undefined>;
	fetcher?: typeof fetch;
	httpTimeoutMs?: number;
};

const DEFAULT_UPSTASH_HTTP_TIMEOUT_MS = 1_500;

export function createMemoryCacheAdapter(
	options: CreateMemoryCacheAdapterOptions = {}
): CacheAdapter {
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

export function createUpstashCacheAdapterFromEnv(
	options: CreateUpstashCacheAdapterFromEnvOptions = {}
): CacheAdapter | undefined {
	const env = options.env ?? process.env;
	const baseUrl = env.UPSTASH_REDIS_REST_URL?.trim();
	const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

	if (!baseUrl || !token) {
		return undefined;
	}

	return createUpstashCacheAdapter({
		baseUrl,
		token,
		fetcher: options.fetcher,
		httpTimeoutMs: options.httpTimeoutMs,
	});
}

export function createUpstashCacheAdapter(options: CreateUpstashCacheAdapterOptions): CacheAdapter {
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
				const parsed = JSON.parse(result) as CachedEntry;
				return isCachedEntry(parsed) ? parsed : null;
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

export function buildCacheKey(
	pluginId: string,
	input: {
		atomType: string;
		hints?: {
			url?: string;
			name?: string;
			description?: string;
			identifiers?: Record<string, string>;
			locale?: string;
		};
		jsonLd?: Record<string, unknown>;
	}
): string {
	const normalizedIdentifiers = normalizeIdentifiers(input.hints?.identifiers);
	const normalizedName = normalizeName(
		input.hints?.name ?? (typeof input.jsonLd?.name === 'string' ? input.jsonLd.name : undefined)
	);
	const normalizedDescription = normalizeDescription(
		input.hints?.description ??
			(typeof input.jsonLd?.description === 'string' ? input.jsonLd.description : undefined)
	);
	const normalizedUrl = normalizeUrl(
		input.hints?.url ?? (typeof input.jsonLd?.url === 'string' ? input.jsonLd.url : undefined)
	);
	const normalizedLocale = normalizeLocale(
		input.hints?.locale ??
			(typeof input.jsonLd?.inLanguage === 'string' ? input.jsonLd.inLanguage : undefined)
	);
	const normalizedJsonLd = normalizeStructuredValue(input.jsonLd ?? {});

	const fingerprint = stableStringify({
		atomType: input.atomType,
		hints: {
			name: normalizedName,
			description: normalizedDescription,
			url: normalizedUrl,
			identifiers: normalizedIdentifiers,
			locale: normalizedLocale,
		},
		jsonLd: normalizedJsonLd,
	});

	return `enrichment:${normalizePluginId(pluginId)}:${hashString(fingerprint)}`;
}

export function isCachedEntryFresh(entry: CachedEntry, now = Date.now()): boolean {
	const cachedAtMs = Date.parse(entry.cachedAt);
	if (Number.isNaN(cachedAtMs)) {
		return false;
	}

	return cachedAtMs + entry.ttlMs > now;
}

function normalizeUrl(value: string | undefined): string {
	if (!value) {
		return '';
	}

	const trimmed = value.trim().toLowerCase();
	return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

function normalizeName(value: string | undefined): string {
	if (!value) {
		return '';
	}

	return value.trim().toLowerCase();
}

function normalizeDescription(value: string | undefined): string {
	if (!value) {
		return '';
	}

	return value.trim().toLowerCase();
}

function normalizeLocale(value: string | undefined): string {
	if (!value) {
		return '';
	}

	return value.trim().toLowerCase();
}

function normalizeIdentifiers(value: Record<string, string> | undefined): Record<string, string> {
	if (!value) {
		return {};
	}

	const sortedKeys = Object.keys(value).sort((left, right) => left.localeCompare(right));
	const normalized: Record<string, string> = {};

	for (const key of sortedKeys) {
		normalized[key] = (value[key] ?? '').trim();
	}

	return normalized;
}

function normalizeStructuredValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeStructuredValue(item));
	}

	if (value && typeof value === 'object') {
		const normalizedObject: Record<string, unknown> = {};
		const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right)
		);

		for (const [key, nestedValue] of sortedEntries) {
			if (nestedValue === undefined) {
				continue;
			}

			normalizedObject[key] = normalizeStructuredValue(nestedValue);
		}

		return normalizedObject;
	}

	if (typeof value === 'string') {
		return value.trim();
	}

	return value;
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

function cloneCachedEntry(entry: CachedEntry): CachedEntry {
	return {
		artifacts: entry.artifacts.map((artifact) => ({
			artifact_type: artifact.artifact_type,
			data: { ...artifact.data },
			meta: { ...artifact.meta },
		})),
		cachedAt: entry.cachedAt,
		ttlMs: entry.ttlMs,
	};
}

function normalizePluginId(pluginId: string): string {
	const normalized = pluginId.trim().toLowerCase();
	return normalized.length > 0 ? normalized : 'unknown';
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

function isCachedEntry(value: unknown): value is CachedEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const entry = value as Partial<CachedEntry>;
	return (
		Array.isArray(entry.artifacts) &&
		typeof entry.cachedAt === 'string' &&
		typeof entry.ttlMs === 'number'
	);
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
