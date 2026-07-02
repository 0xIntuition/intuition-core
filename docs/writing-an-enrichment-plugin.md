# Writing an enrichment plugin

Enrichment plugins fetch metadata for classified atoms — each plugin reads
exactly one source and returns typed **artifacts** that merge onto the atom.
The 36 built-in providers (OpenGraph, Wikipedia, Spotify, npm, arXiv, …) use
the same interface you will.

A good reference to read alongside this guide:
[`packages/atom-enrichment/src/plugins/providers/npm`](../packages/atom-enrichment/src/plugins/providers/npm)
— a complete keyless provider in ~150 lines (registry lookup + weekly
downloads → one artifact).

## The shape of a plugin

```ts
import { defineEnrichmentPlugin, type EnrichmentPlugin } from '@0xintuition/atom-enrichment';

export function createMyPlugin(options: { apiKey?: string } = {}): EnrichmentPlugin {
	return defineEnrichmentPlugin({
		id: 'my-source',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['my-source-record'],   // what this plugin can produce
		priority: 40,                          // lower runs earlier
		TTL: 3_600,                            // cache seconds for this plugin's artifacts

		// Cheap, synchronous applicability check — no network. Look at the
		// request (URL, identifiers, classification) and bail fast.
		supports(request) {
			return !!parseMyIdFromUrl(request);
		},

		// The actual fetch. Return [] when there's nothing; throw only for
		// genuinely unexpected failures — upstream 404s should produce a
		// not_found artifact or an empty result, not an exception.
		async enrich(request, ctx) {
			const id = parseMyIdFromUrl(request);
			if (!id) return [];

			const payload = await fetchJson(`https://api.my-source.com/${id}`, {
				signal: ctx.signal,          // ALWAYS pass the abort signal
			});

			return [
				{
					artifact_type: 'my-source-record',
					data: mySchema.parse({ /* validated, typed fields */ }),
					meta: {
						pluginId: 'my-source',
						provider: 'my-source',
						fetchedAt: ctx.now(),
						sourceUrl: `https://my-source.com/${id}`,
					},
				},
			];
		},
	});
}
```

## The rules that matter

1. **Validate outputs with a schema.** Every built-in defines a Zod schema for
   its artifact `data` (see any provider's `schema.ts`). Unvalidated upstream
   JSON is how garbage enters the graph.
2. **Keys are optional, always.** Take credentials as constructor options (fed
   from env by the runtime). If the key is missing, either don't match in
   `supports()` or return a skip — **never throw for a missing credential.**
   This is what keeps the zero-paid-accounts guarantee true.
3. **Respect `ctx.signal`.** Enrichment runs under lease deadlines; a plugin
   that ignores aborts holds worker slots hostage.
4. **Fail soft.** A 404 is information (`not_found` artifact), a 5xx is a
   `retriable` error entry — the run continues with your plugin marked
   `partial`, and the other plugins' artifacts still land.
5. **Set an honest `TTL`.** It drives the enrichment cache — volatile data
   (prices) short, stable data (paper metadata) long.
6. **One plugin, one source.** Composition happens at the preset level, not
   inside plugins.

## Wiring it in

Plugins register on the enrichment runtime — the same runtime that powers both
`atom-services` (`POST /v1/enrich`) and the `kg-enrichment-worker`:

```ts
import { createEnrichmentRuntime } from '@0xintuition/atom-services/runtime';

const runtime = createEnrichmentRuntime({
	defaultPreset: 'default',
	env: process.env,          // provider credentials resolve from here
	// plugins: [...preset, createMyPlugin({ apiKey: process.env.MY_SOURCE_API_KEY })],
});
```

Test it end-to-end with a URL your plugin matches:

```bash
curl -X POST localhost:4010/v1/process -H 'Content-Type: application/json' \
  -d '{"rawInput":"https://my-source.com/thing/123"}'
```

Your artifact appears in `enrichment.artifacts`; for worker-processed atoms it
lands in `kg.artifacts` with your `artifact_kind`.

## Pair it with classification

If your source implies a *type* (not just metadata), also write a
[classification plugin](./writing-a-classification-plugin.md) so atoms from
your domain get the right `classificationType` — the two plugin systems are
designed to compose.
