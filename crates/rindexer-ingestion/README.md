# `rindexer-ingestion`

Chain event ingestion service for Intuition Core.

This crate decodes MultiVault events through rindexer-generated code and writes
the append-only event store consumed by projections. It is distributed as a
container image target, not as a public library crate.

`event_store.event_type` is intentionally forward-compatible rather than a
database whitelist: generated event decoding and the per-event typed tables are
the canonical contract. `AtomContextRegistered` URI values are stored in
contract order as opaque `0x`-prefixed byte strings; ingestion does not decode,
normalize, fetch, or validate URI schemes.

Operators should configure event/block scope through the rindexer manifest and
environment variables documented in `../../docs/indexing-scope.md`.
