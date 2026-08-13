# Cross-stack semantic atom fixtures

`atom-semantic-read-model.v1.json` is the package-neutral contract shared by
Core API and Explorer tests. It records identity inputs and their semantic
intent, not authoritative canonicalization output. Canonical bytes, normalized
identifiers, anchor eligibility, and atom IDs must eventually be verified
against packed public `@0xintuition/iid` and `@0xintuition/primitives`
artifacts.

The fixture also covers the Core-owned read contract: legacy compatibility,
context ordering/duplicates/link safety, and unresolved/resolved/retryable/
terminal presentation states.

`minimumProfile` describes the minimum representation floor (`p0`/`p1`).
`schemeTyping` separately describes whether the supplied identity is
semantically unambiguous or requires polymorphic typing. These are intentionally
not collapsed into one `profile` label.

The existing smoke paths remain unchanged by default. Optional checks are:

```bash
# API semantic envelope over the existing local smoke atom
API_ATOM_SEMANTIC_READS_ENABLED=true \
SMOKE_EXPECT_SEMANTIC_READS=1 \
bun run smoke

# On a caller-supplied v1.1 chain window, assert context event count without
# replacing the stable legacy testnet window.
MULTIVAULT_START_BLOCK=... \
MULTIVAULT_END_BLOCK=... \
SMOKE_EXPECT_CONTEXT_EVENT_COUNT=... \
bun run smoke:index
```
