import { describe, expect, it } from 'bun:test';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

describe('CircuitBreaker', () => {
	it('opens after the configured failure threshold', async () => {
		const circuit = new CircuitBreaker({
			name: 'unit-circuit',
			failureThreshold: 2,
			resetAfterMs: 1_000,
		});

		await expect(
			circuit.execute(async () => {
				throw new Error('timeout');
			})
		).rejects.toThrow('timeout');
		await expect(
			circuit.execute(async () => {
				throw new Error('timeout');
			})
		).rejects.toThrow('timeout');

		expect(circuit.snapshot().state).toBe('open');
		await expect(circuit.execute(async () => {})).rejects.toBeInstanceOf(CircuitOpenError);
	});

	it('does not record failures rejected by the caller predicate', async () => {
		const circuit = new CircuitBreaker({
			name: 'unit-circuit',
			failureThreshold: 1,
			resetAfterMs: 1_000,
			shouldRecordFailure: (error) => error instanceof Error && error.message === 'dependency down',
		});

		await expect(
			circuit.execute(async () => {
				throw new Error('bad item payload');
			})
		).rejects.toThrow('bad item payload');

		expect(circuit.snapshot().state).toBe('closed');
		expect(circuit.snapshot().failures).toBe(0);

		await expect(
			circuit.execute(async () => {
				throw new Error('dependency down');
			})
		).rejects.toThrow('dependency down');

		expect(circuit.snapshot().state).toBe('open');
	});

	it('moves to half-open after reset and closes on success', async () => {
		let now = 0;
		const circuit = new CircuitBreaker({
			name: 'unit-circuit',
			failureThreshold: 1,
			resetAfterMs: 1_000,
			now: () => now,
		});

		await expect(
			circuit.execute(async () => {
				throw new Error('timeout');
			})
		).rejects.toThrow('timeout');
		now = 1_001;
		await circuit.execute(async () => {
			expect(circuit.snapshot().state).toBe('half_open');
			expect(circuit.snapshot().failures).toBe(0);
		});

		expect(circuit.snapshot().state).toBe('closed');
		expect(circuit.snapshot().failures).toBe(0);
	});

	it('closes a half-open probe when the failure should not count against the circuit', async () => {
		let now = 0;
		const circuit = new CircuitBreaker({
			name: 'unit-circuit',
			failureThreshold: 1,
			resetAfterMs: 1_000,
			now: () => now,
			shouldRecordFailure: (error) => error instanceof Error && error.message === 'dependency down',
		});

		await expect(
			circuit.execute(async () => {
				throw new Error('dependency down');
			})
		).rejects.toThrow('dependency down');
		now = 1_001;

		await expect(
			circuit.execute(async () => {
				expect(circuit.snapshot().state).toBe('half_open');
				throw new Error('bad item payload');
			})
		).rejects.toThrow('bad item payload');

		expect(circuit.snapshot().state).toBe('closed');
		expect(circuit.snapshot().failures).toBe(0);
		await circuit.execute(async () => {});
	});

	it('allows only one half-open probe at a time', async () => {
		let now = 0;
		const circuit = new CircuitBreaker({
			name: 'unit-circuit',
			failureThreshold: 1,
			resetAfterMs: 1_000,
			now: () => now,
		});

		await expect(
			circuit.execute(async () => {
				throw new Error('timeout');
			})
		).rejects.toThrow('timeout');
		now = 1_001;

		let resolveProbe: (() => void) | undefined;
		const probe = circuit.execute(
			() =>
				new Promise<void>((resolve) => {
					resolveProbe = resolve;
				})
		);

		await expect(circuit.execute(async () => {})).rejects.toBeInstanceOf(CircuitOpenError);
		resolveProbe?.();
		await probe;

		expect(circuit.snapshot().state).toBe('closed');
	});
});
