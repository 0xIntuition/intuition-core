import { describe, expect, test } from 'bun:test';
import { loadConfig, parseBooleanFlag } from '../src/config';

describe('semantic atom read configuration', () => {
	test('is default-off', () => {
		expect(loadConfig({ DATABASE_KG_URL: 'postgres://test' }).atomSemanticReadsEnabled).toBe(false);
	});

	test('accepts explicit boolean values', () => {
		for (const value of ['true', 'TRUE', '1']) {
			expect(parseBooleanFlag(value, 'FLAG')).toBe(true);
		}
		for (const value of ['false', 'FALSE', '0', '', undefined]) {
			expect(parseBooleanFlag(value, 'FLAG')).toBe(false);
		}
	});

	test('rejects ambiguous values instead of accidentally enabling exposure', () => {
		expect(() => parseBooleanFlag('yes', 'FLAG')).toThrow('FLAG must be true, false, 1, or 0');
	});
});
