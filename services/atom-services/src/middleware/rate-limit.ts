import type { MiddlewareHandler } from 'hono';
import { HttpError } from './errors';

type RateLimitEntry = {
	count: number;
	resetAtMs: number;
};

type RateLimitMiddlewareOptions = {
	maxRequests: number;
	windowMs: number;
};

export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): MiddlewareHandler {
	const state = new Map<string, RateLimitEntry>();

	return async (context, next) => {
		if (isPublicRoute(context.req.path)) {
			await next();
			return;
		}

		const nowMs = Date.now();
		const key = rateLimitKey(
			context.req.header('x-forwarded-for'),
			context.req.header('authorization')
		);
		const entry = state.get(key);

		if (!entry || entry.resetAtMs <= nowMs) {
			state.set(key, {
				count: 1,
				resetAtMs: nowMs + options.windowMs,
			});
		} else {
			entry.count += 1;
			if (entry.count > options.maxRequests) {
				const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAtMs - nowMs) / 1_000));
				context.header('retry-after', String(retryAfterSeconds));
				throw new HttpError(429, 'RATE_LIMITED', 'Rate limit exceeded.');
			}
		}

		const active = state.get(key);
		context.header('x-ratelimit-limit', String(options.maxRequests));
		context.header(
			'x-ratelimit-remaining',
			String(Math.max(0, options.maxRequests - (active?.count ?? 0)))
		);
		context.header('x-ratelimit-reset', String(active?.resetAtMs ?? nowMs));

		await next();
	};
}

function rateLimitKey(forwardedFor: string | undefined, authorization: string | undefined): string {
	const normalizedForwardedFor = forwardedFor?.split(',')[0]?.trim();
	if (authorization && authorization.length > 0) {
		return `auth:${authorization}`;
	}

	if (normalizedForwardedFor && normalizedForwardedFor.length > 0) {
		return `ip:${normalizedForwardedFor}`;
	}

	return 'anon';
}

function isPublicRoute(path: string): boolean {
	return path === '/health' || path === '/ready' || path === '/metrics';
}
