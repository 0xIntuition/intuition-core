/**
 * API-key authentication for the query API.
 *
 * Operator-managed service keys (`ik_…`), minted with `bun run keys:create`.
 * Only the SHA-256 hash is stored (kg.api_keys); lookups hash the presented
 * bearer token, so a database read never reveals a usable key. Writes made
 * with a key are attributed to its bound KG account via `created_by`.
 *
 * This is deliberately NOT a user-auth system — no sessions, no OAuth, no
 * billing. Those stay in Intuition's private monorepo.
 */
import { apiKeys, type KgDb } from '@0xintuition/database-kg';
import { and, eq, isNull, sql } from 'drizzle-orm';

export type ApiKeyIdentity = {
	keyId: string;
	name: string;
	accountId: string;
	canWrite: boolean;
	/** Per-key rpm override; null → global default, 0 → unlimited. */
	rateLimitRpm: number | null;
};

export const API_KEY_PREFIX = 'ik_';

export async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export function bearerToken(authorizationHeader: string | undefined): string | null {
	if (!authorizationHeader?.startsWith('Bearer ')) {
		return null;
	}
	const token = authorizationHeader.slice('Bearer '.length).trim();
	return token.startsWith(API_KEY_PREFIX) ? token : null;
}

/** Resolve a presented key to its identity, or null when invalid/revoked. */
export async function resolveApiKey(db: KgDb, token: string): Promise<ApiKeyIdentity | null> {
	const keyHash = await sha256Hex(token);
	const [row] = await db
		.select({
			keyId: apiKeys.id,
			name: apiKeys.name,
			accountId: apiKeys.accountId,
			canWrite: apiKeys.canWrite,
			rateLimitRpm: apiKeys.rateLimitRpm,
		})
		.from(apiKeys)
		.where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
		.limit(1);

	if (!row) {
		return null;
	}

	// Best-effort usage stamp; never blocks the request.
	db.update(apiKeys)
		.set({ lastUsedAt: sql`now()` })
		.where(eq(apiKeys.id, row.keyId))
		.then(
			() => undefined,
			() => undefined
		);

	return row;
}
