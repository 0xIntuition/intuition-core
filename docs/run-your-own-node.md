# Run your own node

From clone to a queryable knowledge graph. Everything here works with **zero paid
accounts** — the Intuition testnet RPC is public and keyless.

## Prerequisites

- **Docker** (Compose v2)
- **Bun** ≥ 1.3 (`curl -fsSL https://bun.sh/install | bash`)
- Rust only if you want to build the indexer crates natively (`cargo check --workspace`)

## 1. Boot the stack

```bash
git clone <this repo> && cd intuition-core
scripts/bootstrap.sh
```

That runs preflight checks, creates `.env` from `example.env` when needed,
installs dependencies, starts Docker Compose, waits for `localhost:3000/health`,
and prints the first API commands. `make bootstrap` is the equivalent Makefile
entrypoint.

Manual startup remains available:

```bash
cp example.env .env
bun install
docker compose up
```

To skip local service builds and run published GHCR images from a clean
checkout, use the published-image override:

```bash
cp example.env .env
make up-published IMAGE_TAG=vX.Y.Z
make smoke-published IMAGE_TAG=vX.Y.Z
```

Use semver or release-candidate tags for local trials. Use digest pins copied
from the publish workflow summary for production or reproducible release
verification. See [container-images.md](./container-images.md#running-published-images).

What comes up:

| Service | Port | What it is |
| --- | --- | --- |
| `postgres-kg` | 5432 | knowledge graph (atoms, triples, accounts, predicates) |
| `timescale` | 5433 | event store + market read models |
| `redis` | 6379 | indexer leader election |
| `migrate` / `timescale-migrate` | — | one-shot: apply both schemas + seed baseline predicates, then exit 0 |
| `api` | 3000 | auth-free read / key-gated write REST |
| `atom-services` | 4010 | stateless classify/enrich HTTP |
| `workers-*` | — | parse → classify → enrich pipeline over new atoms |

```bash
curl localhost:3000/health          # {"status":"ok"}
curl localhost:3000/api/predicates  # 14 baseline predicates
```

## 2. Create your first atom

Writes need an API key (see [Auth](#auth--api-keys) — or set `API_AUTH=open` for local hacking):

```bash
# Mint a key bound to your wallet (printed once — store it)
cd services/api
DATABASE_KG_URL=postgresql://intuition:intuition@localhost:5432/intuition_kg \
  bun run keys:create -- --name me --account 0xYourWallet

# Create an atom from any URL, string, or JSON
curl -X POST localhost:3000/api/atoms \
  -H "Authorization: Bearer ik_…" \
  -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/oven-sh/bun"}'
# → {"data":{"id":"0x951d…","created":true,"createdBy":"0xYourWallet"}}
```

The ID is a **pure function of the bytes** — the exact atom ID MultiVault would
register onchain. Posting the same input twice returns the same atom (idempotent).
The workers pick it up automatically: within seconds it is parsed, classified
(`SoftwareSourceCode` for the URL above), and enriched (OpenGraph, favicon,
GitHub metadata — no API keys needed for public sources).

```bash
curl localhost:3000/api/atoms/0x951d…   # watch parse/classify/enrich complete
```

## 3. Connect atoms with triples

```bash
curl -X POST localhost:3000/api/triples \
  -H "Authorization: Bearer ik_…" \
  -H 'Content-Type: application/json' \
  -d '{"subject_id":"0x951d…","predicate_id":"0x0840db…","object_id":"0x49ed…"}'
```

Triple IDs are deterministic too: `keccak(TRIPLE_SALT, subject, predicate, object)`.
Read them back from any position via the hexastore:

```bash
curl "localhost:3000/api/atoms/0x951d…/triples"
```

## 4. Classify and enrich any URL (stateless)

No database writes — hand `atom-services` a URL and get the intelligence back:

```bash
curl -X POST localhost:4010/v1/classify -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/vercel/next.js"}'
# → {"classification":{"type":"url","domain":"github","subtype":"repo","confidence":0.97}}

curl -X POST localhost:4010/v1/process -H 'Content-Type: application/json' \
  -d '{"rawInput":"https://en.wikipedia.org/wiki/Ethereum"}'
# → classification + enrichment artifacts (OpenGraph, JSON-LD, Wikipedia extract, Wikidata entity)
```

Provider API keys (Spotify, Etherscan, TMDB, …) are optional — plugins
without keys degrade gracefully or skip. **[enrichment-providers.md](./enrichment-providers.md)**
lists what works keyless and how to get each key.

## 5. Index the chain

Point the indexer at the Intuition chain (or any MultiVault deployment) and
reconstruct the graph yourself. Set in `.env`:

```bash
INTUITION_RPC_URL=https://testnet.rpc.intuition.systems/http   # public, keyless
CHAIN_ID=13579
MULTIVAULT_CONTRACT_ADDRESS=0xeBc49d356B7f64D888130D85CC6D17114a6843ec
MULTIVAULT_START_BLOCK=9030416
# Cheap test run: bound the range instead of syncing to head
MULTIVAULT_END_BLOCK=9032416
```

```bash
docker compose --profile indexing up
```

Events land in the Timescale event store, ~20 checkpointed projection workers
fan them into typed read models, and `core_entities` writes the atoms/triples
into the KG — where the same workers and API serve them. A 2,000-block test
window indexes in under a second once synced.

Remove `MULTIVAULT_END_BLOCK` (or leave it empty) for a full sync to head.

## Auth & API keys

| `API_AUTH` | Reads | Writes |
| --- | --- | --- |
| `public-read` *(default)* | open | require a key |
| `gated` | require a key | require a key |
| `open` | open | open (unattributed) |

Keys are minted per account (wallet): everything written with a key is
attributed via `created_by`. Only the SHA-256 hash is stored.

```bash
bun run keys:create -- --name partner --account 0x…   # add --read-only for read keys
bun run keys:list
bun run keys:revoke -- --id key_…
```

## Where to go next

- [architecture.md](./architecture.md) — how the pipeline fits together
- [configuration.md](./configuration.md) — every environment variable
- [troubleshooting.md](./troubleshooting.md) — the failure modes we've actually hit
