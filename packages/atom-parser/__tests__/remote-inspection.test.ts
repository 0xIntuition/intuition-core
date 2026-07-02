import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { parseAtom } from '../src/parse.ts';
import { classifyRemoteKind } from '../src/remote.ts';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch(req) {
			const url = new URL(req.url);
			const path = url.pathname;

			if (path === '/page') {
				return new Response('<html><body>ok</body></html>', {
					headers: { 'content-type': 'text/html' },
				});
			}
			if (path === '/data') {
				return new Response('{"ok":true}', {
					headers: { 'content-type': 'application/json' },
				});
			}
			if (path === '/schema') {
				return new Response(
					'{"@context":"https://schema.org","@type":"MusicRecording","url":"https://example.com/track"}',
					{
						headers: { 'content-type': 'application/ld+json' },
					}
				);
			}
			if (path === '/schema-no-url') {
				return new Response('{"@context":"https://schema.org","@type":"WebSite"}', {
					headers: { 'content-type': 'application/ld+json' },
				});
			}
			if (path === '/html-no-ct') {
				return new Response('<html><body>ok</body></html>');
			}
			if (path === '/json-no-ct') {
				return new Response('[{"ok":true}]');
			}
			if (path === '/clip') {
				return new Response('', { headers: { 'content-type': 'video/mp4' } });
			}
			if (path === '/audio-ct') {
				return new Response('', { headers: { 'content-type': 'audio/mpeg' } });
			}
			if (path === '/image-png') {
				const body = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
				return new Response(body, {
					headers: { 'content-type': 'application/octet-stream' },
				});
			}
			if (path === '/audio-id3') {
				const body = new Uint8Array([0x49, 0x44, 0x33, 0x70, 0x61, 0x79, 0x6c, 0x6f, 0x61, 0x64]);
				return new Response(body, {
					headers: { 'content-type': 'application/octet-stream' },
				});
			}
			if (path === '/text-plain') {
				return new Response('just some text', {
					headers: { 'content-type': 'text/plain' },
				});
			}
			if (path === '/empty') {
				return new Response('');
			}
			if (path === '/redirect') {
				return new Response(null, {
					status: 302,
					headers: { location: '/final' },
				});
			}
			if (path === '/final') {
				return new Response('', { headers: { 'content-type': 'image/png' } });
			}
			if (path === '/step-1') {
				return new Response(null, {
					status: 302,
					headers: { location: '/step-2' },
				});
			}
			if (path === '/step-2') {
				return new Response(null, {
					status: 302,
					headers: { location: '/step-3' },
				});
			}
			if (path === '/step-3') {
				return new Response(null, {
					status: 302,
					headers: { location: '/step-final' },
				});
			}
			if (path === '/broken-redirect') {
				return new Response(null, { status: 302 });
			}
			if (path === '/big') {
				return new Response('x'.repeat(2048));
			}
			if (
				path === '/ipfs/bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e/metadata.json'
			) {
				return new Response(
					'{"@context":"https://schema.org","@type":"MusicRecording","url":"https://example.com/track"}',
					{
						headers: { 'content-type': 'application/ld+json' },
					}
				);
			}
			if (path.startsWith('/ipfs/')) {
				return new Response('', { headers: { 'content-type': 'audio/mpeg' } });
			}
			return new Response('not found', { status: 404 });
		},
	});
	baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
	server.stop();
});

const remoteOpts = (extra?: Record<string, unknown>) => ({
	remoteFetch: true,
	allowHttp: true,
	allowPrivateNetworks: true,
	requestTimeoutMs: 5_000,
	...extra,
});

describe('remote inspection: content-type classification', () => {
	it('detects webpage via text/html', async () => {
		const result = await parseAtom(`${baseUrl}/page`, remoteOpts());
		expect(result.remote?.outcome).toBe('success');
		expect(result.remote?.subtype).toBe('webpage');
	});

	it('detects JSON document via application/json', async () => {
		const result = await parseAtom(`${baseUrl}/data`, remoteOpts());
		expect(result.remote?.subtype).toBe('json_document');
	});

	it('detects JSON document from +json content type', async () => {
		const result = await parseAtom(`${baseUrl}/schema`, remoteOpts());
		expect(result.remote?.subtype).toBe('json_document');
		if (result.kind === 'url') {
			expect(result.structuredDocument?.source).toBe('resolved_url');
			expect(result.structuredDocument?.schemaType).toBe('MusicRecording');
			expect(result.structuredDocument?.urlCandidates[0]?.url).toBe('https://example.com/track');
		}
	});

	it('detects video via video/mp4', async () => {
		const result = await parseAtom(`${baseUrl}/clip`, remoteOpts());
		expect(result.remote?.subtype).toBe('video');
	});

	it('detects audio via audio/mpeg', async () => {
		const result = await parseAtom(`${baseUrl}/audio-ct`, remoteOpts());
		expect(result.remote?.subtype).toBe('audio');
	});
});

describe('remote inspection: body sniffing', () => {
	it('sniffs HTML without content-type', async () => {
		const result = await parseAtom(`${baseUrl}/html-no-ct`, remoteOpts());
		expect(result.remote?.subtype).toBe('webpage');
	});

	it('sniffs JSON without content-type', async () => {
		const result = await parseAtom(`${baseUrl}/json-no-ct`, remoteOpts());
		expect(result.remote?.subtype).toBe('json_document');
	});

	it('sniffs PNG from octet-stream', async () => {
		const result = await parseAtom(`${baseUrl}/image-png`, remoteOpts());
		expect(result.remote?.subtype).toBe('image');
	});

	it('sniffs ID3 audio from octet-stream', async () => {
		const result = await parseAtom(`${baseUrl}/audio-id3`, remoteOpts());
		expect(result.remote?.subtype).toBe('audio');
	});

	it('classifies plain text as generic_file', async () => {
		const result = await parseAtom(`${baseUrl}/text-plain`, remoteOpts());
		expect(result.remote?.subtype).toBe('generic_file');
	});

	it('classifies empty body as unknown_remote', async () => {
		const result = await parseAtom(`${baseUrl}/empty`, remoteOpts());
		expect(result.remote?.subtype).toBe('unknown_remote');
	});
});

describe('remote inspection: redirects', () => {
	it('follows redirects', async () => {
		const result = await parseAtom(`${baseUrl}/redirect`, remoteOpts());
		expect(result.remote?.outcome).toBe('success');
		expect(result.remote?.redirectCount).toBe(1);
		expect(result.remote?.subtype).toBe('image');
	});

	it('enforces redirect limit', async () => {
		const result = await parseAtom(`${baseUrl}/step-1`, remoteOpts({ maxRedirects: 1 }));
		expect(result.remote?.outcome).toBe('redirect_limit_exceeded');
	});

	it('errors on redirect without Location header', async () => {
		const result = await parseAtom(`${baseUrl}/broken-redirect`, remoteOpts());
		expect(result.remote?.outcome).toBe('error');
	});
});

describe('remote inspection: safety controls', () => {
	it('denies unsupported scheme (ftp)', async () => {
		const result = await parseAtom('ftp://example.com/archive.bin', {
			remoteFetch: true,
		});
		expect(result.remote?.outcome).toBe('denied');
	});

	it('denies private network targets by default', async () => {
		const result = await parseAtom('http://127.0.0.1/private', {
			remoteFetch: true,
			allowHttp: true,
		});
		expect(result.remote?.outcome).toBe('denied');
	});

	it('denies 10.x.x.x private range', async () => {
		const result = await parseAtom('http://10.0.0.1/test', {
			remoteFetch: true,
			allowHttp: true,
		});
		expect(result.remote?.outcome).toBe('denied');
	});

	it('denies 192.168.x.x private range', async () => {
		const result = await parseAtom('http://192.168.1.1/test', {
			remoteFetch: true,
			allowHttp: true,
		});
		expect(result.remote?.outcome).toBe('denied');
	});

	it('denies link-local 169.254.x.x', async () => {
		const result = await parseAtom('http://169.254.169.254/latest/meta-data/', {
			remoteFetch: true,
			allowHttp: true,
		});
		expect(result.remote?.outcome).toBe('denied');
	});
});

describe('remote inspection: size limits', () => {
	it('rejects oversized responses during streaming', async () => {
		const result = await parseAtom(`${baseUrl}/big`, remoteOpts({ maxResponseBytes: 512 }));
		expect(result.remote?.outcome).toBe('oversized');
	});
});

describe('remote inspection: IPFS gateway', () => {
	it('uses IPFS gateway for IPFS URIs', async () => {
		const result = await parseAtom(
			'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e',
			{
				...remoteOpts(),
				ipfsGatewayBaseUrl: `${baseUrl}/`,
			}
		);
		expect(result.remote?.outcome).toBe('success');
		expect(result.remote?.subtype).toBe('audio');
	});

	it('extracts structured documents from IPFS JSON responses', async () => {
		const result = await parseAtom(
			'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e/metadata.json',
			{
				...remoteOpts(),
				ipfsGatewayBaseUrl: `${baseUrl}/`,
			}
		);
		expect(result.remote?.outcome).toBe('success');
		expect(result.remote?.subtype).toBe('json_document');
		if (result.kind === 'ipfs') {
			expect(result.structuredDocument?.source).toBe('resolved_ipfs');
			expect(result.structuredDocument?.schemaType).toBe('MusicRecording');
			expect(result.structuredDocument?.urlCandidates[0]?.url).toBe('https://example.com/track');
		}
	});

	it('skips IPFS remote when no gateway configured', async () => {
		const result = await parseAtom(
			'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e',
			{ remoteFetch: true }
		);
		expect(result.remote?.outcome).toBe('skipped');
	});
});

describe('remote inspection: non-remote kinds', () => {
	it('does not attempt remote for plain strings', async () => {
		const result = await parseAtom('hello world', { remoteFetch: true });
		expect(result.kind).toBe('plain_string');
		expect('remote' in result).toBe(false);
	});

	it('does not attempt remote for JSON', async () => {
		const result = await parseAtom('{"foo":"bar"}', { remoteFetch: true });
		expect(result.kind).toBe('json');
		expect('remote' in result).toBe(false);
	});

	it('does not attempt remote for ISBN', async () => {
		const result = await parseAtom('978-0-306-40615-7', { remoteFetch: true });
		expect(result.kind).toBe('isbn');
		expect('remote' in result).toBe(false);
	});

	it('does not attempt remote for Ethereum address', async () => {
		const result = await parseAtom('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', {
			remoteFetch: true,
		});
		expect(result.kind).toBe('ethereum_address');
		expect('remote' in result).toBe(false);
	});

	it('does not attempt remote for ENS name', async () => {
		const result = await parseAtom('vitalik.eth', { remoteFetch: true });
		expect(result.kind).toBe('ens_name');
		expect('remote' in result).toBe(false);
	});
});

describe('classifyRemoteKind unit tests', () => {
	it('classifies JPEG by magic bytes', () => {
		const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
		expect(classifyRemoteKind(undefined, jpeg)).toBe('image');
	});

	it('classifies GIF by magic bytes', () => {
		const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
		expect(classifyRemoteKind(undefined, gif)).toBe('image');
	});

	it('classifies MP4 by ftypisom', () => {
		const header = [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d];
		const mp4 = new Uint8Array(header);
		expect(classifyRemoteKind(undefined, mp4)).toBe('video');
	});

	it('classifies RIFF as audio', () => {
		const riff = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
		expect(classifyRemoteKind(undefined, riff)).toBe('audio');
	});
});
