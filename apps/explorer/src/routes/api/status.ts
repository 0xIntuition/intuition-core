import { createFileRoute } from '@tanstack/react-router';

/**
 * Server-side health sweep over every Core service. Runs on the explorer's
 * own server (not the browser) so worker/indexer health ports need no CORS.
 * Override targets with EXPLORER_STATUS_TARGETS: `name=url,name=url,…`.
 */
const DEFAULT_TARGETS: Array<{ name: string; url: string }> = [
	{ name: 'api', url: 'http://localhost:3000/health' },
	{ name: 'atom-services', url: 'http://localhost:4010/ready' },
	{ name: 'worker-parse', url: 'http://localhost:4110/readyz' },
	{ name: 'worker-enrichment', url: 'http://localhost:4111/readyz' },
	{ name: 'worker-classification', url: 'http://localhost:4112/readyz' },
	{ name: 'indexer', url: 'http://localhost:9091/health' },
	{ name: 'projections', url: 'http://localhost:9092/health/ready' },
];

function targets(): Array<{ name: string; url: string }> {
	const raw = process.env.EXPLORER_STATUS_TARGETS;
	if (!raw) {
		return DEFAULT_TARGETS;
	}
	return raw
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [name, ...rest] = entry.split('=');
			return { name: (name ?? '').trim(), url: rest.join('=').trim() };
		})
		.filter((t) => t.name && t.url);
}

export type ServiceStatus = {
	name: string;
	url: string;
	ok: boolean;
	status: number | null;
	latencyMs: number | null;
};

async function probe(target: { name: string; url: string }): Promise<ServiceStatus> {
	const startedAt = performance.now();
	try {
		const response = await fetch(target.url, { signal: AbortSignal.timeout(2500) });
		return {
			...target,
			ok: response.ok,
			status: response.status,
			latencyMs: Math.round(performance.now() - startedAt),
		};
	} catch {
		return { ...target, ok: false, status: null, latencyMs: null };
	}
}

export const Route = createFileRoute('/api/status')({
	server: {
		handlers: {
			GET: async () => {
				const results = await Promise.all(targets().map(probe));
				return Response.json({ data: results, checkedAt: new Date().toISOString() });
			},
		},
	},
});
