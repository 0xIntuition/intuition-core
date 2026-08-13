import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { listNodeContexts, listPublicNodesByIid } from './nodes';
import type { KgActionDb } from './types';

type Capture = {
	selection?: Record<string, unknown>;
	where?: { getSQL(): unknown };
	orderBy?: Array<{ getSQL(): unknown }>;
	limit?: number;
	offset?: number;
};

function captureSelect(rows: unknown[] = []) {
	const capture: Capture = {};
	const db = {
		select(selection: Record<string, unknown>) {
			capture.selection = selection;
			return {
				from() {
					return {
						where(where: Capture['where']) {
							capture.where = where;
							return {
								orderBy(...orderBy: NonNullable<Capture['orderBy']>) {
									capture.orderBy = orderBy;
									return {
										limit(limit: number) {
											capture.limit = limit;
											return {
												offset(offset: number) {
													capture.offset = offset;
													return {
														async execute() {
															return rows;
														},
													};
												},
											};
										},
										async execute() {
											return rows;
										},
									};
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	return { capture, db };
}

function sqlOf(fragment: { getSQL(): unknown } | undefined) {
	if (!fragment) throw new Error('missing captured SQL fragment');
	return new PgDialect().sqlToQuery(fragment.getSQL() as never);
}

describe('semantic atom reader query shapes', () => {
	test('reads context by node and orders by event sequence then ordinal', async () => {
		const { capture, db } = captureSelect();
		await listNodeContexts(db, '0xatom');

		expect(sqlOf(capture.where)).toMatchObject({
			sql: '"kg"."node_contexts"."node_id" = $1',
			params: ['0xatom'],
		});
		expect(capture.orderBy?.map((entry) => sqlOf(entry).sql)).toEqual([
			'"kg"."node_contexts"."event_sequence" asc',
			'"kg"."node_contexts"."ordinal" asc',
		]);
	});

	test('uses exact IID equality with public filters and bounded pagination', async () => {
		const { capture, db } = captureSelect();
		await listPublicNodesByIid(db, 'int:isrc:USQX91300108', { limit: 25, offset: 50 });

		const predicate = sqlOf(capture.where);
		expect(predicate.sql).toBe(
			'("kg"."nodes"."iid" = $1 and "kg"."nodes"."status" = $2 and "kg"."nodes"."visibility" = $3)'
		);
		expect(predicate.params).toEqual(['int:isrc:USQX91300108', 'active', 'public']);
		expect(capture.limit).toBe(25);
		expect(capture.offset).toBe(50);
		expect(Object.keys(capture.selection ?? {})).not.toContain('context');
	});
});
