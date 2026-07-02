import { Hono } from 'hono';
import type { z } from 'zod/v4';
import type { ServiceConfig } from './config';
import { loadServiceConfig } from './config';
import {
	classifyRequestSchema,
	classifyResponseSchema,
	enrichRequestSchema,
	enrichResponseSchema,
	healthResponseSchema,
	processBatchStatusResponseSchema,
	processBatchSubmitRequestSchema,
	processBatchSubmitResponseSchema,
	processEndpointRequestSchema,
	processResponseSchema,
	readyResponseSchema,
} from './contracts';
import { createAuthMiddleware } from './middleware/auth';
import { HttpError, mapError } from './middleware/errors';
import { createMetricsMiddleware } from './middleware/metrics';
import { createRateLimitMiddleware } from './middleware/rate-limit';
import { requestIdMiddleware } from './middleware/request-id';
import { InMemoryProcessBatchStore } from './service/batch-store';
import { createServiceDependencies, type ServiceDependencies } from './service/dependencies';
import type { AtomServicesBindings } from './types';

type CreateAppOptions = {
	config?: ServiceConfig;
	dependencies?: ServiceDependencies;
};

export function createAtomServicesApp(options: CreateAppOptions = {}): Hono<AtomServicesBindings> {
	const config = options.config ?? loadServiceConfig();
	const dependencies = options.dependencies ?? createServiceDependencies(config);
	const batchStore = new InMemoryProcessBatchStore({
		retainCompletedMs: config.batchRetainCompletedMs,
	});

	const app = new Hono<AtomServicesBindings>();

	app.use('*', requestIdMiddleware);
	app.use('*', createAuthMiddleware(config.authToken));
	app.use(
		'*',
		createRateLimitMiddleware({
			maxRequests: config.rateLimitMaxRequests,
			windowMs: config.rateLimitWindowMs,
		})
	);
	app.use('*', createMetricsMiddleware(dependencies.metrics));

	app.onError((error, context) => {
		const mapped = mapError(error);
		let requestId: string | undefined;
		try {
			requestId = context.get('requestId');
		} catch {
			requestId = undefined;
		}

		return context.json(
			{
				ok: false,
				error: {
					code: mapped.code,
					message: mapped.message,
					details: mapped.details,
					requestId,
				},
			},
			mapped.status
		);
	});

	app.get('/health', (context) => {
		return context.json(
			healthResponseSchema.parse({
				ok: true,
				service: 'atom-services',
				status: 'healthy',
				timestamp: new Date().toISOString(),
				uptimeMs: dependencies.metrics.uptimeMs(),
			})
		);
	});

	app.get('/ready', (context) => {
		const readiness = dependencies.readiness();
		const payload = readyResponseSchema.parse({
			ok: readiness.ok,
			service: 'atom-services',
			status: readiness.status,
			timestamp: new Date().toISOString(),
			dependencies: readiness.dependencies,
			presets: readiness.presets,
			warnings: readiness.warnings,
		});

		return context.json(payload, readiness.ok ? 200 : 503);
	});

	app.get('/metrics', (context) => {
		return context.body(dependencies.metrics.renderPrometheus(), {
			status: 200,
			headers: {
				'content-type': 'text/plain; version=0.0.4; charset=utf-8',
			},
		});
	});

	app.post('/v1/classify', async (context) => {
		const input = await parseJson(context, classifyRequestSchema);
		const result = await dependencies.classify(input);
		return context.json(classifyResponseSchema.parse(result));
	});

	app.post('/v1/enrich', async (context) => {
		const input = await parseJson(context, enrichRequestSchema);
		const result = await dependencies.enrich(input);
		return context.json(enrichResponseSchema.parse(result));
	});

	app.post('/v1/process', async (context) => {
		const input = await parseJson(context, processEndpointRequestSchema);
		if (input.persistence?.enabled && !dependencies.persistence.canPersist()) {
			throw new HttpError(
				400,
				'PERSISTENCE_NOT_AVAILABLE',
				'Persistence handoff was requested but no persistence adapter is configured.'
			);
		}

		const processResult = await dependencies.process(input, context.get('requestId'));
		dependencies.metrics.recordProcessOutcome(processResult.status);
		dependencies.metrics.recordPluginOutcomes(processResult.enrichment);

		const persistence = await dependencies.persistence.persist(input.persistence, processResult);
		const payload = processResponseSchema.parse({
			...processResult,
			persistence,
		});

		return context.json(payload);
	});

	app.post('/v1/process/batch', async (context) => {
		const input = await parseJson(context, processBatchSubmitRequestSchema);
		if (input.jobs.length > config.batchMaxItems) {
			throw new HttpError(
				400,
				'BATCH_LIMIT_EXCEEDED',
				`Batch payload contains ${input.jobs.length} jobs, but ATOM_SERVICES_BATCH_MAX_ITEMS is ${config.batchMaxItems}.`
			);
		}

		if (
			input.jobs.some((job) => job.persistence?.enabled) &&
			!dependencies.persistence.canPersist()
		) {
			throw new HttpError(
				400,
				'PERSISTENCE_NOT_AVAILABLE',
				'One or more batch jobs requested persistence, but no persistence adapter is configured.'
			);
		}

		const submission = batchStore.submit(input, async (job, batchContext) => {
			const processResult = await dependencies.process(
				job,
				`${batchContext.jobId}-${batchContext.index}`
			);
			dependencies.metrics.recordProcessOutcome(processResult.status);
			dependencies.metrics.recordPluginOutcomes(processResult.enrichment);
			const persistence = await dependencies.persistence.persist(job.persistence, processResult);

			return processResponseSchema.parse({
				...processResult,
				persistence,
			});
		});

		return context.json(processBatchSubmitResponseSchema.parse(submission), 202);
	});

	app.get('/v1/process/batch/:jobId', (context) => {
		const jobId = context.req.param('jobId');
		const job = batchStore.get(jobId);

		if (!job) {
			throw new HttpError(404, 'BATCH_JOB_NOT_FOUND', `No batch job found for id "${jobId}".`);
		}

		return context.json(processBatchStatusResponseSchema.parse(job));
	});

	app.notFound((context) => {
		return context.json(
			{
				ok: false,
				error: {
					code: 'NOT_FOUND',
					message: 'Route not found.',
					requestId: context.get('requestId'),
				},
			},
			404
		);
	});

	return app;
}

async function parseJson<Schema extends z.ZodType>(
	context: {
		req: {
			json: () => Promise<unknown>;
		};
	},
	schema: Schema
): Promise<z.infer<Schema>> {
	let body: unknown;
	try {
		body = await context.req.json();
	} catch {
		throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON.');
	}

	return schema.parse(body);
}
