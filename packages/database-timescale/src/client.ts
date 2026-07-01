import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export function createTimescaleConnection(options: { connectionString: string; max?: number }) {
	const client = postgres(options.connectionString, {
		max: options.max ?? 5,
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

export type TimescaleConnection = ReturnType<typeof createTimescaleConnection>;
export type TimescaleDb = TimescaleConnection['db'];
