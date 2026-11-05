import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	check,
	index,
	integer,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';

import { nodes } from './nodes';
import { kgSchema } from './schema';

/**
 * Immutable, on-chain context bytes registered for an atom.
 *
 * URI values remain opaque here: `uri_hex` is the canonical byte-preserving
 * representation and `uri_text` is only a best-effort UTF-8 rendering. Neither
 * this table nor its writer fetches, normalizes, or assigns trust to a URI.
 */
export const nodeContexts = kgSchema.table(
	'node_contexts',
	{
		nodeId: text('node_id')
			.notNull()
			.references(() => nodes.id),
		eventSequence: bigint('event_sequence', { mode: 'bigint' }).notNull(),
		blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
		blockTimestamp: timestamp('block_timestamp', { withTimezone: true }).notNull(),
		blockHash: text('block_hash').notNull(),
		transactionHash: text('transaction_hash').notNull(),
		logIndex: integer('log_index').notNull(),
		ordinal: integer('ordinal').notNull(),
		registrant: text('registrant').notNull(),
		uriHex: text('uri_hex').notNull(),
		uriText: text('uri_text'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({
			columns: [t.nodeId, t.transactionHash, t.logIndex, t.ordinal],
			name: 'node_contexts_pkey',
		}),
		uniqueIndex('idx_node_contexts_event_ordinal').on(t.eventSequence, t.ordinal),
		index('idx_node_contexts_node_sequence').on(t.nodeId, t.eventSequence, t.ordinal),
		index('idx_node_contexts_transaction').on(t.transactionHash, t.logIndex),
		check('chk_node_contexts_event_sequence', sql`${t.eventSequence} >= 0`),
		check('chk_node_contexts_block_number', sql`${t.blockNumber} >= 0`),
		check('chk_node_contexts_log_index', sql`${t.logIndex} >= 0`),
		check('chk_node_contexts_ordinal', sql`${t.ordinal} >= 0`),
		check('chk_node_contexts_uri_hex', sql`${t.uriHex} ~ '^0x([0-9a-f]{2})*$'`),
	]
);

export const nodeContextsRelations = relations(nodeContexts, ({ one }) => ({
	node: one(nodes, {
		fields: [nodeContexts.nodeId],
		references: [nodes.id],
	}),
}));
