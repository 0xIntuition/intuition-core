# ADR: Indexing Scope Boundaries

## Status

Proposed.

## Context

Operators need to choose what they index. rindexer already supports block,
contract, and event-handler selection, but Core also has projection workers,
classification workers, enrichment providers, and read APIs. A single
`enabled=true` switch cannot describe those boundaries without either storing
too much data or silently producing partial outputs.

## Decision

Model IndexingScope as four layers:

1. Hard ingestion scope for chain/event selection.
2. Projection scope for materialized read models.
3. Processing scope for parse/classify/enrich work.
4. Read/query scope for API and app filtering.

The implementation must validate compatibility between layers. In particular,
financial projections must require the financial events they depend on, and
domain filters such as music or podcasts must run after parsing/classification
rather than inside the rindexer event filter.

## Consequences

- Operators can run a smaller node without corrupting read models.
- Partial capability becomes explicit.
- Presets can be ergonomic while still expanding into concrete service config.
- Implementation needs a validator before presets are used in production.

## Follow-ups

- Implement schema validation and rindexer manifest dry-run.
- Validate projection bundles against required event sets.
- Prototype music and podcast processing scope in workers.
