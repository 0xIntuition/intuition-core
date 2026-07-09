export type ApiAuthMode = 'open' | 'public-read' | 'gated';

export type ApiConfig = {
	port: number;
	databaseKgUrl: string;
	/** Comma-separated allowed CORS origins; empty means allow all (dev). */
	allowedOrigins: string[];
	/**
	 * Endpoint gating:
	 * - `public-read` (default): GET endpoints are open; writes require an API key.
	 * - `gated`: every endpoint requires an API key.
	 * - `open`: nothing requires a key (local dev); writes are unattributed.
	 */
	authMode: ApiAuthMode;
	/**
	 * Default requests-per-minute per caller (API key, or IP for anonymous
	 * reads). 0 disables rate limiting. Keys can carry their own override.
	 */
	rateLimitRpm: number;
	/**
	 * Trust the x-forwarded-for header for anonymous rate-limit buckets. Only
	 * enable behind a reverse proxy that overwrites the header — otherwise
	 * clients can mint a fresh bucket per request and bypass limits entirely.
	 */
	trustProxy: boolean;
};

function parseAuthMode(raw: string | undefined): ApiAuthMode {
	const mode = (raw ?? 'public-read').trim().toLowerCase();
	if (mode === 'open' || mode === 'public-read' || mode === 'gated') {
		return mode;
	}
	throw new Error(`API_AUTH must be one of: open, public-read, gated (got "${raw}")`);
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
	const databaseKgUrl = env.DATABASE_KG_URL?.trim();
	if (!databaseKgUrl) {
		throw new Error('DATABASE_KG_URL must be set');
	}

	return {
		port: Number.parseInt(env.API_PORT ?? '3000', 10),
		databaseKgUrl,
		allowedOrigins: (env.API_ALLOWED_ORIGINS ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
		authMode: parseAuthMode(env.API_AUTH),
		rateLimitRpm: Number.parseInt(env.API_RATE_LIMIT_RPM ?? '120', 10),
		trustProxy: (env.API_TRUST_PROXY ?? '').trim() === '1',
	};
}
