import { describe, expect, test } from 'bun:test';
import { formatId, formatRelativeTime, previewData } from './format';

describe('formatId', () => {
	test('truncates long protocol ids', () => {
		expect(formatId('0x85ec2459e7e53f0b0ba321c3a7d5ea849fc5cd9b0be0bd033c3342e0ed11f30d')).toBe(
			'0x85ec2459…f30d'
		);
	});

	test('leaves short ids alone', () => {
		expect(formatId('0x1234')).toBe('0x1234');
	});
});

describe('formatRelativeTime', () => {
	const now = new Date('2026-07-09T12:00:00Z');

	test('compact units', () => {
		expect(formatRelativeTime('2026-07-09T11:59:48Z', now)).toBe('12s');
		expect(formatRelativeTime('2026-07-09T11:55:00Z', now)).toBe('5m');
		expect(formatRelativeTime('2026-07-09T10:00:00Z', now)).toBe('2h');
		expect(formatRelativeTime('2026-07-06T12:00:00Z', now)).toBe('3d');
		expect(formatRelativeTime('2026-05-09T12:00:00Z', now)).toBe('2mo');
		expect(formatRelativeTime('2024-07-09T12:00:00Z', now)).toBe('2y');
	});

	test('future timestamps clamp to zero', () => {
		expect(formatRelativeTime('2026-07-09T12:00:05Z', now)).toBe('0s');
	});
});

describe('previewData', () => {
	test('flattens whitespace and truncates', () => {
		expect(previewData('a\n  b\t c')).toBe('a b c');
		expect(previewData('x'.repeat(200), 10)).toBe(`${'x'.repeat(10)}…`);
		expect(previewData(null)).toBe('');
	});
});
