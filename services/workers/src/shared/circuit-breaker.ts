export type CircuitState = 'closed' | 'open' | 'half_open';

export class CircuitOpenError extends Error {
	constructor(readonly circuitName: string) {
		super(`Circuit ${circuitName} is open.`);
		this.name = 'CircuitOpenError';
	}
}

export class CircuitBreaker {
	private state: CircuitState = 'closed';
	private failures = 0;
	private openedAt: number | undefined;
	private halfOpenInflight = false;

	constructor(
		private readonly input: {
			name: string;
			failureThreshold: number;
			resetAfterMs: number;
			now?: () => number;
			shouldRecordFailure?: (error: unknown) => boolean;
		}
	) {}

	async execute<T>(run: () => Promise<T>): Promise<T> {
		this.assertCanRun();
		try {
			const result = await run();
			this.recordSuccess();
			return result;
		} catch (error) {
			if (this.input.shouldRecordFailure?.(error) ?? true) {
				this.recordFailure();
			} else {
				this.recordSuccess();
			}
			throw error;
		}
	}

	snapshot() {
		const now = this.now();
		return {
			name: this.input.name,
			state: this.state,
			failures: this.failures,
			openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : undefined,
			openForMs: this.openedAt ? now - this.openedAt : 0,
			resetAfterMs: this.input.resetAfterMs,
			failureThreshold: this.input.failureThreshold,
		};
	}

	private assertCanRun(): void {
		if (this.state === 'closed') {
			return;
		}

		if (this.state === 'open') {
			if (this.openedAt === undefined || this.now() - this.openedAt < this.input.resetAfterMs) {
				throw new CircuitOpenError(this.input.name);
			}
			this.state = 'half_open';
			this.failures = 0;
		}

		if (this.halfOpenInflight) {
			throw new CircuitOpenError(this.input.name);
		}
		this.halfOpenInflight = true;
	}

	private recordSuccess(): void {
		this.state = 'closed';
		this.failures = 0;
		this.openedAt = undefined;
		this.halfOpenInflight = false;
	}

	private recordFailure(): void {
		if (this.state === 'half_open') {
			this.failures = 1;
			this.open();
			return;
		}

		this.failures += 1;
		if (this.failures >= this.input.failureThreshold) {
			this.open();
		}
	}

	private open(): void {
		this.state = 'open';
		this.openedAt = this.now();
		this.halfOpenInflight = false;
	}

	private now(): number {
		return this.input.now?.() ?? Date.now();
	}
}
