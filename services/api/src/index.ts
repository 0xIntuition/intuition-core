/**
 * Intuition Core — query API.
 *
 * A small, auth-free, read-only REST surface over the knowledge graph you
 * indexed. Reads the KG Postgres directly through @0xintuition/database-kg.
 * No authentication, billing, or private coupling — bring your own front end.
 */
import { serve } from 'bun';
import { createApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app, close } = createApp(config);

const server = serve({
	port: config.port,
	fetch: app.fetch,
});

console.log(`[api] intuition-core query api listening on :${config.port}`);

const shutdown = async (signal: string) => {
	console.log(`[api] ${signal} received, shutting down`);
	server.stop();
	await close();
	process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
