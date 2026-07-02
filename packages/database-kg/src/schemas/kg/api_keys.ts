import { relations } from 'drizzle-orm';
import { boolean, index, integer, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { kgSchema } from './schema';

/**
 * kg.api_keys — lightweight infrastructure auth for the query API.
 *
 * Each key is bound to a KG account (wallet address): writes made with the key
 * are attributed to that account via `created_by` on nodes/triples. Only the
 * SHA-256 hash of the key is stored — the plaintext (`ik_…`) is shown once at
 * mint time and never persisted.
 *
 * This is operator-managed service auth (mint via `bun run keys:create`), not
 * a user-authentication system: no sessions, no OAuth, no billing.
 */
export const apiKeys = kgSchema.table(
	'api_keys',
	{
		id: text('id').primaryKey(),
		/** SHA-256 hex digest of the plaintext key. */
		keyHash: text('key_hash').notNull(),
		/** Human label, e.g. "partner-acme" — for auditing and revocation. */
		name: text('name').notNull(),
		/** The KG account (wallet) this key acts as; creator attribution target. */
		accountId: text('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		canWrite: boolean('can_write').notNull().default(true),
		/**
		 * Per-key requests-per-minute override. NULL → the API's global
		 * `API_RATE_LIMIT_RPM` default applies; 0 → unlimited for this key.
		 */
		rateLimitRpm: integer('rate_limit_rpm'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
	},
	(t) => [
		uniqueIndex('idx_api_keys_key_hash').on(t.keyHash),
		index('idx_api_keys_account_id').on(t.accountId),
	]
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
	account: one(accounts, {
		fields: [apiKeys.accountId],
		references: [accounts.id],
	}),
}));
