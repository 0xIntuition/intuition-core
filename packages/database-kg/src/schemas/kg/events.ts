import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	index,
	jsonb,
	primaryKey,
	text,
	timestamp,
} from 'drizzle-orm/pg-core';

import { kgSchema } from './schema';

// ---------------------------------------------------------------------------
// kg.events — TimescaleDB hypertable
//
// Append-only event log for graph mutation events (node, triple, predicate,
// artifact creations). Drives Phase 3+ recency-of-creation signals and the
// kg.events_hourly continuous aggregate.
// ---------------------------------------------------------------------------
export const kgEvents = kgSchema.table(
	'events',
	{
		eventTime: timestamp('event_time', { withTimezone: true }).notNull(),
		id: text('id').notNull(),
		actorId: text('actor_id'),
		entityKind: text('entity_kind').notNull(),
		entityId: text('entity_id').notNull(),
		eventType: text('event_type').notNull(),
		classificationType: text('classification_type'),
		isOnchain: boolean('is_onchain').notNull().default(false),
		blockNumber: bigint('block_number', { mode: 'bigint' }),
		txHash: text('tx_hash'),
		payload: jsonb('payload').notNull().default({}),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.eventTime, t.id], name: 'kg_events_pkey' }),
		check(
			'chk_kg_events_entity_kind',
			sql`${t.entityKind} IN ('node', 'triple', 'predicate', 'artifact')`
		),
		index('idx_kg_events_entity').on(t.entityKind, t.entityId, t.eventTime),
		index('idx_kg_events_actor').on(t.actorId, t.eventTime),
		index('idx_kg_events_type').on(t.eventType, t.eventTime),
	]
);
