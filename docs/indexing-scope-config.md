# Indexing Scope Config

`IndexingScope` is a JSON config used for a pre-indexing dry-run. The MVP
validates hard ingestion scope, projection bundle selection, and processing
policy placeholders before an operator starts rindexer.

Run the bundled example:

```bash
make scope-dry-run
# or
bun run scope:dry-run docs/indexing-scope.example.json
```

Use a custom config:

```bash
make scope-dry-run SCOPE_CONFIG=./my-scope.json
```

The dry-run prints:

- the chain, RPC URL, contract, and block range rindexer will ingest
- the MultiVault event handlers included in the rendered manifest preview
- environment variables equivalent to the current rindexer template
- projection bundle include/exclude selections
- processing-scope classifications and providers, with an explicit note that
  they are not rindexer hard filters

Dry-run output redacts RPC URL credentials and token-like query parameters so
operator logs do not leak bearer tokens, API keys, or embedded passwords.

```json
{
	"scope": {
		"preset": "music-and-podcasts",
		"ingestion": {
			"chain_id": 13579,
			"rpc_url": "https://testnet.rpc.intuition.systems",
			"contract": "0xeBc49d356B7f64D888130D85CC6D17114a6843ec",
			"start_block": 9030416,
			"end_block": 9030916,
			"events": {
				"include": ["AtomCreated", "TripleCreated"],
				"exclude": []
			}
		},
		"projections": {
			"bundle": "kg-only",
			"include": ["event_log", "account_registry", "core_entities"],
			"exclude": []
		},
		"processing": {
			"classifications": {
				"include": ["music", "podcast"]
			},
			"providers": {
				"include": ["opengraph", "jsonld", "spotify", "podcast-index"],
				"require_keys": false
			}
		}
	}
}
```

## Validation Rules

- `preset` expands to concrete ingestion events, projection defaults, and
  processing classifications when a layer omits explicit include lists.
- `chain_id` must be a positive integer.
- `rpc_url` must be a URL.
- `contract` must be a 20-byte EVM address.
- `start_block` must be a non-negative integer.
- `end_block`, when set, must be greater than or equal to `start_block`.
- `events.include` and `events.exclude` must use supported MultiVault event
  names and cannot overlap.
- Projection bundle and include/exclude entries must use known Core projection
  names.
- Processing classification values must map to the taxonomy in
  `classification-taxonomy.md`.
- Provider keys are optional by default. A provider without a key should degrade
  gracefully unless `require_keys` is true.
- Read scope must not imply that source data was deleted; it only limits the
  API or app view.

Projection bundle/event sufficiency checks are intentionally shallow in this
MVP. Full projection-required event validation is tracked separately by the W3
projection bundle validation ticket.

## Existing Config Mapping

| Existing variable | Future layer | Notes |
| --- | --- | --- |
| `CHAIN_ID` | ingestion | Chain identity. |
| `MULTIVAULT_CONTRACT_ADDRESS` | ingestion | Contract address. |
| `MULTIVAULT_START_BLOCK` | ingestion | Inclusive start. |
| `MULTIVAULT_END_BLOCK` | ingestion | Optional bounded range. |
| `DISABLED_PROJECTIONS` | projections | Current projection exclusion mechanism. |
| Provider API keys | processing | Enable richer artifacts for selected providers. |

## Example Outcomes

`kg-only` should start the indexer and core entity projections, but it should
not claim market endpoints are complete.

`music` should still parse generic URLs, but classification/enrichment work
outside the music taxonomy can be skipped or deprioritized.

`no-analytics` should not change graph correctness. It only disables analytics
read models and related worker paths.
