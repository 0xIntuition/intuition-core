/**
 * Fixed-window, in-memory rate limiting for the query API.
 *
 * Keyed by API-key id when a key is presented, otherwise by client IP. The
 * per-request limit resolves as: the key's own `rateLimitRpm` override when
 * set → otherwise the global `API_RATE_LIMIT_RPM` default. A limit of 0 means
 * unlimited (either globally or per key).
 *
 * In-memory state is per-process — correct for the single-instance compose
 * deployment. Fronting multiple replicas needs a shared store (Redis) instead;
 * the interface here is deliberately small to make that swap easy.
 */

export type RateLimitDecision = {
	allowed: boolean;
	limit: number;
	remaining: number;
	resetAtMs: number;
	retryAfterSeconds: number;
};

type WindowEntry = {
	count: number;
	resetAtMs: number;
};

const WINDOW_MS = 60_000;
/** Prune expired windows once the map grows past this many entries. */
const PRUNE_THRESHOLD = 10_000;

export function createRateLimiter(now: () => number = Date.now) {
	const windows = new Map<string, WindowEntry>();

	function prune(nowMs: number): void {
		if (windows.size < PRUNE_THRESHOLD) {
			return;
		}
		for (const [key, entry] of windows) {
			if (entry.resetAtMs <= nowMs) {
				windows.delete(key);
			}
		}
	}

	function check(key: string, limit: number): RateLimitDecision {
		const nowMs = now();

		if (limit <= 0) {
			return { allowed: true, limit: 0, remaining: 0, resetAtMs: 0, retryAfterSeconds: 0 };
		}

		prune(nowMs);

		let entry = windows.get(key);
		if (!entry || entry.resetAtMs <= nowMs) {
			entry = { count: 0, resetAtMs: nowMs + WINDOW_MS };
			windows.set(key, entry);
		}

		entry.count += 1;
		const allowed = entry.count <= limit;
		return {
			allowed,
			limit,
			remaining: Math.max(0, limit - entry.count),
			resetAtMs: entry.resetAtMs,
			retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAtMs - nowMs) / 1_000)),
		};
	}

	return { check };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
