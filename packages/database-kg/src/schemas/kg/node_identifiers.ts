import { sql } from 'drizzle-orm';
import { check, index, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { nodes } from './nodes';
import { kgSchema } from './schema';

/** Aliases supplied by the classification projection; never selects a primary. */
export const nodeIdentifiers = kgSchema.table(
	'node_identifiers',
	{
		nodeId: text('node_id')
			.notNull()
			.references(() => nodes.id, { onDelete: 'cascade' }),
		iid: text('iid').notNull(),
		scheme: text('scheme').notNull(),
		rung: text('rung').notNull(),
		source: text('source').notNull().default('rung'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.nodeId, t.iid], name: 'node_identifiers_pkey' }),
		index('idx_node_identifiers_iid').on(t.iid),
		check('chk_node_identifiers_source', sql`${t.source} IN ('rung')`),
	]
);
