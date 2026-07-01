import { relations, sql } from 'drizzle-orm';
import {
	boolean,
	check,
	index,
	jsonb,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from 'drizzle-orm/pg-core';

import { artifacts } from './artifacts';
import { nodes } from './nodes';
import { kgSchema } from './schema';

export const nodeUrls = kgSchema.table(
	'node_urls',
	{
		nodeId: text('node_id')
			.notNull()
			.references(() => nodes.id, { onDelete: 'cascade' }),
		url: text('url').notNull(),
		// Pre-computed eTLD+1 domain — denormalized at write time so that the
		// domain-diversity re-ranker can perform index-only scans without
		// calling a parsing function per row at query time.
		domain: text('domain').notNull(),
		// Optional provenance label (e.g. "opengraph", "canonical", "wikidata").
		source: text('source'),
		// FK to the artifact that produced this URL entry, if any.
		artifactId: text('artifact_id').references(() => artifacts.id, { onDelete: 'set null' }),
		// At most one URL per node may be is_primary=true. Enforced by the
		// idx_node_urls_one_primary_per_node partial unique index below.
		isPrimary: boolean('is_primary').notNull().default(false),
		metadata: jsonb('metadata').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		// Composite primary key (node_id, url): a node may not have the same URL
		// twice but may have many different URLs. Declared via Drizzle so the ORM
		// recognizes it for `.onConflictDoUpdate({ target: [...] })` upserts.
		primaryKey({ columns: [t.nodeId, t.url], name: 'node_urls_pkey' }),
		index('idx_node_urls_node_domain').on(t.nodeId, t.domain),
		index('idx_node_urls_domain').on(t.domain),
		// Partial unique index: only rows where is_primary = true are indexed,
		// so non-primary rows incur zero storage or write overhead.
		uniqueIndex('idx_node_urls_one_primary_per_node')
			.on(t.nodeId)
			.where(sql`${t.isPrimary} = true`),
		// Reject empty strings: an empty url or domain is semantically invalid
		// and would silently break the domain-diversity re-ranker.
		check('chk_node_urls_url_nonempty', sql`${t.url} <> ''`),
		check('chk_node_urls_domain_nonempty', sql`${t.domain} <> ''`),
	]
);

export const nodeUrlsRelations = relations(nodeUrls, ({ one }) => ({
	node: one(nodes, {
		fields: [nodeUrls.nodeId],
		references: [nodes.id],
	}),
	artifact: one(artifacts, {
		fields: [nodeUrls.artifactId],
		references: [artifacts.id],
	}),
}));
