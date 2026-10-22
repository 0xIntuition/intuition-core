import { expect, test } from 'bun:test';
import { redactProviderDiagnostic } from '../src/diagnostics';

const leaks: Array<[input: string, expected?: string]> = [
	[
		'HTTP 401 from https://user:SECRET@api.etherscan.io/api?apikey=SECRET#SECRET',
		'HTTP 401 from https://api.etherscan.io/api',
	],
	['GET //api.example.com/path?unknownCredential=SECRET', 'GET //api.example.com/path'],
	['GET api.example.com/path?unknownCredential=SECRET', 'GET api.example.com/path'],
	[
		'GET https://api.example.com/path?token=SECRET and https://other.example.com?key=SECRET',
		'GET https://api.example.com/path and https://other.example.com',
	],
	['https://api.etherscan.io/api%3Fapikey%3DSECRET', 'https://api.etherscan.io/api'],
	['api.example.com/path%23SECRET', 'api.example.com/path'],
	['localhost:8080/path?x=SECRET', 'localhost:8080/path'],
	['10.0.0.1:8080/path?x=SECRET', '10.0.0.1:8080/path'],
	['http://[::1]:8080/path?x=SECRET', 'http://[::1]:8080/path'],
	['u:SECRET@api.example.com/path', 'api.example.com/path'],
	['Authorization: Bearer SECRET', 'Authorization=[REDACTED]'],
	['authorization=Basic SECRET', 'authorization=[REDACTED]'],
	['Bearer SECRET', 'Bearer [REDACTED]'],
	['basic SECRETSECRET', 'basic [REDACTED]'],
	['{"Authorization": "Bearer SECRET", "apikey": "SECRET", "token": "SECRET", "key": "SECRET"}'],
	['\\"Authorization\\":\\"Bearer SECRET\\"'],
	["'api-key': 'SECRET' access_token=SECRET"],
	['apikey%3DSECRET', 'apikey=[REDACTED]'],
	['client_secret=SECRET&grant_type=refresh', 'client_secret=[REDACTED]&grant_type=refresh'],
	['password=SECRET', 'password=[REDACTED]'],
	['session=SECRET; other=1', 'session=[REDACTED]; other=1'],
	['x-api-key: SECRET', 'x-api-key=[REDACTED]'],
	['signature=SECRET', 'signature=[REDACTED]'],
	['cookie: session_id=SECRET'],
	[
		'HTTP 500 from https://api.example.com/path?padding=' + 'x'.repeat(1100) + '&apikey=SECRET',
		'HTTP 500 from https://api.example.com/path',
	],
];

for (const [input, expected] of leaks) {
	test(`redacts: ${input.slice(0, 72)}`, () => {
		const output = redactProviderDiagnostic(input);
		expect(output).not.toContain('SECRET');
		expect(output).not.toContain('?');
		if (expected !== undefined) {
			expect(output).toBe(expected);
		}
	});
}

for (const prose of [
	'Rate limited by OpenLibrary (HTTP 429).',
	'HTTP 404 from https://api.example.com/v1/items/42',
	'Unexpected end of JSON input',
	'Provider returned 3 candidates; none matched the identifier.',
	'Basic auth is not supported.',
	'Is the record public? Retry later.',
]) {
	test(`keeps prose: ${prose}`, () => {
		expect(redactProviderDiagnostic(prose)).toBe(prose);
	});
}

test('is idempotent', () => {
	const once = redactProviderDiagnostic(
		'Authorization: Bearer SECRET https://h.example/p?k=SECRET'
	);
	expect(redactProviderDiagnostic(once)).toBe(once);
});
