import type {
	ProcessBatchItemResult,
	ProcessBatchStatusResponse,
	ProcessBatchSubmitRequest,
	ProcessBatchSubmitResponse,
	ProcessResponse,
} from '../contracts';

type BatchJobRecord = ProcessBatchStatusResponse;

type BatchProcessor = (
	input: ProcessBatchSubmitRequest['jobs'][number],
	context: { jobId: string; index: number }
) => Promise<ProcessResponse>;

export class InMemoryProcessBatchStore {
	private readonly jobs = new Map<string, BatchJobRecord>();
	private readonly now: () => Date;
	private readonly retainCompletedMs: number;

	constructor(options?: {
		now?: () => Date;
		retainCompletedMs?: number;
	}) {
		this.now = options?.now ?? (() => new Date());
		this.retainCompletedMs = Math.max(60_000, options?.retainCompletedMs ?? 3_600_000);
	}

	submit(input: ProcessBatchSubmitRequest, runJob: BatchProcessor): ProcessBatchSubmitResponse {
		this.cleanupExpiredCompletedJobs();

		const jobId = `batch-${this.now().getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
		const submittedAt = this.now().toISOString();
		const record: BatchJobRecord = {
			jobId,
			status: 'queued',
			submittedAt,
			total: input.jobs.length,
			completed: 0,
			results: [],
		};

		this.jobs.set(jobId, record);
		void this.executeJob(jobId, input.jobs, runJob);

		return {
			jobId,
			status: 'accepted',
			submittedAt,
			total: input.jobs.length,
		};
	}

	get(jobId: string): BatchJobRecord | undefined {
		return this.jobs.get(jobId);
	}

	private async executeJob(
		jobId: string,
		jobs: ProcessBatchSubmitRequest['jobs'],
		runJob: BatchProcessor
	): Promise<void> {
		const record = this.jobs.get(jobId);
		if (!record) {
			return;
		}

		record.status = 'running';
		record.startedAt = this.now().toISOString();

		const results: ProcessBatchItemResult[] = [];
		for (let index = 0; index < jobs.length; index += 1) {
			const entry = jobs[index];
			if (!entry) {
				continue;
			}

			try {
				const response = await runJob(entry, {
					jobId,
					index,
				});
				results.push({
					index,
					status: response.status,
					response,
				});
			} catch (error) {
				results.push({
					index,
					status: 'failed',
					response: null,
					error: {
						code: 'BATCH_ITEM_FAILED',
						message: error instanceof Error ? error.message : 'Batch item execution failed.',
					},
				});
			}

			record.completed = results.length;
			record.results = results.slice();
		}

		record.finishedAt = this.now().toISOString();
		record.status = resolveBatchStatus(results, record.total);
		record.results = results;
	}

	private cleanupExpiredCompletedJobs(): void {
		const nowMs = this.now().getTime();
		for (const [jobId, record] of this.jobs.entries()) {
			if (!record.finishedAt) {
				continue;
			}

			const ageMs = nowMs - new Date(record.finishedAt).getTime();
			if (ageMs > this.retainCompletedMs) {
				this.jobs.delete(jobId);
			}
		}
	}
}

function resolveBatchStatus(
	results: ProcessBatchItemResult[],
	total: number
): BatchJobRecord['status'] {
	const failedCount = results.filter((result) => result.status === 'failed').length;
	const partialCount = results.filter((result) => result.status === 'partial').length;

	if (failedCount >= total) {
		return 'failed';
	}

	if (failedCount > 0 || partialCount > 0) {
		return 'partial';
	}

	return 'complete';
}
