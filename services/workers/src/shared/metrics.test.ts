import { describe, expect, it } from 'bun:test';
import { CircuitBreaker } from './circuit-breaker';
import { WorkerMetrics } from './metrics';

describe('WorkerMetrics', () => {
	it('renders concrete Prometheus series for runtime visibility', () => {
		const metrics = new WorkerMetrics();
		const circuit = new CircuitBreaker({
			name: 'kg-parse-worker:database-kg',
			failureThreshold: 3,
			resetAfterMs: 60_000,
			now: () => 1_000,
		});

		metrics.increment('completed', 'parse');
		metrics.setSchedulerDepth({
			worker: 'kg-parse-worker',
			stage: 'parse',
			inflight: 2,
			pending: 1,
		});
		metrics.setHeartbeat('kg-parse-worker', {
			service: 'kg-parse-worker',
			status: 'kg-parse-reconcile',
			lastBeatAt: new Date(750).toISOString(),
			lastBeatAtMs: 750,
			ageMs: 250,
		});
		metrics.setCircuitBreaker({
			worker: 'kg-parse-worker',
			dependency: 'database-kg',
			snapshot: circuit.snapshot(),
		});
		metrics.incrementSupervisorRestart({
			worker: 'kg-parse-worker',
			errorClass: 'circuitProtected',
		});
		metrics.incrementWatchdogTimeout('kg-parse-worker');
		metrics.setWatchdogTimedOut('kg-parse-worker', true);
		metrics.incrementDeadLetters({ worker: 'kg-parse-worker', stage: 'parse' });

		const rendered = metrics.renderPrometheus();

		expect(rendered).toContain('atom_workers_stage_total{metric="completed",stage="parse"} 1');
		expect(rendered).toContain('atom_workers_inflight{stage="parse",worker="kg-parse-worker"} 2');
		expect(rendered).toContain('atom_workers_pending{stage="parse",worker="kg-parse-worker"} 1');
		expect(rendered).toContain('atom_workers_heartbeat_age_ms{worker="kg-parse-worker"} 250');
		expect(rendered).toContain(
			'atom_workers_breaker_state{dependency="database-kg",state="closed",worker="kg-parse-worker"} 1'
		);
		expect(rendered).toContain(
			'atom_workers_supervisor_restarts_total{errorClass="circuitProtected",worker="kg-parse-worker"} 1'
		);
		expect(rendered).toContain('atom_workers_watchdog_timeouts_total{worker="kg-parse-worker"} 1');
		expect(rendered).toContain(
			'atom_workers_dead_letter_total{stage="parse",worker="kg-parse-worker"} 1'
		);
		expect(rendered).not.toContain('atom_workers_stage_gauge');
	});

	it('escapes Prometheus label newlines', () => {
		const metrics = new WorkerMetrics();

		metrics.increment('bad\nmetric', 'bad\nstage');

		expect(metrics.renderPrometheus()).toContain(
			'atom_workers_stage_total{metric="bad\\nmetric",stage="bad\\nstage"} 1'
		);
	});
});
