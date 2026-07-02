# Canonical Output Contract (`cpkg-02`)

This package now emits canonical classification envelopes aligned with
`intuition/data-structures`.

## Contract summary

- `contractVersion`: `cpkg-02`
- Canonical output: `result.resolved.classifications`
- Publishable identity projection: `result.resolved.publishable`
- Compatibility projection: `result.resolved.atoms`

Canonical envelope shape:

```ts
type CanonicalClassification = {
  type: string;
  data: Record<string, unknown>;
  meta: {
    pluginId: string;
    provider: string;
    fetchedAt: string;
    sourceUrl?: string;
    confidence?: number;
    resolutionMode?: 'identity-only' | 'enriched';
    sourceFamily?:
      | 'jsonld'
      | 'oembed'
      | 'opengraph'
      | 'public-json'
      | 'domain-html'
      | 'domain-api';
    fieldPolicies?: Record<
      string,
      {
        promotionTier: 'identity' | 'rich-public' | 'volatile';
        sourceFamily?:
          | 'jsonld'
          | 'oembed'
          | 'opengraph'
          | 'public-json'
          | 'domain-html'
          | 'domain-api';
      }
    >;
  };
};
```

## Resolution stages

Platform plugins resolve through a fixed fallback chain:

1. `domain-api`
2. `domain-html`
3. `public-metadata`
4. `oembed`
5. `opengraph`
6. `generic`

Only the shared cross-domain stages (`oEmbed` and `openGraph`) are inherited
from the default preset. Domain-aware stages remain plugin-scoped so one plugin
cannot accidentally override another domain's resolver behavior.

## Publishable projection rules

`resolved.publishable` is derived from canonical envelopes rather than from the
legacy atom projection.

- `identity` fields are publishable by default.
- `rich-public` fields are publishable only when their source family is allowed
  by the package policy for that domain/type.
- `volatile` fields are never promoted into publishable output.

Field-level policies take precedence over envelope-level `meta.sourceFamily`.
This allows one classification to keep a sparse stable identity while promoting
only the specific rich fields that came from an approved public or API-backed
source.

## Example output

```json
{
  "ok": true,
  "contractVersion": "cpkg-02",
  "resolved": {
    "resolverId": "wikipedia-resolver",
	"resolverChain": ["wikipedia-resolver"],
	"dedupeKey": "canonical:https://en.wikipedia.org/wiki/Intuition",
	"fallbackUsed": false,
	"classifications": [
      {
        "type": "Thing",
        "data": {
          "@context": "https://schema.org/",
          "@type": "Thing",
          "name": "Intuition"
        },
        "meta": {
          "pluginId": "wikipedia",
          "provider": "wikipedia",
          "fetchedAt": "2026-03-05T00:00:00.000Z",
          "sourceUrl": "https://en.wikipedia.org/wiki/Intuition",
          "confidence": 0.95,
          "resolutionMode": "enriched",
          "sourceFamily": "domain-api"
        }
      }
    ],
    "atoms": [
      {
        "schemaType": "Thing",
        "category": "thing",
        "title": "Intuition",
        "sameAs": ["https://en.wikipedia.org/wiki/Intuition"],
        "source": "wikipedia",
        "confidence": 0.95,
        "data": {
          "@context": "https://schema.org/",
          "@type": "Thing",
          "name": "Intuition"
        }
		}
	],
	"publishable": [
		{
			"type": "Thing",
			"data": {
				"@context": "https://schema.org/",
				"@type": "Thing",
				"name": "Intuition"
			},
			"meta": {
				"pluginId": "wikipedia",
				"provider": "wikipedia",
				"fetchedAt": "2026-03-05T00:00:00.000Z",
				"sourceUrl": "https://en.wikipedia.org/wiki/Intuition",
				"confidence": 0.95,
				"resolutionMode": "enriched",
				"sourceFamily": "domain-api"
			}
		}
	]
  }
}
```

## Resolver authoring rules

1. Prefer returning `classifications` directly.
2. Keep `data` identity-first and only add richer public fields when they come
   from a deterministic or approved structured source.
3. Ensure emitted `type` exists in the type registry.
4. Populate `meta.resolutionMode` and `meta.sourceFamily` when a resolver used a
   structured stage.
5. Use `meta.fieldPolicies` when only some rich fields should become
   publishable.
6. If returning `atoms` during migration, keep canonical parity.

## Consumer adoption checklist

1. Read `resolved.publishable[0]` first when preparing IPFS/on-chain-safe JSON.
2. Fall back to `resolved.classifications[0]` for richer canonical detail when needed.
3. Derive local `atomType` from canonical `type`.
4. Use canonical or publishable `data` for `name`, `description`, and identity extraction.
5. Fall back to `resolved.atoms[0]` only if canonical is absent.
6. Avoid new dependencies on legacy-only fields:
   `schemaType/category/title/description`.

## Migration window and deprecation

- Compatibility projection (`resolved.atoms`) remains available through
  **2026-06-30**.
- Planned follow-up after migration window: move to canonical-only consumers and
  evaluate removal of legacy projection in a separate backlog item.

## Default plain-text behavior

Within `defaultClassificationPreset()` the deterministic non-URL fallback now
emits `Thing` canonical envelopes from the `plain-text` plugin.

Callers migrating from the earlier lexical fallback should not assume that every
plain-text input has a `term:*` canonical id or a Wiktionary `sameAs` link.

The `lexical` plugin remains available for explicit opt-in usage when callers
want repo-local offline-verified term handling, but it is no longer part of the
default preset.
