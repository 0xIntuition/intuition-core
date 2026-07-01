import { relations, sql } from 'drizzle-orm';
import { bigint, index, text, timestamp } from 'drizzle-orm/pg-core';

import { kgSchema } from './schema';

export const accounts = kgSchema.table(
	'accounts',
	{
		// Wallet address is the canonical KG account identifier.
		id: text('id').primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp('deleted_at', { withTimezone: true }),
	},
	(t) => [
		index('idx_accounts_last_seen_at').on(t.lastSeenAt),
		index('idx_accounts_deleted_at').on(t.deletedAt),
	]
);

export const accountStats = kgSchema.table('account_stats', {
	accountId: text('account_id')
		.primaryKey()
		.references(() => accounts.id),
	createdNodeCount: bigint('created_node_count', { mode: 'bigint' }).notNull().default(sql`0`),
	createdTripleCount: bigint('created_triple_count', { mode: 'bigint' }).notNull().default(sql`0`),
	depositCount: bigint('deposit_count', { mode: 'bigint' }).notNull().default(sql`0`),
	withdrawalCount: bigint('withdrawal_count', { mode: 'bigint' }).notNull().default(sql`0`),
	lastDepositAt: timestamp('last_deposit_at', { withTimezone: true }),
	lastWithdrawalAt: timestamp('last_withdrawal_at', { withTimezone: true }),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accountsRelations = relations(accounts, ({ one }) => ({
	stats: one(accountStats, {
		fields: [accounts.id],
		references: [accountStats.accountId],
	}),
}));

export const accountStatsRelations = relations(accountStats, ({ one }) => ({
	account: one(accounts, {
		fields: [accountStats.accountId],
		references: [accounts.id],
	}),
}));
