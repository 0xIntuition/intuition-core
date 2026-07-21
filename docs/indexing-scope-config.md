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
- per-projection output availability and each output's required event set
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
- The selected projection bundle must have every required event in the effective
  ingestion event set.
- Projection bundle and include/exclude entries must use known Core projection
  names.
- Every selected projection must have its required event set available. Market
  and accounting outputs fail loudly without `Deposited`, `Redeemed`, and
  `SharePriceChanged`.
- Processing classification values must map to the taxonomy in
  `classification-taxonomy.md`.
- Provider keys are optional by default. A provider without a key should degrade
  gracefully unless `require_keys` is true.
- Read scope must not imply that source data was deleted; it only limits the
  API or app view.

## Projection Bundle Semantics

| Bundle | Required events | Available outputs |
| --- | --- | --- |
| `full` | All supported MultiVault events. | Every Core projection. |
| `kg-only` | `AtomCreated`, `TripleCreated`. | Event log for indexed events, account registry for graph actors, core KG entities. |
| `market-only` | `Deposited`, `Redeemed`, `SharePriceChanged`. | Vault state, holder indexes, positions, leaderboard markers/refresh, and market analytics that do not require graph identity events. |
| `no-analytics` | All supported MultiVault events. | Core graph and market projections; product analytics and leaderboard-style batch outputs remain unavailable. |
| `music`, `podcasts`, `music-and-podcasts` | `AtomCreated`, `TripleCreated`. | KG outputs plus processing-scope filters for the selected taxonomy. |

The dry-run prints an `outputs` array under `projections`. Each entry is marked
`available` when selected by the bundle and not excluded, or `unavailable` with
`not-in-bundle` / `excluded-by-config` when the output will not be produced.

## Existing Config Mapping

| Existing variable | Future layer | Notes |
| --- | --- | --- |
| `CHAIN_ID` | ingestion | Chain identity. |
| `MULTIVAULT_CONTRACT_ADDRESS` | ingestion | Contract address. |
| `MULTIVAULT_START_BLOCK` | ingestion | Inclusive start. |
| `MULTIVAULT_END_BLOCK` | ingestion | Optional bounded range. |
| `DISABLED_PROJECTIONS` | projections | Current projection exclusion mechanism. |
| `WORKERS_PROCESSING_SCOPE` | processing | Prototype worker-side preset: `full`, `music`, `podcasts`, or `music-and-podcasts`. Default is `full`. |
| Provider API keys | processing | Enable richer artifacts for selected providers. |

## Example Outcomes

`kg-only` should start the indexer and core entity projections, but it should
not claim market endpoints are complete.

`music` should still parse generic URLs, but classification/enrichment work
outside the music taxonomy can be skipped or deprioritized.

`no-analytics` should not change graph correctness. It only disables analytics
read models and related worker paths.

## Worker Prototype Notes

The first worker-side processing scope is intentionally narrow:

- Parse and classification still run broadly so atom identity and classification
  evidence are preserved.
- `WORKERS_PROCESSING_SCOPE=music`, `podcasts`, or `music-and-podcasts` gates
  only the enrichment worker after classification.
- Matching rows enrich with a provider/artifact allowlist for the selected
  domains. Non-matching rows are marked `enrichment_status = skipped` with a
  `SKIPPED` reason in `enrichment_error`.
- This does not backfill existing enriched artifacts, delete artifacts for rows
  that no longer match the scope, or change read/API filters.

Remaining migration/backfill decisions:

- whether changing processing scope should requeue previously skipped rows;
- whether existing artifacts outside the new scope should be retained, hidden,
  or deleted in a separate cleanup job;
- how read/query APIs should expose domain match state without leaking
  provider-specific implementation details.
