import { describe, expect, it } from 'bun:test';

import { createEnrichmentEngine } from '../../src/engine';
import type { FetchLike } from '../../src/plugins/providers';
import {
	createOpenLibraryPlugin,
	resolveOpenLibraryTarget,
} from '../../src/plugins/providers/openlibrary';
import { createMockAtomInput, createMockPluginContext, createMockRequest } from '../../src/testing';

function identifierRequest(identifiers: Record<string, string>) {
	return createMockRequest({
		input: createMockAtomInput({
			atomType: 'thing',
			jsonLd: { '@context': 'https://schema.org', '@type': 'Thing' },
			hints: { identifiers },
		}),
		plugins: ['openlibrary'],
	});
}

function jsonFetch(body: unknown, status = 200, inspect?: (url: string) => void): FetchLike {
	return async (url) => {
		inspect?.(url);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	};
}

describe('OpenLibrary identifier routing', () => {
	it('prefers the more specific OLID hint when both OLID and ISBN are present', () => {
		expect(
			resolveOpenLibraryTarget(identifierRequest({ isbn: '9780684832722', olid: 'ol45804w' }))
		).toEqual({ kind: 'olid', identifier: 'OL45804W', entityType: 'work' });
	});

	it('accepts canonical ISBN and typed OLID values, but rejects malformed hints', () => {
		const plugin = createOpenLibraryPlugin();
		expect(plugin.supports(identifierRequest({ isbn: '9780684832722' }))).toBe(true);
		expect(plugin.supports(identifierRequest({ olid: 'OL7353617M' }))).toBe(true);
		expect(plugin.supports(identifierRequest({ olid: 'OL26320A' }))).toBe(true);
		expect(plugin.supports(identifierRequest({ isbn: 'not-isbn', olid: 'OL-nope' }))).toBe(false);
	});
});

describe('OpenLibrary plugin', () => {
	it('uses the canonical Books API ISBN path and maps edition metadata', async () => {
		const plugin = createOpenLibraryPlugin({
			fetch: jsonFetch(
				{
					'ISBN:9780684832722': {
						key: '/books/OL7721520M',
						title: 'The Sovereign Individual',
						authors: [{ name: 'James Dale Davidson' }, { name: 'William Rees-Mogg' }],
						publishers: [{ name: 'Scribner' }],
						publish_date: '1996',
						number_of_pages: 180,
						cover: { large: 'https://covers.openlibrary.org/b/id/8432047-L.jpg' },
						subjects: [{ name: 'Fiction' }],
					},
				},
				200,
				(url) => {
					expect(url).toContain('/api/books?');
					expect(url).toContain('bibkeys=ISBN%3A9780684832722');
					expect(url).toContain('jscmd=data');
				}
			),
		});

		const artifacts = await plugin.enrich(
			identifierRequest({ isbn: '9780684832722' }),
			createMockPluginContext()
		);

		expect(artifacts).toHaveLength(1);
		expect(artifacts[0]).toMatchObject({
			artifact_type: 'openlibrary',
			data: {
				identifier: '9780684832722',
				identifierType: 'isbn',
				entityType: 'edition',
				isbn: '9780684832722',
				olid: 'OL7721520M',
				title: 'The Sovereign Individual',
				authors: ['James Dale Davidson', 'William Rees-Mogg'],
			},
			meta: { pluginId: 'openlibrary', provider: 'openlibrary' },
		});
	});

	it('maps work and author OLIDs through their typed canonical paths', async () => {
		const work = createOpenLibraryPlugin({
			fetch: jsonFetch(
				{
					key: '/works/OL45804W',
					title: 'Fantastic Mr Fox',
					description: { value: 'A fox outwits three farmers.' },
					authors: [{ author: { key: '/authors/OL34184A' } }],
					covers: [8739161],
					subjects: ['Foxes'],
				},
				200,
				(url) => expect(url).toBe('https://openlibrary.org/works/OL45804W.json')
			),
		});
		const workArtifacts = await work.enrich(
			identifierRequest({ olid: 'OL45804W' }),
			createMockPluginContext()
		);
		expect(workArtifacts[0]?.data).toMatchObject({
			entityType: 'work',
			olid: 'OL45804W',
			authorOlids: ['OL34184A'],
			description: 'A fox outwits three farmers.',
		});

		const author = createOpenLibraryPlugin({
			fetch: jsonFetch(
				{ key: '/authors/OL26320A', name: 'J. R. R. Tolkien', bio: 'English author.' },
				200,
				(url) => expect(url).toBe('https://openlibrary.org/authors/OL26320A.json')
			),
		});
		const authorArtifacts = await author.enrich(
			identifierRequest({ olid: 'OL26320A' }),
			createMockPluginContext()
		);
		expect(authorArtifacts[0]?.data).toMatchObject({
			entityType: 'author',
			olid: 'OL26320A',
			title: 'J. R. R. Tolkien',
			description: 'English author.',
		});
	});

	it('treats 404/no record as a terminal no-match instead of a retry error', async () => {
		const plugin = createOpenLibraryPlugin({ fetch: jsonFetch({}, 404) });
		const engine = createEnrichmentEngine({ plugins: [plugin] });
		const result = await engine.enrich(identifierRequest({ isbn: '9780684832722' }));

		expect(result.status).toBe('success');
		expect(result.artifacts).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	it('surfaces rate limits and upstream failures as retryable', async () => {
		for (const [status, code] of [
			[429, 'rate_limited'],
			[503, 'upstream_error'],
		] as const) {
			const engine = createEnrichmentEngine({
				plugins: [createOpenLibraryPlugin({ fetch: jsonFetch({}, status) })],
			});
			const result = await engine.enrich(identifierRequest({ isbn: '9780684832722' }));

			expect(result.status).toBe('failed');
			expect(result.errors).toMatchObject([{ pluginId: 'openlibrary', code, retriable: true }]);
		}
	});

	it('makes malformed identifiers terminally not applicable', async () => {
		const engine = createEnrichmentEngine({ plugins: [createOpenLibraryPlugin()] });
		const result = await engine.enrich(identifierRequest({ isbn: 'bad' }));

		expect(result.errors).toEqual([]);
		expect(result.skipped).toContainEqual({
			pluginId: 'openlibrary',
			reason: 'not_applicable',
		});
	});
});
