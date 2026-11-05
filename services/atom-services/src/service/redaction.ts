import { redactProviderDiagnostic } from '@0xintuition/atom-enrichment';

type ResolverErrorLike = { message: string };
type ClassificationLike = { resolverErrors?: ReadonlyArray<ResolverErrorLike> | undefined };
type EnrichmentLike = {
	errors: ReadonlyArray<{ message: string }>;
	skipped: ReadonlyArray<{ reason: string }>;
};
type ProcessLike = {
	classification?: ClassificationLike | null;
	enrichment?: EnrichmentLike | null;
};

/**
 * Every response boundary applies these before serializing. Provider text is
 * already redacted by the enrichment engine and stripped at the HTTP helper;
 * this is the last line, so it must be cheap and shape-preserving.
 */
export function redactClassificationResponse<T extends ClassificationLike>(result: T): T {
	if (!result.resolverErrors?.length) {
		return result;
	}
	return {
		...result,
		resolverErrors: result.resolverErrors.map((error) => ({
			...error,
			message: redactProviderDiagnostic(error.message),
		})),
	};
}

export function redactEnrichmentResponse<T extends EnrichmentLike>(result: T): T {
	return {
		...result,
		errors: result.errors.map((error) => ({
			...error,
			message: redactProviderDiagnostic(error.message),
		})),
		skipped: result.skipped.map((entry) => ({
			...entry,
			reason: redactProviderDiagnostic(entry.reason),
		})),
	};
}

export function redactProcessResponse<T extends ProcessLike>(result: T): T {
	return {
		...result,
		classification: result.classification
			? redactClassificationResponse(result.classification)
			: result.classification,
		enrichment: result.enrichment ? redactEnrichmentResponse(result.enrichment) : result.enrichment,
	};
}

export function redactErrorMessage(error: unknown, fallback: string): string {
	return redactProviderDiagnostic(error instanceof Error ? error.message : fallback);
}
