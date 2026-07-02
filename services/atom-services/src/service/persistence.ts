import type { PersistenceRequest, PersistenceResult, ProcessCoreResponse } from '../contracts';

export type PersistencePayload = {
	runId: string;
	classification: ProcessCoreResponse['classification'];
	enrichment: ProcessCoreResponse['enrichment'];
	traceId?: string;
};

export type PersistenceSaveResult = {
	status: 'queued' | 'saved';
	recordId?: string;
};

export interface PersistenceHandoffAdapter {
	save(payload: PersistencePayload): Promise<PersistenceSaveResult>;
	checkReadiness?: () => boolean;
}

type PersistenceControllerOptions = {
	enabled: boolean;
	adapter?: PersistenceHandoffAdapter;
};

export type PersistenceController = {
	canPersist: () => boolean;
	isReady: () => boolean;
	persist: (
		request: PersistenceRequest | undefined,
		payload: ProcessCoreResponse
	) => Promise<PersistenceResult>;
};

export function createPersistenceController(
	options: PersistenceControllerOptions = {
		enabled: false,
	}
): PersistenceController {
	const enabled = options.enabled;
	const adapter = options.adapter;

	return {
		canPersist: () => enabled && !!adapter,
		isReady: () => {
			if (!enabled) {
				return true;
			}

			if (!adapter) {
				return false;
			}

			return adapter.checkReadiness ? adapter.checkReadiness() : true;
		},
		persist: async (request, payload) => {
			if (!request?.enabled) {
				return {
					status: 'not_requested',
				};
			}

			if (!enabled || !adapter) {
				return {
					status: 'disabled',
				};
			}

			try {
				const saved = await adapter.save({
					runId: payload.runId,
					classification: payload.classification,
					enrichment: payload.enrichment,
					traceId: payload.traceId,
				});

				return {
					status: saved.status,
					recordId: saved.recordId,
				};
			} catch {
				return {
					status: 'failed',
				};
			}
		},
	};
}
