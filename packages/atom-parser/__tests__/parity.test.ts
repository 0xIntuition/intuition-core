import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { parseAtom } from '../src/parse.ts';
import { ParseError, type ParseOptions, type ParseResult } from '../src/types.ts';

type FixtureFile = {
	localCases: SuccessFixture[];
	remoteCases: SuccessFixture[];
	errorCases: ErrorFixture[];
};

type SuccessFixture = {
	name: string;
	input: string;
	options?: Record<string, unknown>;
	expected: CanonicalResult;
};

type ErrorFixture = {
	name: string;
	input: string;
	options?: Record<string, unknown>;
	expectedError: {
		code: string;
		message: string;
	};
};

type CanonicalResult = {
	kind: string;
	normalizedInput: string;
	data: Record<string, unknown>;
	remote: Record<string, unknown> | null;
	warnings: Array<{ code: string; message: string }>;
};

const fixtures = (await Bun.file(
	new URL('./fixtures/atom-parser-contract-fixtures.json', import.meta.url)
).json()) as FixtureFile;

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);

			if (url.pathname === '/page') {
				return new Response('<html><body>ok</body></html>', {
					headers: { 'content-type': 'text/html' },
				});
			}

			if (url.pathname === '/data') {
				return new Response('{"ok":true}', {
					headers: { 'content-type': 'application/json' },
				});
			}

			if (url.pathname === '/json-no-ct') {
				return new Response(
					new Uint8Array([
						0x5b, 0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d, 0x5d,
					])
				);
			}

			if (url.pathname === '/html-no-ct') {
				return new Response(
					new Uint8Array([
						0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e, 0x3c, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0x6f, 0x6b,
						0x3c, 0x2f, 0x62, 0x6f, 0x64, 0x79, 0x3e, 0x3c, 0x2f, 0x68, 0x74, 0x6d, 0x6c, 0x3e,
					])
				);
			}

			if (url.pathname === '/image-sniffed') {
				return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
			}

			if (url.pathname === '/audio-sniffed') {
				return new Response(
					new Uint8Array([0x49, 0x44, 0x33, 0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64])
				);
			}

			if (url.pathname === '/empty') {
				return new Response(null);
			}

			if (url.pathname === '/text-file') {
				return new Response('plain text payload', {
					headers: { 'content-type': 'text/plain' },
				});
			}

			if (url.pathname === '/step-1') {
				return new Response(null, {
					status: 302,
					headers: { location: '/step-2' },
				});
			}

			if (url.pathname === '/step-2') {
				return new Response(null, {
					status: 302,
					headers: { location: '/step-3' },
				});
			}

			if (url.pathname === '/broken-redirect') {
				return new Response(null, { status: 302 });
			}

			if (url.pathname === '/big') {
				return new Response('this response is larger than eight bytes', {
					headers: { 'content-type': 'text/plain' },
				});
			}

			if (url.pathname === '/slow') {
				return new Promise((resolve) => {
					setTimeout(() => resolve(new Response('slow body')), 100);
				});
			}

			if (url.pathname === '/redirect') {
				return new Response(null, {
					status: 302,
					headers: { location: '/final' },
				});
			}

			if (url.pathname === '/final') {
				return new Response('', {
					headers: { 'content-type': 'image/png' },
				});
			}

			if (url.pathname.startsWith('/ipfs/')) {
				return new Response('', {
					headers: { 'content-type': 'audio/mpeg' },
				});
			}

			return new Response('not found', { status: 404 });
		},
	});
	baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
	server.stop();
});

describe('contract parity fixtures', () => {
	for (const fixture of fixtures.localCases) {
		it(`matches local fixture ${fixture.name}`, async () => {
			const result = await parseAtom(
				resolveTemplates(fixture.input),
				resolveOptions(fixture.options) as ParseOptions
			);
			expect(toCanonicalResult(result)).toEqual(resolveTemplates(fixture.expected));
		});
	}

	for (const fixture of fixtures.remoteCases) {
		it(`matches remote fixture ${fixture.name}`, async () => {
			const result = await parseAtom(
				resolveTemplates(fixture.input),
				resolveOptions(fixture.options) as ParseOptions
			);
			expect(toCanonicalResult(result)).toEqual(resolveTemplates(fixture.expected));
		});
	}

	for (const fixture of fixtures.errorCases) {
		it(`matches error fixture ${fixture.name}`, async () => {
			try {
				await parseAtom(
					resolveTemplates(fixture.input),
					resolveOptions(fixture.options) as ParseOptions
				);
				expect.unreachable('expected parseAtom to throw');
			} catch (error) {
				expect(error).toBeInstanceOf(ParseError);
				expect({
					code: (error as ParseError).code,
					message: (error as ParseError).message,
				}).toEqual(fixture.expectedError);
			}
		});
	}
});

function resolveOptions(options: Record<string, unknown> | undefined): Record<string, unknown> {
	return resolveTemplates(options ?? {});
}

function resolveTemplates<T>(value: T): T {
	return JSON.parse(JSON.stringify(value).replaceAll('{{BASE_URL}}', baseUrl)) as T;
}

function toCanonicalResult(result: ParseResult): CanonicalResult {
	return {
		kind: result.kind,
		normalizedInput: result.normalizedInput,
		data: extractKindData(result),
		remote:
			'remote' in result && result.remote
				? {
						attempted: result.remote.attempted,
						outcome: result.remote.outcome,
						finalUrl: result.remote.finalUrl ?? null,
						statusCode: result.remote.statusCode ?? null,
						contentType: result.remote.contentType ?? null,
						redirectCount: result.remote.redirectCount,
						subtype: result.remote.subtype ?? null,
						reason: result.remote.reason ?? null,
					}
				: null,
		warnings: result.warnings.map((warning) => ({
			code: warning.code,
			message: warning.message,
		})),
	};
}

function extractKindData(result: ParseResult): Record<string, unknown> {
	switch (result.kind) {
		case 'ipfs':
			return {
				canonicalUri: result.canonicalUri,
				cid: result.cid,
				path: result.path ?? null,
				gatewayUrl: result.gatewayUrl ?? null,
			};
		case 'ethereum_address':
			return {
				address: result.address,
				checksumAddress: result.checksumAddress,
			};
		case 'ens_name':
			return {
				name: result.name,
			};
		case 'json':
			return {
				topLevelType: result.topLevelType,
				objectKeyCount: result.objectKeyCount ?? null,
				arrayLength: result.arrayLength ?? null,
			};
		case 'url':
			return {
				canonicalUrl: result.canonicalUrl,
				scheme: result.scheme,
				host: result.host ?? null,
				path: result.path,
				hasQuery: result.hasQuery,
			};
		case 'isbn':
			return {
				canonical: result.canonical,
				format: result.format,
				checksumValid: result.checksumValid,
			};
		case 'plain_string':
			return {
				original: result.original,
				trimmed: result.trimmed,
			};
	}
}
