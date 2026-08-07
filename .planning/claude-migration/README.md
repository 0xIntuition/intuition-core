# Intuition Identifier Migration — Divide & Conquer Plan

**Goal:** switch the entire stack from "atom data = JSON-LD object on IPFS, parsed and classified from its contents" to "atom data = Intuition Identifier (`int:isrc:USSM10007459`), classification inferred from the scheme, enrichment queried from external APIs keyed by the identifier" — plus indexing the new contract-level `URIs` context field.

**Format:** 1–2 day all-hands sprint, one engineer per track, big-bang switch instead of piecemeal.

## Documents

| Doc | What it covers |
|---|---|
| [00-overview.md](00-overview.md) | What changed (contracts + data model), how it impacts each layer, dependency graph, day-by-day sequencing, decisions to lock **before** the sprint |
| [01-track-ingestion.md](01-track-ingestion.md) | **Track 1 — Chain ingestion (Rust):** ABI bump, new `AtomContextRegistered` event, rindexer typings, event storage, Timescale migrations |
| [02-track-projections-db.md](02-track-projections-db.md) | **Track 2 — Projections & database:** term/kg.nodes materialization, `node_urls` from on-chain URIs, `raw_type` extension, Drizzle + Timescale schema |
| [03-track-parsing-classification.md](03-track-parsing-classification.md) | **Track 3 — Parser & classification:** `intuition_identifier` parse kind, `@0xintuition/iid` adoption, scheme→classification mapping, worker parse/classify stages |
| [04-track-enrichment.md](04-track-enrichment.md) | **Track 4 — Enrichment:** identifier-keyed provider lookups (ISRC→Spotify/MusicBrainz, ISBN, DOI, QID, CAIP…), worker enrichment stage, atom-services |
| [05-track-seed-pipeline.md](05-track-seed-pipeline.md) | **Track 5 — Seed data pipeline (intuition-v2):** ladder-driven IID derivation replacing JSON-LD assembly, identifier-projection convergence, write paths, URIs sourcing |
| [06-track-api-explorer-qa.md](06-track-api-explorer-qa.md) | **Track 6 — API, explorer, devnet & QA:** API serialization/OpenAPI, explorer rendering, devnet acceptance atoms, smoke tests, docs, end-to-end verification |

## Research base

Plan synthesized from:

- `intuition-v2/.planning/intuition-id/` — the IID spec, scheme registry (25 schemes), classification ladders (37 types), P0/P1/P2 representation profiles, equivalence/dedupe design, decisions D1–D31 (+ proposed D32–D35)
- `intuition-contracts-v2` commit `a402fad` "Feat: Add URIs to Atom Create (#155)" — `createAtomsWithUris` + `AtomContextRegistered` event
- Full code walk of `intuition-core` (crates, packages, services, migrations) and the `intuition-v2` seed pipeline (`lab/data-seed`, `scripts/import-data`, seed control plane)
