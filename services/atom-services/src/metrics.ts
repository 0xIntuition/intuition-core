import type { EnrichmentRunResult } from '@0xintuition/atom-enrichment';

type HttpMetricKey = `${string}|${string}|${number}`;

type DurationMetric = {
	count: number;
	sumMs: number;
};

export class MetricsRegistry {
	private readonly startedAt = Date.now();
	private readonly httpRequests = new Map<HttpMetricKey, number>();
	private readonly httpDurations = new Map<HttpMetricKey, DurationMetric>();
	private readonly processOutcomes = new Map<string, number>();
	private readonly pluginOutcomes = new Map<string, number>();

	recordHttpRequest(path: string, method: string, status: number, durationMs: number): void {
		const key = this.toHttpKey(path, method, status);
		this.httpRequests.set(key, (this.httpRequests.get(key) ?? 0) + 1);

		const durationEntry = this.httpDurations.get(key) ?? { count: 0, sumMs: 0 };
		durationEntry.count += 1;
		durationEntry.sumMs += Math.max(0, durationMs);
		this.httpDurations.set(key, durationEntry);
	}

	recordProcessOutcome(status: 'success' | 'partial' | 'failed'): void {
		this.processOutcomes.set(status, (this.processOutcomes.get(status) ?? 0) + 1);
	}

	recordPluginOutcomes(result: EnrichmentRunResult | null): void {
		if (!result) {
			return;
		}

		const successCount = result.artifacts.length;
		const failureCount = result.errors.length;
		const skippedCount = result.skipped.length;

		this.pluginOutcomes.set('success', (this.pluginOutcomes.get('success') ?? 0) + successCount);
		this.pluginOutcomes.set('failed', (this.pluginOutcomes.get('failed') ?? 0) + failureCount);
		this.pluginOutcomes.set('skipped', (this.pluginOutcomes.get('skipped') ?? 0) + skippedCount);
	}

	uptimeMs(): number {
		return Date.now() - this.startedAt;
	}

	renderPrometheus(): string {
		const lines: string[] = [];

		lines.push(
			'# HELP atomsvc_http_requests_total Total HTTP requests handled by atom services.',
			'# TYPE atomsvc_http_requests_total counter'
		);
		for (const [key, value] of this.httpRequests.entries()) {
			const [path, method, status] = key.split('|');
			lines.push(
				`atomsvc_http_requests_total{path="${escapeLabel(path)}",method="${escapeLabel(method)}",status="${escapeLabel(status ?? '0')}"} ${value}`
			);
		}

		lines.push(
			'# HELP atomsvc_http_duration_ms_count Number of HTTP request timings recorded.',
			'# TYPE atomsvc_http_duration_ms_count counter'
		);
		for (const [key, value] of this.httpDurations.entries()) {
			const [path, method, status] = key.split('|');
			lines.push(
				`atomsvc_http_duration_ms_count{path="${escapeLabel(path)}",method="${escapeLabel(method)}",status="${escapeLabel(status ?? '0')}"} ${value.count}`
			);
		}

		lines.push(
			'# HELP atomsvc_http_duration_ms_sum Sum of HTTP request durations in milliseconds.',
			'# TYPE atomsvc_http_duration_ms_sum counter'
		);
		for (const [key, value] of this.httpDurations.entries()) {
			const [path, method, status] = key.split('|');
			lines.push(
				`atomsvc_http_duration_ms_sum{path="${escapeLabel(path)}",method="${escapeLabel(method)}",status="${escapeLabel(status ?? '0')}"} ${value.sumMs}`
			);
		}

		lines.push(
			'# HELP atomsvc_process_runs_total Process endpoint outcomes by status.',
			'# TYPE atomsvc_process_runs_total counter'
		);
		for (const [status, value] of this.processOutcomes.entries()) {
			lines.push(`atomsvc_process_runs_total{status="${escapeLabel(status)}"} ${value}`);
		}

		lines.push(
			'# HELP atomsvc_plugin_outcomes_total Plugin outcomes aggregated by result type.',
			'# TYPE atomsvc_plugin_outcomes_total counter'
		);
		for (const [outcome, value] of this.pluginOutcomes.entries()) {
			lines.push(`atomsvc_plugin_outcomes_total{outcome="${escapeLabel(outcome)}"} ${value}`);
		}

		lines.push(
			'# HELP atomsvc_uptime_ms Service uptime in milliseconds.',
			'# TYPE atomsvc_uptime_ms gauge',
			`atomsvc_uptime_ms ${this.uptimeMs()}`
		);

		return `${lines.join('\n')}\n`;
	}

	private toHttpKey(path: string, method: string, status: number): HttpMetricKey {
		return `${path}|${method}|${status}`;
	}
}

function escapeLabel(value: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
