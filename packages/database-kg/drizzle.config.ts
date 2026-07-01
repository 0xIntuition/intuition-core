import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_KG_URL) {
	throw new Error('Missing DATABASE_KG_URL');
}

export default {
	schema: './src/schema.ts',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_KG_URL },
	casing: 'snake_case',
} satisfies Config;
