import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

export const requestIdMiddleware: MiddlewareHandler = async (context, next) => {
	const incoming = context.req.header('x-request-id');
	const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : randomUUID();

	context.set('requestId', requestId);
	await next();
	context.header('x-request-id', requestId);
};
