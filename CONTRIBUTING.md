# Contributing to Intuition Core

Thanks for helping build the open backend of the Intuition knowledge graph.

New here? Start with [docs/run-your-own-node.md](./docs/run-your-own-node.md)
to get a working stack, and [docs/architecture.md](./docs/architecture.md) for
how the pieces fit. Want to add domain coverage? The highest-leverage
contribution is a [classification plugin](./docs/writing-a-classification-plugin.md).

## Ground rules

- **Issue first.** For anything touching public APIs, database schemas, deterministic IDs, classification slugs, or predicate keys, open an issue and agree on scope before writing code. Small fixes (docs, typos, obvious bugs) can go straight to a PR.
- **Determinism is sacred.** Atom/triple IDs, classification output, parser output shapes, and predicate keys are identity-sensitive: changing them forks the graph. Changes to these surfaces require explicit maintainer review and a migration note.
- **The auth boundary is enforced.** Core is the open, auth-free backend. Authentication, billing, and email stay out — a Biome `noRestrictedImports` rule will fail CI if they're imported. Don't work around it.
- **Schema changes ship as migrations.** Edit the Drizzle schema, run `bun run db:generate` in the affected package, and commit the generated SQL alongside the schema change. Never edit committed migration files.

## Development

```bash
bun install                  # Bun only — npm/pnpm/yarn are rejected by preinstall
cp example.env .env
docker compose up            # datastores + auto-migrate
bun run typecheck
bun run test
bunx @biomejs/biome check .  # lint + format
```

All four must be green before review: `typecheck`, `test`, Biome, and `bun run guard:supply-chain`.

## Pull requests

- Short-lived branches, focused diffs, one concern per PR.
- Match the surrounding code's style; Biome is the arbiter of formatting.
- No new dependencies without discussion — installs enforce a 14-day minimum release age, and git-URL deps or lifecycle install scripts are rejected by the supply-chain guard.
- Tests that need a live database must skip cleanly when `DATABASE_KG_URL` / `DATABASE_TIMESCALE_URL` are unset.

## Support

Best-effort, issue-first, community-first. There is no SLA.
