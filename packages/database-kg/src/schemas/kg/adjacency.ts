import { relations, sql } from 'drizzle-orm';
import { check, index, numeric, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import type { KgRefType } from './refs';
import { kgSchema } from './schema';
import { triples } from './triples';

export const adjacency = kgSchema.table(
	'adjacency',
	{
		sourceId: text('source_id').notNull(),
		sourceType: text('source_type').$type<KgRefType>().notNull().default('node'),
		direction: text('direction').notNull(),
		predicateId: text('predicate_id').notNull(),
		predicateType: text('predicate_type').$type<KgRefType>().notNull().default('node'),
		neighborId: text('neighbor_id').notNull(),
		neighborType: text('neighbor_type').$type<KgRefType>().notNull().default('node'),
		tripleId: text('triple_id')
			.notNull()
			.references(() => triples.id),
		weight: numeric('weight'),
		marketWeight: numeric('market_weight'),
		socialWeight: numeric('social_weight'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({
			columns: [
				t.sourceId,
				t.sourceType,
				t.direction,
				t.predicateId,
				t.predicateType,
				t.neighborId,
				t.neighborType,
				t.tripleId,
			],
			name: 'adjacency_pkey',
		}),
		index('idx_adjacency_source_ref').on(t.sourceType, t.sourceId),
		index('idx_adjacency_predicate_ref').on(t.predicateType, t.predicateId),
		index('idx_adjacency_neighbor_ref').on(t.neighborType, t.neighborId),
		check('chk_adjacency_source_type', sql`${t.sourceType} IN ('node', 'triple')`),
		check('chk_adjacency_predicate_type', sql`${t.predicateType} IN ('node', 'triple')`),
		check('chk_adjacency_neighbor_type', sql`${t.neighborType} IN ('node', 'triple')`),
	]
);

export const adjacencyRelations = relations(adjacency, ({ one }) => ({
	triple: one(triples, { fields: [adjacency.tripleId], references: [triples.id] }),
}));
