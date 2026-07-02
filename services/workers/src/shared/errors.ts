import { ParseError } from '@0xintuition/atom-parser/types';
import { CircuitOpenError } from './circuit-breaker';

/**
 * Structured processing error attached to a node/stage when a worker fails.
 * Mirrors the shape persisted by the KG processing actions.
 */
export type AtomProcessingError = {
	code: string;
	message: string;
	retriable: boolean;
	details?: Record<string, unknown>;
	observedAt?: Date;
};

export type ErrorClass = 'fatal' | 'transient' | 'circuitProtected';

export type ClassifiedError = {
	class: ErrorClass;
	code: string;
	message: string;
	retriable: boolean;
};

export class WorkerConfigurationError extends Error {
	readonly code = 'WORKER_CONFIGURATION_ERROR';

	constructor(message: string) {
		super(message);
		this.name = 'WorkerConfigurationError';
	}
}

type WorkerErrorVariant =
	| { kind: 'parse'; error: ParseError }
	| { kind: 'configuration'; error: WorkerConfigurationError }
	| { kind: 'circuitProtected'; error: Error }
	| { kind: 'unknown'; error: unknown };

export function classifyWorkerError(error: unknown): ClassifiedError {
	const variant = resolveWorkerErrorVariant(error);
	switch (variant.kind) {
		case 'parse':
			return {
				class: 'fatal',
				code: variant.error.code,
				message: variant.error.message,
				retriable: false,
			};
		case 'configuration':
			return {
				class: 'fatal',
				code: variant.error.code,
				message: variant.error.message,
				retriable: false,
			};
		case 'circuitProtected':
			return {
				class: 'circuitProtected',
				code: 'CIRCUIT_PROTECTED_ERROR',
				message: variant.error.message,
				retriable: true,
			};
		case 'unknown':
			return {
				class: 'transient',
				code: 'WORKER_ERROR',
				message: error instanceof Error ? error.message : 'Unknown worker error.',
				retriable: true,
			};
		default:
			return assertNever(variant);
	}
}

export function toProcessingError(
	error: unknown,
	options: { maxAttempts?: number } = {}
): AtomProcessingError {
	const classified = classifyWorkerError(error);
	const details =
		options.maxAttempts === undefined
			? undefined
			: ({
					maxAttempts: options.maxAttempts,
				} satisfies Record<string, unknown>);

	return {
		code: classified.code,
		message: classified.message,
		retriable: classified.retriable,
		...(details ? { details } : {}),
		observedAt: new Date(),
	};
}

export function computeRetryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
	const capped = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
	return Math.floor(Math.random() * Math.max(1, capped));
}

export function isRetryEligible(input: {
	error: AtomProcessingError | undefined;
	attempts: number;
	maxAttempts: number;
}): boolean {
	return Boolean(input.error?.retriable) && input.attempts < input.maxAttempts;
}

function resolveWorkerErrorVariant(error: unknown): WorkerErrorVariant {
	if (error instanceof ParseError) {
		return { kind: 'parse', error };
	}
	if (error instanceof WorkerConfigurationError) {
		return { kind: 'configuration', error };
	}
	if (isCircuitProtectedError(error)) {
		return { kind: 'circuitProtected', error };
	}

	return { kind: 'unknown', error };
}

function isCircuitProtectedError(error: unknown): error is Error {
	if (!(error instanceof Error)) {
		return false;
	}
	if (error instanceof CircuitOpenError) {
		return true;
	}

	const code = resolveErrorCode(error);
	if (
		code &&
		[
			'ABORT_ERR',
			'ECONNRESET',
			'ECONNREFUSED',
			'ENOTFOUND',
			'EAI_AGAIN',
			'ETIMEDOUT',
			'EPIPE',
			'57P01',
			'57P03',
			'08001',
			'08006',
		].includes(code.toUpperCase())
	) {
		return true;
	}

	if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
		return error.name === 'AbortError';
	}
	if (error.name === 'AbortError') {
		return true;
	}

	const status = resolveStatusCode(error);
	if (status && [429, 502, 503, 504].includes(status)) {
		return true;
	}

	return hasCircuitProtectedMessage(error.message);
}

function hasCircuitProtectedMessage(message: string): boolean {
	return [
		/\bECONNRESET\b/i,
		/\bECONNREFUSED\b/i,
		/\bENOTFOUND\b/i,
		/\bEAI_AGAIN\b/i,
		/\bETIMEDOUT\b/i,
		/\btimeout\b/i,
		/\btimed out\b/i,
		/\brate limit(?:ed)?\b/i,
		/\btoo many requests\b/i,
		/\bgateway timeout\b/i,
		/\bconnection closed\b/i,
		/\bconnection terminated\b/i,
	].some((pattern) => pattern.test(message));
}

function resolveErrorCode(error: Error): string | undefined {
	const code = (error as { code?: unknown }).code;
	if (typeof code === 'string') {
		return code;
	}
	if (typeof code === 'number') {
		return String(code);
	}
	return undefined;
}

function resolveStatusCode(error: Error): number | undefined {
	const directStatus = (error as { status?: unknown; statusCode?: unknown }).status;
	const directStatusCode = (error as { statusCode?: unknown }).statusCode;
	const responseStatus = (error as { response?: { status?: unknown } }).response?.status;
	for (const candidate of [directStatus, directStatusCode, responseStatus]) {
		if (typeof candidate === 'number') {
			return candidate;
		}
		if (typeof candidate === 'string') {
			const parsed = Number.parseInt(candidate, 10);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	return undefined;
}

function assertNever(value: never): never {
	throw new Error(`Unhandled worker error variant: ${String(value)}`);
}
