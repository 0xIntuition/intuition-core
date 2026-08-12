# Semantic atom reader exposure runbook

This runbook controls only the additive API and Explorer read model introduced
for IID identity, atom context, resolution state, and resolved display fields.
It does not control chain ingestion, worker behavior, or `POST /api/atoms`,
which remains an off-chain KG insert endpoint.

## Controls

| Boundary | Variable | Default | Effect |
| --- | --- | --- | --- |
| Query API | `API_ATOM_SEMANTIC_READS_ENABLED` | `false` | Adds `raw`, optional `identity`, `classification`, optional `context`, optional `resolution`, and optional `display` to atom responses and expanded triple terms. |
| Explorer | `VITE_ATOM_SEMANTIC_READS_ENABLED` | `false` | Prefers resolved labels/images and renders optional identity/context sections. |

Both controls accept only `true`/`1` as enabled. The API rejects ambiguous
values at startup. The Explorer treats every other value as disabled.

## Preconditions

Before enabling either boundary:

1. Legacy API contract tests and Explorer tests pass.
2. IID parsing evidence is populated only by the authoritative parser.
3. Context reads preserve on-chain order and raw evidence; an unavailable
   context reader omits the field instead of returning a fabricated empty list.
4. Resolution/display fields carry the expected source and freshness evidence.
5. Unsafe context values render as text. Only credential-free HTTP(S) values
   become external links.

## Enable sequence

1. Deploy the API build with `API_ATOM_SEMANTIC_READS_ENABLED=false`.
2. Verify legacy responses for atom list, detail, and expanded triples.
3. Set `API_ATOM_SEMANTIC_READS_ENABLED=true` on one API canary and restart it.
4. Compare the same legacy and IID fixtures through the canary. Confirm all
   legacy fields remain byte-for-byte compatible and optional fields appear
   only when backed by evidence.
5. Roll the API flag to the remaining replicas.
6. Build/start one Explorer canary with
   `VITE_ATOM_SEMANTIC_READS_ENABLED=true`.
7. Verify unresolved IID, resolved IID, legacy JSON, empty-context, unsafe URI,
   and expanded-triple states.
8. Promote the Explorer build after consumer sign-off.

API exposure should precede Explorer exposure. The two independent gates make
it possible to inspect the wire contract before changing visible labels.

For the local Compose API canary, use:

```bash
API_ATOM_SEMANTIC_READS_ENABLED=true \
  docker compose up -d --no-deps --force-recreate api
docker compose logs --tail=100 api
```

The Explorer control is consumed by Vite. It requires a new dev process or
production build; changing the variable underneath an already-built bundle has
no effect:

```bash
cd apps/explorer
VITE_ATOM_SEMANTIC_READS_ENABLED=true \
  VITE_API_URL="$API_URL" \
  bun run build
bun run start
```

## Stop conditions

Immediately stop exposure when any of these occurs:

- a legacy response field disappears or changes meaning;
- context is reported empty when the reader is unavailable;
- URI order/provenance is lost or an unsafe value becomes clickable;
- unresolved IIDs cause a blank or crashing atom page;
- raw IID replaces an available resolved display name;
- expanded triple terms leak non-public atom data;
- API error rate or latency exceeds the existing service budget.

## Rollback

1. Set `VITE_ATOM_SEMANTIC_READS_ENABLED=false` and restore/restart the previous
   Explorer build configuration. This immediately restores raw-data labels and
   hides identity/context sections.
2. Set `API_ATOM_SEMANTIC_READS_ENABLED=false` on API replicas and restart or
   roll them. Atom endpoints then return their legacy shapes.
3. Do not roll back additive schema, context ingestion, or stored evidence
   unless those components have an independent incident.
4. Keep IID/URI writers disabled and reconcile any already-submitted writes
   through their transaction ledger before resuming rollout.

Local Compose API rollback is explicit and does not touch databases:

```bash
API_ATOM_SEMANTIC_READS_ENABLED=false \
  docker compose up -d --no-deps --force-recreate api
docker compose logs --tail=100 api
```

Rebuild/restart Explorer with `VITE_ATOM_SEMANTIC_READS_ENABLED=false`, or
redeploy the last known-good bundle. No schema rollback or data deletion is
part of this procedure.

## Verification commands

```bash
curl -fsS "$API_URL/api/atoms?limit=1"
curl -fsS "$API_URL/api/atoms/$ATOM_ID"
curl -fsS "$API_URL/api/triples/$TRIPLE_ID?expand=terms"
```

With API exposure disabled, `raw`, `identity`, `classification`, `context`,
`resolution`, and `display` are absent unless a field with the same name was
already part of the legacy database row. With exposure enabled, raw legacy
fields remain and the semantic envelope is additive.

## Metrics decision

Core currently has no Prometheus registry or normalized-route instrumentation
inside `services/api`, and browser-side counters would be incomplete and easy
to distort. This PR therefore does not invent an in-memory metric path solely
for rollout. Use existing API platform request/error/latency telemetry plus
fixture comparisons during the canary.

When API Prometheus instrumentation is introduced, add bounded-cardinality
counters using only controlled labels such as `surface`, `enabled`, and
`fallback_kind`. Never label by atom ID, IID, URI, query text, provider payload,
or error message. Worker and projection metrics remain owned by their services.
