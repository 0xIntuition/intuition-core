import type { Logger } from './logger';

type TimerHandle = ReturnType<typeof setInterval>;

export type HeartbeatSnapshot = {
	service: string;
	status: string;
	lastBeatAt: string;
	lastBeatAtMs: number;
	ageMs: number;
};

export class Heartbeat {
	private lastBeatAt: number;
	private status = 'starting';

	constructor(
		private readonly service: string,
		private readonly now: () => number = Date.now
	) {
		this.lastBeatAt = this.now();
	}

	beat(status = 'alive'): void {
		this.lastBeatAt = this.now();
		this.status = status;
	}

	snapshot(now = this.now()): HeartbeatSnapshot {
		return {
			service: this.service,
			status: this.status,
			lastBeatAt: new Date(this.lastBeatAt).toISOString(),
			lastBeatAtMs: this.lastBeatAt,
			ageMs: Math.max(0, now - this.lastBeatAt),
		};
	}
}

export function startHeartbeatWatchdog(input: {
	heartbeat: Heartbeat;
	logger: Logger;
	signal: AbortSignal;
	intervalMs: number;
	timeoutMs: number;
	onTimeout?: (ageMs: number) => void;
	onRecovery?: (ageMs: number) => void;
	setIntervalFn?: (callback: () => void, ms: number) => TimerHandle;
	clearIntervalFn?: (handle: TimerHandle) => void;
}): () => void {
	const setIntervalFn = input.setIntervalFn ?? setInterval;
	const clearIntervalFn = input.clearIntervalFn ?? clearInterval;
	let timedOut = false;

	const check = () => {
		if (input.signal.aborted) {
			stop();
			return;
		}
		const snapshot = input.heartbeat.snapshot();
		if (snapshot.ageMs < input.timeoutMs) {
			if (timedOut) {
				timedOut = false;
				input.logger.info('worker heartbeat watchdog recovered', {
					service: snapshot.service,
					status: snapshot.status,
					ageMs: snapshot.ageMs,
					timeoutMs: input.timeoutMs,
				});
				input.onRecovery?.(snapshot.ageMs);
			}
			return;
		}
		if (timedOut) {
			return;
		}
		timedOut = true;
		input.logger.error('worker heartbeat watchdog timed out', {
			service: snapshot.service,
			status: snapshot.status,
			ageMs: snapshot.ageMs,
			timeoutMs: input.timeoutMs,
		});
		input.onTimeout?.(snapshot.ageMs);
	};

	const timer = setIntervalFn(check, input.intervalMs);
	const stop = () => clearIntervalFn(timer);
	input.signal.addEventListener('abort', stop, { once: true });
	return () => {
		input.signal.removeEventListener('abort', stop);
		stop();
	};
}
