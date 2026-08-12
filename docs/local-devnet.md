# Local devnet — your own chain, fully self-contained

Run the **entire** Intuition stack with zero external dependencies: a local
Anvil chain, the real Intuition contracts deployed onto it, and the indexer
reconstructing the graph from *your* chain. Create atoms onchain, watch them
land in your knowledge graph, classified and enriched — all on your machine,
even offline (after the first image fetch).

The contracts come from the published
[`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2)
npm package — ABIs and **production bytecode** (the exact `optimizer_runs=10000`
build that runs on Intuition mainnet), pinned by version in
`packages/contracts/package.json`. No git clone, no Foundry build step: the
deployer (`packages/contracts/src/deploy/`) replays the canonical deployment
sequence with [viem](https://viem.sh) in a few seconds.

## 1. Start the chain + deploy the contracts

```bash
docker compose --profile devnet up -d anvil devnet-deploy
docker compose logs -f devnet-deploy   # watch: deploy → acceptance test
# or: make devnet
```

The one-shot `devnet-deploy` job deploys the full system (WrappedTrust →
emissions controllers → MultiVault implementation → proxies + bonding curves +
roles) straight from the npm package, and finishes by creating a test atom and
verifying the `AtomCreated` event fires. Re-runs detect the existing
deployment and just re-verify.

The deployment is deterministic for a fresh Anvil state, but the persisted
volume may already contain transactions and deployments. Always treat
`devnet/deployments-devnet.json` as authoritative for the MultiVault address
and start block. Chain state persists on the `anvil_data` volume across
restarts.

## 2. Point the indexer at your chain

In `.env`:

```bash
INTUITION_RPC_URL=http://anvil:8545
CHAIN_ID=31337
# Copy these two values from devnet/deployments-devnet.json.
MULTIVAULT_CONTRACT_ADDRESS=0x...
MULTIVAULT_START_BLOCK=...
MULTIVAULT_END_BLOCK=
USE_TYPED_READER=true
```

```bash
docker compose --profile devnet --profile indexing up
```

The indexer follows your local chain head; every atom you create onchain shows
up in the graph within seconds.

## 3. Create canonical IID atoms with URI context

The canonical acceptance command creates one music recording and one book:

```bash
bun run devnet:fixtures:iid
```

It creates `int:isrc:USUM71703861` with MusicBrainz context and
`int:isbn:9780684832722` with OpenLibrary context. The command:

- refuses to run on any chain except Anvil chain `31337`;
- reads the active deployment and URI limits from chain state;
- derives the term ID from IID bytes only;
- simulates `createAtomsWithUris` before sending;
- joins `AtomCreated` and `AtomContextRegistered` by exact `termId`; and
- is idempotent when the atoms already exist.

With semantic API reads enabled, verify the final read models using the term
IDs printed by the command:

```bash
API_ATOM_SEMANTIC_READS_ENABLED=true docker compose up -d api
curl "localhost:3000/api/atoms/<term-id>"
curl "localhost:3000/api/iids/int%3Aisbn%3A9780684832722/atoms"
```

The atom detail must show identity, classification, resolution, display, and
on-chain context as separate fields. The context transaction hash and log
index must match the `AtomContextRegistered` event—not the adjacent
`AtomCreated` event.

## 4. Create arbitrary atoms onchain

Anvil's account #0 is pre-funded (key
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` — the
universal Foundry dev key, safe only for local chains):

```bash
MV=$(jq -r .MultiVault devnet/deployments-devnet.json)
COST=$(cast call $MV "getAtomCost()(uint256)" --rpc-url http://localhost:8545 | awk '{print $1}')

cast send $MV "createAtoms(bytes[],uint256[])" \
  "[$(cast from-utf8 'https://github.com/oven-sh/bun')]" "[$COST]" \
  --value $COST \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --rpc-url http://localhost:8545
```

Then watch the full loop close:

```bash
curl localhost:3000/api/stats            # atom count grows
curl "localhost:3000/api/atoms?limit=1"  # your onchain atom — parsed, classified, enriched
```

`msg.value` must equal the sum of the assets array, and each entry must be
≥ `getAtomCost()` (creation fee + minimum share). Atom data must be unique —
creating the same bytes twice reverts with `MultiVault_AtomExists`, which is
the deterministic-identity guarantee doing its job onchain.

## Running natively (no Docker)

With [Foundry](https://getfoundry.sh)'s `anvil` installed:

```bash
anvil --disable-code-size-limit &   # terminal 1
bun run devnet:deploy               # terminal 2 — deploy + acceptance test
bun run devnet:fixtures:iid         # canonical ISRC + ISBN fixtures
```

Or run the whole native dev stack (datastores, API, workers, chain) under
Process Compose:

```bash
bun run dev:local -- indexing --devnet   # fully self-contained chain-to-API loop
```

## Deploy your own testnet instance

The same deployer stands up a fresh, self-owned protocol instance on
**Intuition Sepolia** (chain 13579) — your own MultiVault + emissions system,
isolated from the canonical deployment:

```bash
PRIVATE_KEY=0x… bun run testnet:deploy
```

Requirements: a key funded with tTRUST for gas (~40 transactions — faucet at
https://testnet.hub.intuition.systems). The canonical wrapped-TRUST token is
reused by default (it's shared infra, like WETH; set `TRUST_TOKEN=fresh` for a
fully isolated one). State lands in `devnet/deployments-testnet.json`, the
`createAtomsWithUris` acceptance test runs (including URI config and context-event
validation), and the CLI prints the `.env` block that
points the Core indexer at your new instance.

## Upgrading the contracts

The protocol version is pinned in **one place**:
`packages/contracts/package.json` (`@0xintuition/contracts-v2`). To bump it:

1. Update the version, `bun install`.
2. `bun run abis:sync` — regenerates the JSON ABIs consumed outside TypeScript
   (`crates/rindexer-ingestion/abi/MultiVault.json`). CI fails on drift, and an
   **event-shape change is an indexer-breaking change** (AtomCreated,
   TripleCreated, Deposited, Redeemed, SharePriceChanged, ProtocolFeeAccrued).
3. `packages/contracts/scripts/regen-vendored.sh` — recompiles the vendored
   artifacts (AtomWarden, WrappedTrust) from the new package source.
4. If the canonical deploy scripts changed upstream, mirror the change in
   `packages/contracts/src/deploy/system.ts` (it replicates
   `IntuitionDeployAndSetup.s.sol`) and re-run the acceptance test.

## Gotchas we already hit for you

- **Contract size and linking:** the default local deployment uses
  MultiVaultMigrationMode and requires Anvil's `--disable-code-size-limit`.
  MultiVault and MultiVaultMigrationMode also contain a `MultiVaultLib` link
  placeholder; the deployer deploys the library first and links its address
  into the selected implementation bytecode.
- **Proxies are mandatory:** the implementations call `_disableInitializers()`
  in their constructors; everything is initialized through
  `TransparentUpgradeableProxy` init-data, exactly like production.
- **Deploy block is not deterministic** (Anvil batches vary) — read it from
  `deployments-devnet.json` if you need it; `MULTIVAULT_START_BLOCK=0` is fine.
- The deployer account must be the admin (the deploy makes admin-only calls);
  the deployer defaults to Anvil account #0 for both.

## Upstream artifact follow-ups

The npm package doesn't yet export everything a from-scratch deployment needs;
`packages/contracts/vendored/` fills the remaining gaps (see its README for
provenance). Follow-up cleanup is:

- Move the remaining `AtomWarden` + `WrappedTrust` consumers to the exports now
  available in `@0xintuition/contracts-v2@1.1.0-alpha.0` and delete those
  vendored copies.
- Ship the OZ infra bytecodes (`TransparentUpgradeableProxy`,
  `TimelockController`, `UpgradeableBeacon`) or a first-party deploy module.
- Publish an EIP-170-compatible MultiVault artifact (or a reproducible build
  profile) alongside its library link references.
- Add a `deployments` export (canonical addresses per chain).
