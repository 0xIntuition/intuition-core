# Indexing Scope Config

This is the proposed shape for a future `IndexingScope` config. Week 1 only
documents the contract; implementation is tracked by follow-up tickets.

```yaml
scope:
  preset: music-and-podcasts

  ingestion:
    chain_id: 13579
    contract: "${MULTIVAULT_CONTRACT_ADDRESS}"
    start_block: "${MULTIVAULT_START_BLOCK}"
    end_block: "${MULTIVAULT_END_BLOCK:-}"
    events:
      include:
        - AtomCreated
        - TripleCreated
      exclude: []

  projections:
    include:
      - core_entities
      - event_log
    exclude:
      - funnel_tracker
      - user_activity_batch
      - vault_state:dual
      - vault_holders_index:dual

  processing:
    classifications:
      include:
        - music
        - podcast
    providers:
      include:
        - opengraph
        - jsonld
        - spotify
        - podcast-index
      require_keys: false

  read:
    classifications:
      include:
        - music
        - podcast
    partial_capabilities:
      market: unavailable
```

## Validation Rules

- `preset` must expand to a concrete layer-by-layer config before services
  start.
- Hard ingestion events must be sufficient for every enabled projection bundle.
- Projection bundles that require financial events must fail validation when
  those events are excluded.
- Processing classification values must map to the taxonomy in
  `classification-taxonomy.md`.
- Provider keys are optional by default. A provider without a key should degrade
  gracefully unless `require_keys` is true.
- Read scope must not imply that source data was deleted; it only limits the
  API or app view.

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
