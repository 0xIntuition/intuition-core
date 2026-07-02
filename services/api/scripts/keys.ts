/**
 * API-key management for the Intuition Core query API.
 *
 *   bun scripts/keys.ts create --name partner-acme --account 0xYourWallet
 *   bun scripts/keys.ts create --name reader --account 0x… --read-only
 *   bun scripts/keys.ts list
 *   bun scripts/keys.ts revoke --id key_…
 *
 * The plaintext key (ik_…) is printed ONCE at mint time; only its SHA-256
 * hash is stored. Requires DATABASE_KG_URL.
 */
import { randomBytes } from 'node:crypto';
import { apiKeys, createEnvKgConnection } from '@0xintuition/database-kg';
import { ensureAccount } from '@0xintuition/database-kg/actions';
import { eq, sql } from 'drizzle-orm';
import { API_KEY_PREFIX, sha256Hex } from '../src/auth';

function arg(flag: string): string | undefined {
	const index = process.argv.indexOf(flag);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
	const command = process.argv[2];
	const { db, close } = createEnvKgConnection();

	try {
		switch (command) {
			case 'create': {
				const name = arg('--name');
				const account = arg('--account');
				if (!(name && account)) {
					console.error('usage: keys.ts create --name <label> --account <0xwallet> [--read-only]');
					process.exit(1);
				}
				const canWrite = !process.argv.includes('--read-only');

				await ensureAccount(db, account);

				const plaintext = `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
				const id = `key_${randomBytes(8).toString('hex')}`;
				await db.insert(apiKeys).values({
					id,
					keyHash: await sha256Hex(plaintext),
					name,
					accountId: account,
					canWrite,
				});

				console.log(`created ${id} (${name}) → account ${account}, write=${canWrite}`);
				console.log('');
				console.log(`  ${plaintext}`);
				console.log('');
				console.log('Store this key now — it is not recoverable. Use it as:');
				console.log(`  Authorization: Bearer ${plaintext.slice(0, 8)}…`);
				break;
			}
			case 'list': {
				const rows = await db
					.select({
						id: apiKeys.id,
						name: apiKeys.name,
						accountId: apiKeys.accountId,
						canWrite: apiKeys.canWrite,
						createdAt: apiKeys.createdAt,
						revokedAt: apiKeys.revokedAt,
						lastUsedAt: apiKeys.lastUsedAt,
					})
					.from(apiKeys)
					.orderBy(apiKeys.createdAt);
				for (const r of rows) {
					const state = r.revokedAt ? 'REVOKED' : 'active';
					console.log(
						`${r.id}  ${state}  write=${r.canWrite}  ${r.name} → ${r.accountId}  last_used=${r.lastUsedAt?.toISOString() ?? 'never'}`
					);
				}
				if (rows.length === 0) {
					console.log('(no keys — mint one with: keys.ts create --name <label> --account <0x…>)');
				}
				break;
			}
			case 'revoke': {
				const id = arg('--id');
				if (!id) {
					console.error('usage: keys.ts revoke --id <key_…>');
					process.exit(1);
				}
				const updated = await db
					.update(apiKeys)
					.set({ revokedAt: sql`now()` })
					.where(eq(apiKeys.id, id))
					.returning({ id: apiKeys.id });
				console.log(updated.length > 0 ? `revoked ${id}` : `no such key: ${id}`);
				break;
			}
			default:
				console.error('usage: keys.ts <create|list|revoke> …');
				process.exit(1);
		}
	} finally {
		await close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
