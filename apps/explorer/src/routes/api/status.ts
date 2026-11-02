import { createFileRoute } from '@tanstack/react-router';
import { statusTargets } from '@/lib/service-status';

/**
 * Server-side health sweep over every Core service. Runs on the explorer's
 * own server (not the browser) so worker/indexer health ports need no CORS.
 * Override targets with EXPLORER_STATUS_TARGETS: `name=url,name=url,…`.
 */
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
				const targets = statusTargets({
					apiUrl:
						process.env.VITE_API_URL ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
					indexingEnabled: process.env.EXPLORER_INDEXING_ENABLED === 'true',
					override: process.env.EXPLORER_STATUS_TARGETS,
				});
				const results = await Promise.all(targets.map(probe));
				return Response.json({ data: results, checkedAt: new Date().toISOString() });
			},
		},
	},
});
