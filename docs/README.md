# Documentation

Start here:

| Guide | What it covers |
| --- | --- |
| **[run-your-own-node.md](./run-your-own-node.md)** | clone → boot → first atom → triples → classify/enrich → index the chain |
| **[api-reference.md](./api-reference.md)** | every endpoint with real request/response payloads and error shapes |
| **[local-devnet.md](./local-devnet.md)** | fully self-contained: Anvil + the real contracts + your own indexed chain |
| **[architecture.md](./architecture.md)** | the pipeline, the two databases, deterministic identity, reliability model |
| **[configuration.md](./configuration.md)** | every environment variable, by service and tier |
| **[release-process.md](./release-process.md)** | crate/image release order, verification, rollback, and deferred artifacts |
| **[rust-crate-boundaries.md](./rust-crate-boundaries.md)** | public Rust crate split for primitives/events and what stays service-local |
| **[container-images.md](./container-images.md)** | public image names, OCI labels, registry choice, and context rules |
| **[indexing-scope.md](./indexing-scope.md)** | layered operator scope: ingestion, projections, processing, and read filters |
| **[classification-taxonomy.md](./classification-taxonomy.md)** | music and podcast domain taxonomy for scoped processing |
| **[contracts.md](./contracts.md)** | contract artifact source of truth, ABI sync, and package consumption |
| **[enrichment-providers.md](./enrichment-providers.md)** | what works keyless, and how to get each provider key |
| **[writing-a-classification-plugin.md](./writing-a-classification-plugin.md)** | extend classification to your domain — with a runnable example package |
| **[writing-an-enrichment-plugin.md](./writing-an-enrichment-plugin.md)** | add a new metadata source — artifacts, schemas, fail-soft rules |
| **[troubleshooting.md](./troubleshooting.md)** | the failure modes we've actually hit, with fixes |

Repo-level: [README](../README.md) · [CONTRIBUTING](../CONTRIBUTING.md) ·
[SECURITY](../SECURITY.md) · [CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md)
