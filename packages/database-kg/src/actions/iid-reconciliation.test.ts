import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';

import { listIidReconciliationCandidates } from './iid-reconciliation';
import type { KgActionDb } from './types';

describe('IID reconciliation candidate reads', () => {
	test('uses a stable ID cursor and bounded IID-or-prefix selection', async () => {
		let whereSql: { getSQL(): unknown } | undefined;
		let orderSql: { getSQL(): unknown } | undefined;
		let limitValue: number | undefined;
		const db = {
			select() {
				return {
					from() {
						return {
							where(value: { getSQL(): unknown }) {
								whereSql = value;
								return {
									orderBy(order: { getSQL(): unknown }) {
										orderSql = order;
										return {
											limit(limit: number) {
												limitValue = limit;
												return Promise.resolve([]);
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

		await listIidReconciliationCandidates(db, { limit: 100, after: '0xabc' });
		const dialect = new PgDialect();
		const predicate = dialect.sqlToQuery(whereSql?.getSQL() as never);
		expect(predicate.sql).toContain('"kg"."nodes"."iid" is not null');
		expect(predicate.sql).toContain('"kg"."nodes"."data" ilike $1');
		expect(predicate.sql).toContain('"kg"."nodes"."id" > $2');
		expect(predicate.params).toEqual(['int:%', '0xabc']);
		expect(dialect.sqlToQuery(orderSql?.getSQL() as never).sql).toBe('"kg"."nodes"."id" asc');
		expect(limitValue).toBe(100);
	});

	test('rejects unbounded pages', async () => {
		await expect(
			listIidReconciliationCandidates({} as KgActionDb, { limit: 1_001 })
		).rejects.toThrow('between 1 and 1000');
	});
});
