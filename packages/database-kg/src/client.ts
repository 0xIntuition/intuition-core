import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export function createKgConnection(options: { connectionString: string; max?: number }) {
	const client = postgres(options.connectionString, {
		max: options.max ?? 5,
		connect_timeout: 10,
		// `prepare: false` is required when this connection is fronted by a
		// PgBouncer running in `pool_mode = transaction`. Server connections
		// get reused across clients mid-session, so cached prepared statements
		// vanish and postgres-js throws `prepared statement "X" does not exist`.
		// Disabling prepare unconditionally keeps the package PgBouncer-safe at
		// the cost of microseconds per query against direct connections.
		prepare: false,
	});
	const db = drizzle({
		client,
		schema,
		casing: 'snake_case',
	});

	return {
		client,
		db,
		close: async () => {
			await client.end({ timeout: 5 });
		},
	};
}

export type KgConnection = ReturnType<typeof createKgConnection>;
export type KgDb = KgConnection['db'];
