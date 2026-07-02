## What

<!-- One or two sentences: what does this PR change and why? -->

## Checklist

- [ ] `bun run typecheck` · `bun run test` · `bunx @biomejs/biome check .` all green
- [ ] `cargo check --workspace` green (if `crates/` changed)
- [ ] Schema changes ship as generated migrations (never edit committed migration files)
- [ ] No new dependencies without prior discussion (supply-chain guard enforces the rest)
- [ ] Does **not** touch deterministic-ID derivation, classification slugs, or predicate keys
      — or, if it must, links the design issue where that identity change was agreed

## Notes for reviewers

<!-- Anything non-obvious: tradeoffs, follow-ups, how you tested it live. -->
