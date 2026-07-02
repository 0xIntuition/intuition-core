import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from '../src/rate-limit';

describe('createRateLimiter', () => {
	test('allows up to the limit, then blocks with retry-after', () => {
		let now = 1_000_000;
		const limiter = createRateLimiter(() => now);

		for (let i = 0; i < 3; i++) {
			expect(limiter.check('key:a', 3).allowed).toBe(true);
		}
		const blocked = limiter.check('key:a', 3);
		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(0);
		expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

		// window rolls over → allowed again
		now += 60_001;
		expect(limiter.check('key:a', 3).allowed).toBe(true);
	});

	test('buckets are independent', () => {
		const limiter = createRateLimiter(() => 0);
		expect(limiter.check('key:a', 1).allowed).toBe(true);
		expect(limiter.check('key:a', 1).allowed).toBe(false);
		expect(limiter.check('key:b', 1).allowed).toBe(true);
	});

	test('limit 0 means unlimited', () => {
		const limiter = createRateLimiter(() => 0);
		for (let i = 0; i < 1_000; i++) {
			expect(limiter.check('key:a', 0).allowed).toBe(true);
		}
	});
});
