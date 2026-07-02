import type { MiddlewareHandler } from 'hono';
import { HttpError } from './errors';

export function createAuthMiddleware(authToken?: string): MiddlewareHandler {
	return async (context, next) => {
		if (!authToken) {
			await next();
			return;
		}

		if (isPublicRoute(context.req.path)) {
			await next();
			return;
		}

		const authorization = context.req.header('authorization');
		if (authorization !== `Bearer ${authToken}`) {
			throw new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid bearer token.');
		}

		await next();
	};
}

function isPublicRoute(path: string): boolean {
	return path === '/health' || path === '/ready' || path === '/metrics';
}
