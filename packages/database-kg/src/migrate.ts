/**
 * KG migration runner.
 *
 *   bun run db:migrate   (→ bun with-env bun src/migrate.ts)
 *
 * Two ordered phases:
 *   1. Apply the drizzle-generated table DDL (drizzle/), tracked in the
 *      __drizzle_migrations journal so each runs exactly once.
 *   2. Apply custom post-migration SQL (migrations/post/*.sql) — the things
 *      Drizzle can't express, currently the TimescaleDB hypertable conversion.
 *      Statements are split on `--> statement-breakpoint` and run individually
 *      in autocommit.
 *
 * The post phase is skipped with a notice when the `timescaledb` extension is
 * unavailable, so this same runner works against a plain Postgres instance.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getKgConnectionString } from './client-env';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const drizzleFolder = join(packageRoot, 'drizzle');
const postFolder = join(packageRoot, 'migrations', 'post');

async function applyDrizzleMigrations(connectionString: string): Promise<void> {
	const client = postgres(connectionString, { max: 1, prepare: false });
	try {
		const db = drizzle({ client });
		console.log('[migrate] applying drizzle table DDL…');
		await migrate(db, { migrationsFolder: drizzleFolder });
		console.log('[migrate] drizzle migrations up to date.');
	} finally {
		await client.end({ timeout: 5 });
	}
}

async function hasTimescale(client: postgres.Sql): Promise<boolean> {
	const rows = await client`
		SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'
	`;
	return rows.length > 0;
}

function splitStatements(sql: string): string[] {
	// Split only on a breakpoint that occupies its own line (drizzle's
	// convention), so the marker can appear inside a comment without splitting
	// mid-statement. Then drop chunks that are entirely comments/whitespace.
	return sql
		.split(/^[ \t]*-->[ \t]*statement-breakpoint[ \t]*$/m)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.split('\n').every((line) => line.trim().startsWith('--')));
}

async function applyPostMigrations(connectionString: string): Promise<void> {
	const client = postgres(connectionString, { max: 1, prepare: false });
	try {
		if (!(await hasTimescale(client))) {
			console.log(
				'[migrate] timescaledb extension unavailable — skipping post migrations (kg.events stays a plain table).'
			);
			return;
		}

		let files: string[];
		try {
			files = (await readdir(postFolder)).filter((f) => f.endsWith('.sql')).sort();
		} catch {
			return; // no post migrations yet
		}

		for (const file of files) {
			const sql = await readFile(join(postFolder, file), 'utf8');
			console.log(`[migrate] applying post migration ${file}…`);
			for (const statement of splitStatements(sql)) {
				await client.unsafe(statement);
			}
		}
		console.log('[migrate] post migrations up to date.');
	} finally {
		await client.end({ timeout: 5 });
	}
}

async function seedBaselinePredicates(connectionString: string): Promise<void> {
	const { BASELINE_PREDICATES } = await import('./seeds/predicates');
	const client = postgres(connectionString, { max: 1, prepare: false });
	try {
		for (const p of BASELINE_PREDICATES) {
			// Idempotent: predicates are keyed by slug; existing rows are untouched.
			await client`
				INSERT INTO kg.predicates
					(id, slug, label, description, is_transitive, is_symmetric, is_hierarchical, is_social, is_market)
				VALUES
					(${p.id}, ${p.slug}, ${p.label}, ${p.description ?? null}, ${p.isTransitive}, ${p.isSymmetric}, ${p.isHierarchical}, ${p.isSocial}, ${p.isMarket})
				ON CONFLICT (slug) DO NOTHING
			`;
		}
		console.log(`[migrate] baseline predicates seeded (${BASELINE_PREDICATES.length}).`);
	} finally {
		await client.end({ timeout: 5 });
	}
}

async function main(): Promise<void> {
	const connectionString = getKgConnectionString();
	await applyDrizzleMigrations(connectionString);
	await applyPostMigrations(connectionString);
	await seedBaselinePredicates(connectionString);
	console.log('[migrate] done.');
}

main().catch((error) => {
	console.error('[migrate] failed:', error);
	process.exit(1);
});
