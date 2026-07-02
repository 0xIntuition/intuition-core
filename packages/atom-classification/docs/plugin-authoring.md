# Plugin Authoring Guide

This guide shows the minimum contract for shipping an external plugin for
`@0xintuition/atom-classification`.

## 1. Create a manifest

Every plugin must define:

- `id`: lowercase kebab-case
- `version`: semver
- `engineRange`: compatible engine range (for example `^0.1.0`)
- `runtime`: `client` | `server` | `universal`
- `capabilities`, `permissions`, `dependsOn`, `provides`, `priority`

## 2. Add classifiers and/or resolvers

- Classifiers are deterministic input matchers.
- Resolvers turn a classification into canonical classification candidates.
- If your resolver emits a type, ensure that type is registered.

### Resolver output contract (`cpkg-02`)

- Preferred output: `classifications` (canonical envelopes).
- Compatibility output: `atoms` (legacy shape) is still accepted.
- If both are provided, the engine validates canonical/legacy parity.

Canonical item shape:

```ts
{
  type: string;
  data: Record<string, unknown>;
  meta?: {
    pluginId?: string;
    provider?: string;
    fetchedAt?: string; // ISO datetime
    sourceUrl?: string;
    confidence?: number;
  };
}
```

Engine defaults are applied for missing `meta` fields:

- `pluginId`: resolver plugin id
- `provider`: resolver id
- `fetchedAt`: engine timestamp
- `confidence`: classification confidence

## 3. Respect runtime constraints

- Client runtime cannot execute AI-capable plugins.
- If a capability implies AI, include `ai` permission for server runtime.

## 4. Example boilerplate

```ts
import type { AtomClassificationPlugin } from '@0xintuition/atom-classification';

export function createMyPlugin(): AtomClassificationPlugin {
	return {
		manifest: {
			id: 'my-plugin',
			version: '1.0.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['classifier:text:example'],
			permissions: [],
			dependsOn: ['type-profiles'],
			provides: ['example:feature'],
			priority: 80,
		},
		classifiers: [
			{
				id: 'my-plugin-classifier',
				classify: (input) => {
					if (!input.startsWith('example:')) return null;
					return {
						type: 'text',
						domain: 'lexical',
						subtype: 'example',
						confidence: 0.8,
						meta: {},
					};
				},
			},
		],
		resolvers: [
			{
				id: 'my-plugin-resolver',
				canResolve: (classification) =>
					classification.domain === 'lexical' && classification.subtype === 'example',
				resolve: ({ now }) => ({
					classifications: [
						{
							type: 'DefinedTerm',
							data: {
								'@context': 'https://schema.org/',
								'@type': 'DefinedTerm',
								name: 'Example',
							},
							meta: {
								pluginId: 'my-plugin',
								provider: 'my-plugin-resolver',
								fetchedAt: now,
								confidence: 0.8,
							},
						},
					],
				}),
			},
		],
	};
}
```

## 5. Compatibility testing

Use the package test harness pattern:

- validate manifest with `validatePluginManifest`
- run repeated classifications and assert deterministic outputs
- verify dependency failures are explicit when required plugins are absent
- if emitting both `classifications` and `atoms`, assert parity in tests
