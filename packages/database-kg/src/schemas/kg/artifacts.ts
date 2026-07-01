import { relations } from 'drizzle-orm';
import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { nodes } from './nodes';
import { kgSchema } from './schema';

export const artifacts = kgSchema.table(
	'artifacts',
	{
		id: text('id').primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		nodeId: text('node_id')
			.notNull()
			.references(() => nodes.id),
		artifactKind: text('artifact_kind').notNull(),
		artifactVersion: text('artifact_version').notNull(),
		status: text('status').notNull(),
		sourceUri: text('source_uri'),
		sourceHash: text('source_hash'),
		data: jsonb('data').notNull().default({}),
		extracted: jsonb('extracted').notNull().default({}),
		error: jsonb('error'),
		createdByAccountId: text('created_by_account_id').references(() => accounts.id),
	},
	(t) => [
		index('idx_artifacts_node_id').on(t.nodeId),
		index('idx_artifacts_created_by_account_id').on(t.createdByAccountId),
		index('idx_artifacts_kind_version_status').on(t.artifactKind, t.artifactVersion, t.status),
		index('idx_artifacts_kind_source_hash').on(t.artifactKind, t.sourceHash),
	]
);

export const artifactsRelations = relations(artifacts, ({ one }) => ({
	node: one(nodes, { fields: [artifacts.nodeId], references: [nodes.id] }),
	createdByAccount: one(accounts, {
		fields: [artifacts.createdByAccountId],
		references: [accounts.id],
	}),
}));
