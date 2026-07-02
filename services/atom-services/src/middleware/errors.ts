import { ZodError } from 'zod/v4';

export type HttpErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

export class HttpError extends Error {
	readonly status: HttpErrorStatus;
	readonly code: string;
	readonly details?: unknown;

	constructor(status: HttpErrorStatus, code: string, message: string, details?: unknown) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export function mapError(error: unknown): HttpError {
	if (error instanceof HttpError) {
		return error;
	}

	if (error instanceof ZodError) {
		return new HttpError(400, 'VALIDATION_ERROR', 'Request payload validation failed.', {
			issues: error.issues,
		});
	}

	return new HttpError(500, 'INTERNAL_ERROR', 'Unexpected service error.');
}
