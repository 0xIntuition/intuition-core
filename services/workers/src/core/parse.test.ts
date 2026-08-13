import { describe, expect, test } from 'bun:test';
import { type CompactParseResult, resolveParseSearchText } from './parse';

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
