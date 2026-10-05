import { describe, expect, test } from 'bun:test';
import { type CompactParseResult, resolveParseSearchText, toCompactParseResult } from './parse';

describe('parse search projection', () => {
	test('restores legacy strings after authoritative parsing but keeps valid IID identities opaque', () => {
		expect(resolveParseSearchText({ kind: 'plain_string', normalizedInput: 'legacy value' })).toBe(
			'legacy value'
		);
		expect(
			resolveParseSearchText({ kind: 'iid', normalizedInput: 'opaque canonical identity' })
		).toBe('');
	});

	test('uses display fields for structured documents without indexing raw JSON', () => {
		const result: CompactParseResult = {
			kind: 'json',
			normalizedInput: '{"opaque":"payload"}',
			structuredDocument: {
				source: 'inline_json',
				format: 'jsonld',
				topLevelType: 'object',
				urlCandidates: [],
				data: { name: 'Display name', description: ['Display description'] },
			},
		};

		expect(resolveParseSearchText(result)).toBe('Display name Display description');
		expect(resolveParseSearchText({ kind: 'json', normalizedInput: '{"opaque":"payload"}' })).toBe(
			''
		);
	});

	test('retains canonical identifiers for understood non-opaque parser kinds', () => {
		expect(
			resolveParseSearchText({
				kind: 'url',
				normalizedInput: 'https://example.com/path',
				canonicalId: 'https://example.com/path',
			})
		).toBe('https://example.com/path');
	});
});

test('legacy compaction preserves typed and colon-bearing identifiers byte-for-byte', () => {
	for (const input of [
		'int:wd:film:Q188035',
		'int:wd:written-work:Q47461344',
		'int:other:value:with:colons',
	]) {
		const compact = toCompactParseResult({
			kind: 'plain_string',
			input,
			normalizedInput: input,
			original: input,
			trimmed: input,
			warnings: [],
			structuredDocument: undefined,
		});
		expect(compact.normalizedInput).toBe(input);
		expect(compact.canonicalId).toBe(input);
		expect(compact.identity).toBeUndefined();
	}
});
