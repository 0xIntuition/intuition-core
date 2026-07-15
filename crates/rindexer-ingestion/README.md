# `rindexer-ingestion`

Chain event ingestion service for Intuition Core.

This crate decodes MultiVault events through rindexer-generated code and writes
the append-only event store consumed by projections. It is distributed as a
container image target, not as a public library crate.

Operators should configure event/block scope through the rindexer manifest and
environment variables documented in `../../docs/indexing-scope.md`.
