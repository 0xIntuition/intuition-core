import { relations, sql } from 'drizzle-orm';
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	index,
	jsonb,
	numeric,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

import { accounts } from './accounts';
import type { KgRefType } from './refs';
import { kgSchema } from './schema';

export const triples = kgSchema.table(
	'triples',
	{
		id: text('id').primaryKey(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
		isOnchain: boolean('is_onchain').notNull().default(false),
		status: text('status').notNull().default('active'), // Draft means nodes can't be added to triples, stacks, posts, etc...
		visibility: text('visibility').notNull().default('public'), // Unlisted means it's been flagged by the moderators.
		createdBy: text('created_by').references(() => accounts.id, { onDelete: 'set null' }),
		subjectId: text('subject_id').notNull(),
		subjectType: text('subject_type').$type<KgRefType>().notNull().default('node'),
		predicateId: text('predicate_id').notNull(),
		predicateType: text('predicate_type').$type<KgRefType>().notNull().default('node'),
		objectId: text('object_id').notNull(),
		objectType: text('object_type').$type<KgRefType>().notNull().default('node'),
		isCounterTriple: boolean('is_counter_triple').notNull().default(false),
		siblingTripleId: text('sibling_triple_id').references((): AnyPgColumn => triples.id, {
			onDelete: 'set null',
		}),
		edgeKind: text('edge_kind').notNull().default('claim'),
		source: text('source'),
		sourceUri: text('source_uri'),
		confidence: numeric('confidence', { precision: 6, scale: 5 }),
		inferred: boolean('inferred').notNull().default(false),
		provenance: jsonb('provenance').notNull().default({}),
		metadata: jsonb('metadata').notNull().default({}),
	},
	(t) => [
		index('idx_triples_spo').on(
			t.subjectType,
			t.subjectId,
			t.predicateType,
			t.predicateId,
			t.objectType,
			t.objectId
		),
		index('idx_triples_sop').on(
			t.subjectType,
			t.subjectId,
			t.objectType,
			t.objectId,
			t.predicateType,
			t.predicateId
		),
		index('idx_triples_pso').on(
			t.predicateType,
			t.predicateId,
			t.subjectType,
			t.subjectId,
			t.objectType,
			t.objectId
		),
		index('idx_triples_pos').on(
			t.predicateType,
			t.predicateId,
			t.objectType,
			t.objectId,
			t.subjectType,
			t.subjectId
		),
		index('idx_triples_osp').on(
			t.objectType,
			t.objectId,
			t.subjectType,
			t.subjectId,
			t.predicateType,
			t.predicateId
		),
		index('idx_triples_ops').on(
			t.objectType,
			t.objectId,
			t.predicateType,
			t.predicateId,
			t.subjectType,
			t.subjectId
		),
		index('idx_triples_subject_ref').on(t.subjectType, t.subjectId),
		index('idx_triples_predicate_ref').on(t.predicateType, t.predicateId),
		index('idx_triples_object_ref').on(t.objectType, t.objectId),
		index('idx_triples_status_visibility_created_at').on(t.status, t.visibility, t.createdAt),
		index('idx_triples_sibling_triple_id').on(t.siblingTripleId),
		index('idx_triples_counter_triple').on(t.isCounterTriple),
		index('idx_triples_created_by_created_at').on(t.createdBy, t.createdAt),
		index('idx_triples_edge_kind_status_created_at').on(t.edgeKind, t.status, t.createdAt),
		index('idx_triples_source_uri').on(t.sourceUri),
		index('idx_triples_confidence_desc').on(t.confidence),
		check('chk_triples_visibility', sql`${t.visibility} IN ('public', 'unlisted')`),
		check('chk_triples_status', sql`${t.status} IN ('active', 'draft')`),
		check('chk_triples_subject_type', sql`${t.subjectType} IN ('node', 'triple')`),
		check('chk_triples_predicate_type', sql`${t.predicateType} IN ('node', 'triple')`),
		check('chk_triples_object_type', sql`${t.objectType} IN ('node', 'triple')`),
		check(
			'chk_triples_counter_sibling_required',
			sql`${t.isCounterTriple} = false OR ${t.siblingTripleId} IS NOT NULL`
		),
		check(
			'chk_triples_sibling_not_self',
			sql`${t.siblingTripleId} IS NULL OR ${t.siblingTripleId} <> ${t.id}`
		),
		check(
			'chk_triples_confidence_range',
			sql`${t.confidence} IS NULL OR (${t.confidence} >= 0 AND ${t.confidence} <= 1)`
		),
	]
);

export const triplesRelations = relations(triples, ({ one }) => ({
	siblingTriple: one(triples, {
		fields: [triples.siblingTripleId],
		references: [triples.id],
		relationName: 'tripleSibling',
	}),
	createdByAccount: one(accounts, {
		fields: [triples.createdBy],
		references: [accounts.id],
	}),
}));

export const triplePatternStats = kgSchema.table(
	'triple_pattern_stats',
	{
		subjectKind: text('subject_kind').notNull(),
		predicateId: text('predicate_id').notNull(),
		predicateType: text('predicate_type').$type<KgRefType>().notNull().default('node'),
		objectKind: text('object_kind').notNull(),
		tripleCount: bigint('triple_count', { mode: 'bigint' }).notNull(),
		distinctSubjectCount: bigint('distinct_subject_count', { mode: 'bigint' }).notNull(),
		distinctObjectCount: bigint('distinct_object_count', { mode: 'bigint' }).notNull(),
		selectivityScore: numeric('selectivity_score'),
		updatedAt: timestamp('updated_at', { withTimezone: true }),
	},
	(t) => [
		primaryKey({
			columns: [t.subjectKind, t.predicateType, t.predicateId, t.objectKind],
			name: 'triple_pattern_stats_pkey',
		}),
		check('chk_triple_pattern_stats_predicate_type', sql`${t.predicateType} IN ('node', 'triple')`),
	]
);
