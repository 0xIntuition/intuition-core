import { describe, expect, test } from 'bun:test';
import { API_KEY_PREFIX, bearerToken, sha256Hex } from '../src/auth';

describe('bearerToken', () => {
	test('extracts a well-formed api key', () => {
		expect(bearerToken(`Bearer ${API_KEY_PREFIX}abc123`)).toBe(`${API_KEY_PREFIX}abc123`);
	});

	test('rejects missing/malformed headers and foreign token shapes', () => {
		expect(bearerToken(undefined)).toBeNull();
		expect(bearerToken('')).toBeNull();
		expect(bearerToken('Basic dXNlcjpwYXNz')).toBeNull();
		expect(bearerToken('Bearer some-jwt-looking-thing')).toBeNull();
	});
});

describe('sha256Hex', () => {
	test('matches the known SHA-256 vector', async () => {
		// echo -n "abc" | shasum -a 256
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	test('is stable and hex-shaped', async () => {
		const h = await sha256Hex('ik_test');
		expect(h).toBe(await sha256Hex('ik_test'));
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});
});
