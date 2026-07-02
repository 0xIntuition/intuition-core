import { describe, expect, it } from 'bun:test';
import { getRequestName } from '../src/plugins/providers/__shared__/request';
import type { EnrichmentRequest } from '../src/types';

const BASE_REQUEST: Omit<EnrichmentRequest, 'input'> = {
	runtime: 'server',
};

function createRequest(inputOverrides: EnrichmentRequest['input']): EnrichmentRequest {
	return {
		...BASE_REQUEST,
		input: inputOverrides,
	};
}

describe('request helper name resolution', () => {
	it('ignores URL-like names from hints and JSON-LD', () => {
		const request = createRequest({
			atomType: 'thing',
			jsonLd: {
				name: 'https://github.com/vercel/next.js',
			},
			source: {
				classificationEngine: '@0xintuition/atom-classification',
				classifiedAt: '2026-02-11T00:00:00.000Z',
			},
			hints: {
				name: 'https://en.wiktionary.org/wiki/https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js',
			},
		});

		expect(getRequestName(request)).toBeUndefined();
	});

	it('falls back to a non-URL JSON-LD name when hint name is URL-like', () => {
		const request = createRequest({
			atomType: 'software',
			jsonLd: {
				name: 'next.js',
				url: 'https://github.com/vercel/next.js',
			},
			source: {
				classificationEngine: '@0xintuition/atom-classification',
				classifiedAt: '2026-02-11T00:00:00.000Z',
			},
			hints: {
				name: 'https://github.com/vercel/next.js',
				url: 'https://github.com/vercel/next.js',
			},
		});

		expect(getRequestName(request)).toBe('next.js');
	});
});
