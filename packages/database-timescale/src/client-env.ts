import { createTimescaleConnection } from './client';

export function getTimescaleConnectionString(
	source: Record<string, string | undefined> = process.env
): string {
	const connectionString = source.DATABASE_TIMESCALE_URL?.trim();

	if (!connectionString) {
		throw new Error('Missing DATABASE_TIMESCALE_URL');
	}

	return connectionString;
}

export function createEnvTimescaleConnection(
	source: Record<string, string | undefined> = process.env
) {
	return createTimescaleConnection({
		connectionString: getTimescaleConnectionString(source),
	});
}
