import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

// TanStack Start expects getRouter to return a fresh router instance.
export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// Dashboard data is cheap and local; keep it fresh but not chatty.
				staleTime: 10_000,
				retry: 1,
				refetchOnWindowFocus: false,
			},
		},
	});

	return createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		defaultPreload: 'intent',
		context: { queryClient },
	});
}

// Alias for the SSR handler.
export const createRouter = getRouter;

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
