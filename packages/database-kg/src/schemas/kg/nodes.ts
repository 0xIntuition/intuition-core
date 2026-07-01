import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
	integer,
	jsonb,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import { kgSchema } from './schema';

export const nodes = kgSchema.table(
	'nodes',
	{
		id: text('id').primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		isOnchain: boolean('is_onchain').notNull().default(false),
		status: text('status').notNull().default('active'), // Draft means nodes can't be added to triples, stacks, posts, etc...
		visibility: text('visibility').notNull().default('public'), // Unlisted means it's been flagged by the moderators.
		createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
		rawType: text('raw_type').notNull(), // string | json | json-ld | http_uri | ipfs_uri
		data: text('data'),
		dataHex: text('data_hex'),
		dataResolved: jsonb('data_resolved').notNull().default({}),
		// Parsing - first worker stage for raw node data
		parseAttempts: integer('parse_attempts').notNull().default(0),
		parseStatus: text('parse_status').notNull().default('pending'),
		parseStartedAt: timestamp('parse_started_at', { withTimezone: true }),
		parseLeaseExpiresAt: timestamp('parse_lease_expires_at', { withTimezone: true }),
		parsedAt: timestamp('parsed_at', { withTimezone: true }),
		parseError: jsonb('parse_error'),
		parseResult: jsonb('parse_result'),
		// Classification - second worker stage for parsed node data
		classificationAttempts: integer('classification_attempts').notNull().default(0),
		classificationStatus: text('classification_status').notNull().default('pending'),
		classificationStartedAt: timestamp('classification_started_at', { withTimezone: true }),
		classificationLeaseExpiresAt: timestamp('classification_lease_expires_at', {
			withTimezone: true,
		}),
		classifiedAt: timestamp('classified_at', { withTimezone: true }),
		classificationError: jsonb('classification_error'),
		classificationResult: jsonb('classification_result'),
		// Defaults to 'Unknown' so any insert path that pre-dates classification
		// (e.g. ensureNode before the classification worker has run) does not
		// fail the NOT NULL constraint. The classification stage overwrites this
		// once it has a real value.
		classificationType: text('classification_type').notNull().default('Unknown'), // Unknown, Thing, Stack, Person, etc...
		// Enrichment - third worker stage for classified node data
		enrichmentAttempts: integer('enrichment_attempts').notNull().default(0),
		enrichmentStatus: text('enrichment_status').notNull().default('pending'),
		enrichmentStartedAt: timestamp('enrichment_started_at', { withTimezone: true }),
		enrichmentLeaseExpiresAt: timestamp('enrichment_lease_expires_at', { withTimezone: true }),
		enrichedAt: timestamp('enriched_at', { withTimezone: true }),
		enrichmentError: jsonb('enrichment_error'),
		processingMeta: jsonb('processing_meta').notNull().default({}),
		// Search - handled when node is parsed and classified
		searchText: text('search_text').notNull().default(''),
	},
	(t) => [
		index('idx_nodes_status_visibility_created_at').on(t.status, t.visibility, t.createdAt),
		index('idx_nodes_visibility').on(t.visibility),
		index('idx_nodes_raw_type_data_hex').on(t.rawType, t.dataHex),
		index('idx_nodes_classification_type').on(t.classificationType),
		index('idx_nodes_created_by_created_at').on(t.createdBy, t.createdAt),
		index('idx_nodes_data_hex').on(t.dataHex),
		index('idx_nodes_parse_recovery').on(t.parseStatus, t.parseLeaseExpiresAt, t.createdAt),
		index('idx_nodes_classification_recovery').on(
			t.classificationStatus,
			t.classificationLeaseExpiresAt,
			t.createdAt
		),
		index('idx_nodes_enrichment_recovery').on(
			t.enrichmentStatus,
			t.enrichmentLeaseExpiresAt,
			t.createdAt
		),
		index('idx_nodes_processing_statuses').on(
			t.parseStatus,
			t.classificationStatus,
			t.enrichmentStatus
		),
		check('chk_nodes_visibility', sql`${t.visibility} IN ('public', 'unlisted')`),
		check('chk_nodes_status', sql`${t.status} IN ('active', 'draft')`),
		check('chk_nodes_raw_type', sql`${t.rawType} IN ('string', 'json', 'http_uri', 'ipfs_uri')`),
		check(
			'chk_nodes_parse_status',
			sql`${t.parseStatus} IN ('pending', 'processing', 'completed', 'failed', 'skipped')`
		),
		check(
			'chk_nodes_classification_status',
			sql`${t.classificationStatus} IN ('pending', 'processing', 'completed', 'failed', 'skipped')`
		),
		check(
			'chk_nodes_enrichment_status',
			sql`${t.enrichmentStatus} IN ('pending', 'processing', 'completed', 'failed', 'skipped')`
		),
	]
);

export const nodesRelations = relations(nodes, ({ one }) => ({
	createdByAccount: one(accounts, {
		fields: [nodes.createdBy],
		references: [accounts.id],
	}),
}));

export const nodeStats = kgSchema.table('node_stats', {
	nodeId: text('node_id')
		.primaryKey()
		.references(() => nodes.id),
	inDegree: bigint('in_degree', { mode: 'bigint' }).notNull(),
	outDegree: bigint('out_degree', { mode: 'bigint' }).notNull(),
	neighborKindCounts: jsonb('neighbor_kind_counts').notNull().default({}),
	predicateCounts: jsonb('predicate_counts').notNull().default({}),
	updatedAt: timestamp('updated_at', { withTimezone: true }),
});

export const nodeStatsRelations = relations(nodeStats, ({ one }) => ({
	node: one(nodes, { fields: [nodeStats.nodeId], references: [nodes.id] }),
}));
