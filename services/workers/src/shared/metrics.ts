import type { CircuitBreaker } from './circuit-breaker';
import type { HeartbeatSnapshot } from './watchdog';

type MetricLabels = Record<string, string>;
type MetricSample = {
	name: string;
	labels: MetricLabels;
	value: number;
};

const COUNTER_HELP: Record<string, string> = {
	atom_workers_stage_total: 'Worker stage counters.',
	atom_workers_supervisor_restarts_total: 'Worker supervisor restart count.',
	atom_workers_watchdog_timeouts_total: 'Worker heartbeat watchdog timeout count.',
	atom_workers_dead_letter_total: 'Worker dead-lettered row count observed by this worker.',
};

const GAUGE_HELP: Record<string, string> = {
	atom_workers_inflight: 'Current number of in-flight worker tasks.',
	atom_workers_pending: 'Current number of queued worker tasks.',
	atom_workers_heartbeat_age_ms: 'Current worker heartbeat age in milliseconds.',
	atom_workers_last_heartbeat_ms: 'Unix timestamp of the last worker heartbeat in milliseconds.',
	atom_workers_watchdog_timed_out: 'Whether the worker heartbeat watchdog is currently timed out.',
	atom_workers_breaker_state:
		'Circuit breaker state set; active state is 1, inactive states are 0.',
	atom_workers_breaker_failures: 'Current circuit breaker failure count.',
	atom_workers_breaker_open_for_ms: 'Current circuit breaker open duration in milliseconds.',
	atom_workers_uptime_ms: 'Worker uptime in milliseconds.',
};

export class WorkerMetrics {
	private readonly startedAt = Date.now();
	private readonly counters = new Map<string, MetricSample>();
	private readonly gauges = new Map<string, MetricSample>();
	private readonly durations = new Map<string, { count: number; sumMs: number }>();

	increment(metric: string, stage: string, value = 1): void {
		this.incrementCounter('atom_workers_stage_total', { metric, stage }, value);
	}

	incrementSupervisorRestart(input: { worker: string; errorClass: string; value?: number }): void {
		this.incrementCounter(
			'atom_workers_supervisor_restarts_total',
			{ worker: input.worker, errorClass: input.errorClass },
			input.value ?? 1
		);
	}

	incrementWatchdogTimeout(worker: string, value = 1): void {
		this.incrementCounter('atom_workers_watchdog_timeouts_total', { worker }, value);
	}

	incrementDeadLetters(input: { worker: string; stage: string; value?: number }): void {
		this.incrementCounter(
			'atom_workers_dead_letter_total',
			{ worker: input.worker, stage: input.stage },
			input.value ?? 1
		);
	}

	recordDuration(metric: string, durationMs: number): void {
		const entry = this.durations.get(metric) ?? { count: 0, sumMs: 0 };
		entry.count += 1;
		entry.sumMs += Math.max(0, durationMs);
		this.durations.set(metric, entry);
	}

	setSchedulerDepth(input: {
		worker: string;
		stage: string;
		inflight: number;
		pending: number;
	}): void {
		const labels = { worker: input.worker, stage: input.stage };
		this.setGauge('atom_workers_inflight', labels, input.inflight);
		this.setGauge('atom_workers_pending', labels, input.pending);
	}

	setHeartbeat(worker: string, snapshot: HeartbeatSnapshot): void {
		this.setGauge('atom_workers_heartbeat_age_ms', { worker }, snapshot.ageMs);
		this.setGauge('atom_workers_last_heartbeat_ms', { worker }, snapshot.lastBeatAtMs);
	}

	setWatchdogTimedOut(worker: string, timedOut: boolean): void {
		this.setGauge('atom_workers_watchdog_timed_out', { worker }, timedOut ? 1 : 0);
	}

	setCircuitBreaker(input: {
		worker: string;
		dependency: string;
		snapshot: ReturnType<CircuitBreaker['snapshot']>;
	}): void {
		const labels = { worker: input.worker, dependency: input.dependency };
		for (const state of ['closed', 'open', 'half_open'] as const) {
			this.setGauge(
				'atom_workers_breaker_state',
				{ ...labels, state },
				input.snapshot.state === state ? 1 : 0
			);
		}
		this.setGauge('atom_workers_breaker_failures', labels, input.snapshot.failures);
		this.setGauge('atom_workers_breaker_open_for_ms', labels, input.snapshot.openForMs);
	}

	renderPrometheus(): string {
		this.setGauge('atom_workers_uptime_ms', {}, Date.now() - this.startedAt);

		const lines: string[] = [];
		this.renderSamples(lines, this.counters, 'counter', COUNTER_HELP);
		this.renderDurationSamples(lines);
		this.renderSamples(lines, this.gauges, 'gauge', GAUGE_HELP);

		return `${lines.join('\n')}\n`;
	}

	private incrementCounter(name: string, labels: MetricLabels, value: number): void {
		const key = sampleKey(name, labels);
		const current = this.counters.get(key);
		this.counters.set(key, {
			name,
			labels,
			value: (current?.value ?? 0) + value,
		});
	}

	private setGauge(name: string, labels: MetricLabels, value: number): void {
		this.gauges.set(sampleKey(name, labels), { name, labels, value });
	}

	private renderSamples(
		lines: string[],
		samples: Map<string, MetricSample>,
		type: 'counter' | 'gauge',
		help: Record<string, string>
	): void {
		const rendered = new Set<string>();
		for (const sample of samples.values()) {
			if (!rendered.has(sample.name)) {
				lines.push(
					`# HELP ${sample.name} ${help[sample.name] ?? 'Worker metric.'}`,
					`# TYPE ${sample.name} ${type}`
				);
				rendered.add(sample.name);
			}
			lines.push(`${sample.name}${formatLabels(sample.labels)} ${sample.value}`);
		}
	}

	private renderDurationSamples(lines: string[]): void {
		lines.push(
			'# HELP atom_workers_duration_ms_count Worker duration sample count.',
			'# TYPE atom_workers_duration_ms_count counter'
		);
		for (const [metric, value] of this.durations.entries()) {
			lines.push(`atom_workers_duration_ms_count{metric="${escapeLabel(metric)}"} ${value.count}`);
		}

		lines.push(
			'# HELP atom_workers_duration_ms_sum Worker duration sum in milliseconds.',
			'# TYPE atom_workers_duration_ms_sum counter'
		);
		for (const [metric, value] of this.durations.entries()) {
			lines.push(`atom_workers_duration_ms_sum{metric="${escapeLabel(metric)}"} ${value.sumMs}`);
		}
	}
}

function sampleKey(name: string, labels: MetricLabels): string {
	return `${name}|${Object.entries(labels)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join('|')}`;
}

function formatLabels(labels: MetricLabels): string {
	const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
	if (entries.length === 0) {
		return '';
	}
	return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function escapeLabel(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}
