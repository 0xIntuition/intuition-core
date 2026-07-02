# Writing a classification plugin

The classification engine is plugin-first: the 17 built-in plugins (GitHub,
Spotify, Wikipedia, X, TMDB, …) use exactly the same interface you do. A plugin
can add coverage for a domain the core team will never staff — scientific
papers, regional commerce, your internal systems — and still produce
**deterministic, canonical atoms** that line up with everyone else's graph.

A complete, runnable example lives in
[`packages/atom-classification-example-plugin`](../packages/atom-classification-example-plugin)
(~150 lines). This guide walks its structure.

## The shape of a plugin

A plugin is a plain object with a **manifest**, and any number of
**classifiers** and **resolvers**:

```ts
import type { AtomClassificationPlugin } from '@0xintuition/atom-classification';

export function createMyPlugin(): AtomClassificationPlugin {
	return {
		manifest: {
			id: 'my-plugin',
			version: '1.0.0',
			engineRange: '^0.1.0',
			runtime: 'universal',            // runs in node/bun/browser
			capabilities: ['classifier:text:my-kind'],
			permissions: [],                 // e.g. ['net'] if you fetch
			dependsOn: ['type-profiles'],    // other plugins you build on
			provides: ['my:thing'],
			priority: 30,                    // lower runs earlier
		},
		classifiers: [/* … */],
		resolvers: [/* … */],
	};
}
```

### Classifiers — "what is this input?"

A classifier looks at the raw input and returns a classification (or `null` to
pass). It must be **pure and deterministic** — same input, same answer:

```ts
classifiers: [
	{
		id: 'my-plugin-classifier',
		priority: 30,
		classify: (input) => {
			if (!input.startsWith('doi:')) return null;
			return {
				type: 'text',
				domain: 'research',
				subtype: 'paper',
				confidence: 0.9,
				meta: { plugin: 'my-plugin' },
			};
		},
	},
],
```

### Resolvers — "turn it into a canonical atom"

A resolver takes a matching classification and produces candidate atoms:
schema.org-typed, with a `canonicalId` and `sameAs` links so two apps
describing the same thing **converge on the same atom** instead of
fragmenting:

```ts
resolvers: [
	{
		id: 'my-plugin-resolver',
		priority: 30,
		canResolve: (classification) =>
			classification.domain === 'research' && classification.subtype === 'paper',
		resolve: ({ request }) => ({
			atoms: [
				{
					schemaType: 'ScholarlyArticle',
					category: 'thing',
					title: '…',
					canonicalId: `doi:${id}`,
					sameAs: [`https://doi.org/${id}`],
					source: 'my-plugin',
					data: { /* extracted fields */ },
				},
			],
			fallbackUsed: false,
		}),
	},
],
```

## Registering it

```ts
import {
	createClassificationEngine,
	defaultClassificationPreset,
} from '@0xintuition/atom-classification';
import { createExampleLexicalSignalPlugin } from '@0xintuition/atom-classification-example-plugin';

const engine = createClassificationEngine({
	runtime: 'server', // or 'client' in the browser
	plugins: [...defaultClassificationPreset(), createExampleLexicalSignalPlugin()],
});

const result = await engine.classify({ input: 'idea: semantic grounding' });
// → { classification: { domain: 'lexical', subtype: 'seed-term', confidence: 0.82 } }
```

The same engine powers `atom-services` (`POST /v1/classify`) and the
`kg-classification-worker`, so a plugin registered there classifies both ad-hoc
HTTP requests and every atom flowing through your node.

## Ground rules

- **Determinism is sacred.** Classification output feeds identity-sensitive
  surfaces. No randomness, no time-dependent output, no unpinned model calls in
  the classify path.
- **Degrade gracefully.** If your plugin needs an API key or network access,
  return `null` / a `skipped` artifact when it's unavailable — never throw for
  a missing credential. (See any built-in provider plugin for the pattern.)
- **Priorities:** lower runs earlier. Built-ins mostly sit at 10–50; run after
  `type-profiles` (declare it in `dependsOn`) if you build on its output.
- Test with plain `bun:test` — the example plugin and the built-ins show the
  conventions.
