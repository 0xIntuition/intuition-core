import { createEnrichmentEngine } from '../../src/engine';
import type { EnrichmentPlugin } from '../../src/plugins';
import type { FetchLike } from '../../src/plugins/providers/__shared__/http';
import type { EnrichmentRequest } from '../../src/types';

const NOW = '2026-10-04T12:00:00.000Z';
const film = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] };
const rows = [
	'valid film',
	'P31: {}',
	'missing claims',
	'non-array P31',
	'503 on entity',
	'invalid JSON',
	'QID-resolved',
	'URL-resolved',
] as const;

export async function runColdMatrix(
	providers: Record<string, (options: { fetch: FetchLike }) => EnrichmentPlugin>
) {
	const outputs: Record<string, { artifacts: string; errorCodes: string[] }> = {};
	for (const [provider, create] of Object.entries(providers)) {
		for (const row of rows) {
			const request: EnrichmentRequest = {
				runtime: 'server',
				input: {
					atomType: 'thing',
					source: { classificationEngine: 'test', classifiedAt: NOW },
					jsonLd: { '@type': 'Book', name: 'Shared title' },
					...(row === 'QID-resolved' ? { hints: { identifiers: { wikidata: 'Q123' } } } : {}),
					...(row === 'URL-resolved'
						? {
								hints: {
									url:
										provider === 'wikipedia'
											? 'https://en.wikipedia.org/wiki/Shared_title'
											: 'https://www.wikidata.org/wiki/Q123',
								},
							}
						: {}),
				},
			};
			const fetch: FetchLike = async (url) => {
				if (url.includes('/page/summary/'))
					return Response.json({
						title: 'Shared title',
						extract: 'Description',
						wikibase_item: 'Q123',
					});
				if (url.includes('wbsearchentities')) return Response.json({ search: [{ id: 'Q123' }] });
				if (!url.endsWith('/Q123.json')) throw new Error(`Unexpected injected URL: ${url}`);
				if (row === '503 on entity') return new Response('', { status: 503 });
				if (row === 'invalid JSON') return new Response('{broken');
				return Response.json({
					entities: {
						Q123: {
							id: 'Q123',
							labels: { en: { value: 'Shared title' } },
							...(row === 'missing claims'
								? {}
								: {
										claims:
											row === 'P31: {}'
												? { P31: {} }
												: row === 'non-array P31'
													? { P31: 'Q11424' }
													: film,
									}),
						},
					},
				});
			};
			const result = await createEnrichmentEngine({
				plugins: [create({ fetch })],
				now: () => NOW,
			}).enrich(request);
			outputs[`${provider}: ${row}`] = {
				artifacts: JSON.stringify(result.artifacts),
				errorCodes: result.errors.map((error) => error.code),
			};
		}
	}
	return outputs;
}
