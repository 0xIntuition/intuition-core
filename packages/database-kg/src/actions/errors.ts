export type KgActionErrorCode =
	| 'CONFLICT'
	| 'FORBIDDEN'
	| 'INTERNAL'
	| 'INVALID_INPUT'
	| 'NOT_FOUND'
	| 'NOT_IMPLEMENTED'
	| 'OUT_OF_ORDER';

export class KgActionError extends Error {
	readonly code: KgActionErrorCode;

	constructor(code: KgActionErrorCode, message: string) {
		super(message);
		this.name = 'KgActionError';
		this.code = code;
	}
}

export function forbidden(message: string): KgActionError {
	return new KgActionError('FORBIDDEN', message);
}

export function invalidInput(message: string): KgActionError {
	return new KgActionError('INVALID_INPUT', message);
}

export function conflict(message: string): KgActionError {
	return new KgActionError('CONFLICT', message);
}

export function notFound(message: string): KgActionError {
	return new KgActionError('NOT_FOUND', message);
}

export function notImplemented(message: string): KgActionError {
	return new KgActionError('NOT_IMPLEMENTED', message);
}

// Thrown when a write would silently no-op against a soft-deleted or
// out-of-order target. Callers map this to TRPCError({ code: 'CONFLICT' })
// at the tRPC seam so clients see a real conflict instead of stale state.
export function outOfOrder(message: string): KgActionError {
	return new KgActionError('OUT_OF_ORDER', message);
}

// Thrown when an invariant the action expected to hold is violated by the
// database state (e.g., a returning() call yielded zero rows after a write
// the action believed must succeed). Distinct from notFound, which signals
// the input id did not match any row. Callers should map this to a 5xx —
// it represents a contract bug, not a user error.
export function internalError(message: string): KgActionError {
	return new KgActionError('INTERNAL', message);
}

export function assertUuid(value: string, label: string): void {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
		throw invalidInput(`${label} must be a UUID.`);
	}
}

export function assertNonEmptyString(value: string, label: string): void {
	if (!value.trim()) {
		throw invalidInput(`${label} must not be empty.`);
	}
}
