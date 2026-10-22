import { expect, test } from 'bun:test';
import { boundEnrichmentDiagnostics } from './enrichment';

for (const message of [
	'HTTP 401 from https://user:SECRET@api.etherscan.io/api?apikey=SECRET#SECRET',
	'GET //api.example.com/path?unknownCredential=SECRET',
	'GET api.example.com/path?unknownCredential=SECRET',
	'GET https://api.example.com/path?token=SECRET and https://other.example.com?key=SECRET',
	'Authorization: Bearer SECRET',
	'authorization=Basic SECRET',
	'{"Authorization": "Bearer SECRET", "apikey": "SECRET", "token": "SECRET", "key": "SECRET"}',
	"'api-key': 'SECRET' access_token=SECRET",
]) {
	test(`bounds and redacts provider diagnostics: ${message}`, () => {
		const input = {
			errors: [
				{ pluginId: 'etherscan', code: 'upstream_error' as const, message, retriable: true },
			],
			skipped: [{ pluginId: 'etherscan', reason: message }],
		};
		const result = boundEnrichmentDiagnostics(input);
		expect(JSON.stringify(result)).not.toContain('SECRET');
		expect(JSON.stringify(result)).not.toContain('?');
		expect(input.errors[0]!.message).toBe(message);
	});
}

test('redacts before truncation and bounds provider fan-out', () => {
	const message = `HTTP 500 from https://api.example.com/path?padding=${'x'.repeat(1100)}&apikey=SECRET`;
	const result = boundEnrichmentDiagnostics({
		errors: Array.from({ length: 30 }, () => ({
			pluginId: 'etherscan',
			code: 'upstream_error' as const,
			message,
			retriable: true,
		})),
		skipped: Array.from({ length: 30 }, () => ({
			pluginId: 'etherscan',
			reason: 'x'.repeat(1100),
		})),
	});
	expect(result).toMatchObject({
		totalErrors: 30,
		totalSkipped: 30,
		errorsTruncated: true,
		skippedTruncated: true,
	});
	expect(result.errors).toHaveLength(25);
	expect(result.skipped).toHaveLength(25);
	expect(result.errors[0]!.message).toBe('HTTP 500 from https://api.example.com/path');
	expect(result.skipped[0]!.reason).toHaveLength(256);
});
