import { describe, expect, it } from 'bun:test';
import { ParseError } from '@0xintuition/atom-parser/types';
import { CircuitOpenError } from './circuit-breaker';
import {
	classifyWorkerError,
	computeRetryDelayMs,
	toProcessingError,
	WorkerConfigurationError,
} from './errors';

describe('classifyWorkerError', () => {
	it('classifies parser errors as explicit fatal item failures', () => {
		const classified = classifyWorkerError(new ParseError('EMPTY_INPUT', 'empty'));

		expect(classified).toEqual({
			class: 'fatal',
			code: 'EMPTY_INPUT',
			message: 'empty',
			retriable: false,
		});
	});

	it('classifies structured network and rate-limit errors as circuit protected', () => {
		const error = Object.assign(new Error('fetch failed'), { status: 503 });
		const classified = classifyWorkerError(error);

		expect(classified.class).toBe('circuitProtected');
		expect(classified.code).toBe('CIRCUIT_PROTECTED_ERROR');
		expect(classified.retriable).toBe(true);
	});

	it('classifies explicit operator configuration errors as fatal', () => {
		const classified = classifyWorkerError(
			new WorkerConfigurationError('KG worker requires DATABASE_KG_URL')
		);

		expect(classified.class).toBe('fatal');
		expect(classified.code).toBe('WORKER_CONFIGURATION_ERROR');
		expect(classified.retriable).toBe(false);
	});

	it('defaults unknown errors to transient', () => {
		const classified = classifyWorkerError(new Error('unexpected runtime quirk'));

		expect(classified.class).toBe('transient');
		expect(classified.code).toBe('WORKER_ERROR');
		expect(classified.retriable).toBe(true);
	});

	it('does not classify broad abort or validation substrings as circuit/fatal', () => {
		expect(classifyWorkerError(new Error('transaction aborted by deadlock detector')).class).toBe(
			'transient'
		);
		expect(classifyWorkerError(new Error("missing required field 'context'")).class).toBe(
			'transient'
		);
		expect(classifyWorkerError(new Error('forbidden by RLS policy')).class).toBe('transient');
	});

	it('classifies explicit abort errors by code or DOMException name', () => {
		expect(
			classifyWorkerError(Object.assign(new Error('operation aborted'), { code: 'ABORT_ERR' }))
				.class
		).toBe('circuitProtected');
		expect(classifyWorkerError(new DOMException('aborted', 'AbortError')).class).toBe(
			'circuitProtected'
		);
	});

	it('classifies open circuit rejections as circuit protected', () => {
		const classified = classifyWorkerError(new CircuitOpenError('database-kg'));

		expect(classified.class).toBe('circuitProtected');
		expect(classified.retriable).toBe(true);
	});
});

describe('toProcessingError', () => {
	it('uses the shared classifier for retryability', () => {
		const processingError = toProcessingError(new Error('ECONNRESET while calling provider'), {
			maxAttempts: 3,
		});

		expect(processingError.code).toBe('CIRCUIT_PROTECTED_ERROR');
		expect(processingError.retriable).toBe(true);
		expect(processingError.details).toEqual({ maxAttempts: 3 });
		expect(processingError.observedAt).toBeInstanceOf(Date);
	});
});

describe('computeRetryDelayMs', () => {
	it('uses full jitter within the capped backoff window', () => {
		const originalRandom = Math.random;
		try {
			Math.random = () => 0.5;
			expect(computeRetryDelayMs(0, 100, 1_000)).toBe(50);
			expect(computeRetryDelayMs(1, 100, 1_000)).toBe(50);
			expect(computeRetryDelayMs(3, 100, 1_000)).toBe(200);
			expect(computeRetryDelayMs(10, 10_000, 1_000)).toBe(500);
		} finally {
			Math.random = originalRandom;
		}
	});
});
