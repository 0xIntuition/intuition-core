import { createAtomServicesApp } from './app';
import { loadServiceConfig } from './config';

const config = loadServiceConfig();
const app = createAtomServicesApp({
	config,
});

const server = Bun.serve({
	port: config.port,
	fetch: app.fetch,
});

console.info('[atom-services] listening', {
	port: server.port,
	defaultPreset: config.defaultPreset,
	cacheProvider: config.cacheProvider,
	persistenceEnabled: config.persistenceEnabled,
});
