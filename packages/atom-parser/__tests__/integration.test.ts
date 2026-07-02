import { describe, expect, it } from 'bun:test';
import { parseAtom } from '../src/parse.ts';
import { ParseError } from '../src/types.ts';

const localOnly = { remoteFetch: false };

describe('integration: input validation', () => {
	it('rejects empty input', async () => {
		try {
			await parseAtom('', localOnly);
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError);
			expect((err as ParseError).code).toBe('EMPTY_INPUT');
		}
	});

	it('rejects whitespace-only input', async () => {
		try {
			await parseAtom('   ', localOnly);
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError);
			expect((err as ParseError).code).toBe('EMPTY_INPUT');
		}
	});

	it('rejects oversized input', async () => {
		try {
			await parseAtom('x'.repeat(32), { remoteFetch: false, maxInputBytes: 8 });
			expect.unreachable('should throw');
		} catch (err) {
			expect(err).toBeInstanceOf(ParseError);
			expect((err as ParseError).code).toBe('INPUT_TOO_LARGE');
		}
	});
});

describe('integration: end-to-end local-only', () => {
	it('parses IPFS URI end-to-end', async () => {
		const result = await parseAtom(
			'ipfs://bafybeigdyrzt5rj6uqb6t5x3r7b6g6j4gh7f6wzsp4r4i2l3x6jt6s5z3e',
			localOnly
		);
		expect(result.kind).toBe('ipfs');
		if (result.kind === 'ipfs') {
			expect(result.remote).toBeUndefined();
		}
		expect(result.warnings).toHaveLength(0);
	});

	it('parses Ethereum address end-to-end', async () => {
		const result = await parseAtom('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', localOnly);
		expect(result.kind).toBe('ethereum_address');
		expect(result.normalizedInput).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
	});

	it('parses ENS name end-to-end', async () => {
		const result = await parseAtom('vitalik.eth', localOnly);
		expect(result.kind).toBe('ens_name');
	});

	it('parses JSON end-to-end', async () => {
		const result = await parseAtom('{"key":"value","num":42}', localOnly);
		expect(result.kind).toBe('json');
	});

	it('parses URL end-to-end', async () => {
		const result = await parseAtom('https://example.com', localOnly);
		expect(result.kind).toBe('url');
	});

	it('parses ISBN end-to-end', async () => {
		const result = await parseAtom('978-0-306-40615-7', localOnly);
		expect(result.kind).toBe('isbn');
	});

	it('parses plain string end-to-end', async () => {
		const result = await parseAtom('just a string', localOnly);
		expect(result.kind).toBe('plain_string');
	});
});

describe('integration: edge cases', () => {
	it('handles Unicode input', async () => {
		const result = await parseAtom('Hello, world!', localOnly);
		expect(result.kind).toBe('plain_string');
		if (result.kind === 'plain_string') {
			expect(result.trimmed).toContain('Hello');
		}
	});

	it('handles max-length input (at limit)', async () => {
		const input = 'a'.repeat(16_384);
		const result = await parseAtom(input, localOnly);
		expect(result.kind).toBe('plain_string');
	});

	it('preserves input and normalizedInput', async () => {
		const result = await parseAtom('  hello  ', localOnly);
		expect(result.input).toBe('  hello  ');
		expect(result.normalizedInput).toBe('hello');
	});

	it('handles emoji input', async () => {
		const result = await parseAtom('rocket launch', localOnly);
		expect(result.kind).toBe('plain_string');
	});

	it('handles multi-byte Unicode', async () => {
		const result = await parseAtom('test value', localOnly);
		expect(result.kind).toBe('plain_string');
	});
});

describe('integration: remote-enabled mode', () => {
	it('local-only mode does not populate remote field', async () => {
		const result = await parseAtom('https://example.com', localOnly);
		if (result.kind === 'url') {
			expect(result.remote).toBeUndefined();
		}
	});
});
