import type { MiddlewareHandler } from 'hono';
import type { MetricsRegistry } from '../metrics';

export function createMetricsMiddleware(metrics: MetricsRegistry): MiddlewareHandler {
	return async (context, next) => {
		const startedAt = Date.now();
		let status = 500;

		try {
			await next();
			status = context.res.status;
		} finally {
			metrics.recordHttpRequest(
				context.req.path,
				context.req.method,
				status,
				Date.now() - startedAt
			);
		}
	};
}
