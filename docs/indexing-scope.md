# Indexing Scope

IndexingScope is the operator-facing contract for choosing what a Core node
ingests, projects, processes, and exposes. It is layered because these choices
operate at different points in the pipeline and have different correctness
tradeoffs.

## Layers

| Layer | Purpose | Mechanism | Can discard source data? |
| --- | --- | --- | --- |
| Hard ingestion scope | Choose chain, contract, block range, and event handlers before events are written. | rindexer manifest and chain env vars. | Yes. Events outside this scope are never stored. |
| Projection scope | Choose which read models are materialized from stored events. | Projection bundle enable/disable config. | No. Event store remains the source of truth. |
| Processing scope | Choose which parsed atoms are classified, enriched, or artifact-processed. | Worker queues, classifier/enricher allowlists, provider config. | No. Atom rows remain, but artifacts can be partial. |
| Read/query scope | Choose which domains an API or consumer exposes. | API filters, query presets, app-side filtering. | No. This is a presentation/query boundary. |

The first implementation must not collapse these layers into one boolean. A
music-only operator may still need chain events to produce atom identities, but
may skip market projections or non-music enrichment providers.

## Presets

| Preset | Hard ingestion | Projection scope | Processing scope | Read/query scope |
| --- | --- | --- | --- | --- |
| `full` | All supported MultiVault events in configured block range. | All Core projections. | All parsers, classifiers, enrichers with available keys. | No domain filter. |
| `kg-only` | Atom/triple identity events required for graph reconstruction. | Core entity and KG projections only. | Parse/classify/enrich graph atoms. | Graph endpoints. |
| `market-only` | Financial events required for vault/accounting outputs. | Market, positions, protocol stats. | Optional atom processing only for labels. | Market endpoints. |
| `no-analytics` | Same as `full`. | Disable product analytics and leaderboard-style projections. | Same as `full`. | No analytics endpoints. |
| `music` | Events needed to discover atoms/triples. | KG projections; market projections optional. | Music taxonomy only. | Music-classified atoms and artifacts. |
| `podcasts` | Events needed to discover atoms/triples. | KG projections; market projections optional. | Podcast taxonomy only. | Podcast-classified atoms and artifacts. |
| `music-and-podcasts` | Events needed to discover atoms/triples. | KG projections; market projections optional. | Music and podcast taxonomies. | Music or podcast atoms and artifacts. |

## Financial Event Invariant

If an operator disables financial events such as deposits, redeems, fees, or
vault-share updates, market/accounting outputs become partial or unavailable.
The system must surface that as a scoped capability, not as zero balances or
empty market data.

## rindexer Boundary

rindexer is the right place for chain, contract, block, and event-handler
filters. Classification domains such as music or podcasts are not rindexer
filters because they are known only after atom parsing and enrichment.

Use rindexer filters to avoid writing events the node will never need. Use
processing scope to reduce expensive downstream classification, enrichment, and
artifact storage.

## Dry-Run Validator

Validate an `IndexingScope` JSON config before starting ingestion:

```bash
make scope-dry-run
make scope-dry-run SCOPE_CONFIG=./my-scope.json
```

The dry-run prints the rendered rindexer hard filters, equivalent
`CHAIN_ID`/`MULTIVAULT_*` environment values, projection bundle selections, and
processing policy placeholders. Domain filters such as `music` and `podcast`
are always reported as processing-scope-only; they do not become rindexer event
filters.

Concrete schema and examples: **[indexing-scope-config.md](./indexing-scope-config.md)**.

## Open Decisions

- Whether presets should expand into generated rindexer manifests used at
  runtime or remain dry-run validation artifacts.
- Whether query-scope presets belong in the API service config or explorer/app
  clients.
- How to represent partial market capability in API responses.
