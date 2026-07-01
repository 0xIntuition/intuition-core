import { createKgConnection } from './client';

export function getKgConnectionString(
	source: Record<string, string | undefined> = process.env
): string {
	const cs = source.DATABASE_KG_URL?.trim();

	if (!cs) {
		throw new Error('Missing DATABASE_KG_URL');
	}

	return cs;
}

export function createEnvKgConnection(source: Record<string, string | undefined> = process.env) {
	return createKgConnection({
		connectionString: getKgConnectionString(source),
	});
}
