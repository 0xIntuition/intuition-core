import { relations, sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	jsonb,
	numeric,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

import type { KgRefType } from './refs';
import { kgSchema } from './schema';

export const predicates = kgSchema.table('predicates', {
	id: text('id').primaryKey(),
	slug: text('slug').notNull().unique(),
	label: text('label').notNull(),
	description: text('description'),
	inversePredicateId: text('inverse_predicate_id'),
	isTransitive: boolean('is_transitive').notNull().default(false),
	isSymmetric: boolean('is_symmetric').notNull().default(false),
	isHierarchical: boolean('is_hierarchical').notNull().default(false),
	isSocial: boolean('is_social').notNull().default(false),
	isMarket: boolean('is_market').notNull().default(false),
	metadata: jsonb('metadata').notNull().default({}),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const predicatesRelations = relations(predicates, ({ one }) => ({
	inversePredicate: one(predicates, {
		fields: [predicates.inversePredicateId],
		references: [predicates.id],
	}),
}));

export const predicateStats = kgSchema.table(
	'predicate_stats',
	{
		predicateId: text('predicate_id').notNull(),
		predicateType: text('predicate_type').$type<KgRefType>().notNull().default('node'),
		tripleCount: bigint('triple_count', { mode: 'bigint' }).notNull(),
		distinctSubjectCount: bigint('distinct_subject_count', { mode: 'bigint' }).notNull(),
		distinctObjectCount: bigint('distinct_object_count', { mode: 'bigint' }).notNull(),
		avgOutDegree: numeric('avg_out_degree'),
		avgInDegree: numeric('avg_in_degree'),
		selectivityScore: numeric('selectivity_score'),
		updatedAt: timestamp('updated_at', { withTimezone: true }),
	},
	(t) => [
		primaryKey({
			columns: [t.predicateType, t.predicateId],
			name: 'predicate_stats_pkey',
		}),
		check('chk_predicate_stats_predicate_type', sql`${t.predicateType} IN ('node', 'triple')`),
	]
);
