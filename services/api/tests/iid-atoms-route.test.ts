import { expect, spyOn, test } from 'bun:test';
import * as database from '@0xintuition/database-kg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createApp } from '../src/app';

for (const encoded of [false, true]) {
	test(`typed IID route preserves all colons (${encoded ? 'encoded' : 'literal'})`, async () => {
		const iid = 'int:wd:film:Q188035';
		let predicate: { getSQL(): unknown } | undefined;
		const query = {
			from() {
				return query;
			},
			where(value: { getSQL(): unknown }) {
				predicate = value;
				return query;
			},
			orderBy() {
				return query;
			},
			limit() {
				return query;
			},
			offset() {
				return query;
			},
			async execute() {
				return [];
			},
		};
		const connection = spyOn(database, 'createKgConnection').mockReturnValue({
			db: { select: () => query },
		} as unknown as ReturnType<typeof database.createKgConnection>);
		try {
			const { app } = createApp({
				port: 3000,
				databaseKgUrl: 'unused',
				allowedOrigins: [],
				authMode: 'open',
				rateLimitRpm: 0,
				trustProxy: false,
				atomSemanticReadsEnabled: true,
			});
			const response = await app.request(
				`/api/iids/${encoded ? encodeURIComponent(iid) : iid}/atoms`
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				data: [],
				pagination: { limit: 25, offset: 0, count: 0 },
			});
			expect(predicate).toBeDefined();
			const sql = new PgDialect().sqlToQuery(predicate!.getSQL() as never);
			// The IID must reach the query byte-for-byte (every colon intact) in each
			// place it is bound: the primary match and the alias match share the value.
			const iidParams = sql.params.filter(
				(param) => typeof param === 'string' && param.startsWith('int:')
			);
			expect(iidParams.length).toBeGreaterThanOrEqual(1);
			for (const param of iidParams) expect(param).toBe(iid);
			expect(sql.params.slice(-2)).toEqual(['active', 'public']);
			expect(sql.sql).toContain('"kg"."nodes"."iid" = $1');
		} finally {
			connection.mockRestore();
		}
	});
}
