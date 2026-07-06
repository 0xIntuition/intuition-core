# Local devnet — your own chain, fully self-contained

Run the **entire** Intuition stack with zero external dependencies: a local
Anvil chain, the real [intuition-contracts-v2](https://github.com/0xIntuition/intuition-contracts-v2)
deployed onto it, and the indexer reconstructing the graph from *your* chain.
Create atoms onchain, watch them land in your knowledge graph, classified and
enriched — all on your machine, even offline (after the first image/contract
fetch).

## 1. Start the chain + deploy the contracts

```bash
docker compose --profile devnet up -d anvil devnet-deploy
docker compose logs -f devnet-deploy   # watch: build → deploy → acceptance test
```

The one-shot `devnet-deploy` job clones the contracts at a **pinned commit**,
builds with Foundry, deploys the full system (WrappedTrust → emissions
controller → MultiVault implementation → proxy + bonding curves + roles), and
finishes by creating a test atom and verifying the `AtomCreated` event fires.
Cold run ≈ 40 s; re-runs detect the existing deployment and just re-verify.

Because Anvil runs with its default mnemonic, the deployment is deterministic:

| Contract | Address (chain 31337) |
| --- | --- |
| **MultiVault proxy** | `0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f` |
| WrappedTrust (WTRUST) | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |

The full address set (plus the actual deploy block) is written to
`devnet/deployments-devnet.json`. Chain state persists on the `anvil_data`
volume across restarts.

## 2. Point the indexer at your chain

In `.env`:

```bash
INTUITION_RPC_URL=http://anvil:8545
CHAIN_ID=31337
MULTIVAULT_CONTRACT_ADDRESS=0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f
MULTIVAULT_START_BLOCK=0
MULTIVAULT_END_BLOCK=
```

```bash
docker compose --profile devnet --profile indexing up
```

The indexer follows your local chain head; every atom you create onchain shows
up in the graph within seconds.

## 3. Create atoms onchain

Anvil's account #0 is pre-funded (key
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` — the
universal Foundry dev key, safe only for local chains):

```bash
MV=0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f
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

With [Foundry](https://getfoundry.sh) installed:

```bash
anvil &                       # terminal 1
./devnet/setup.sh             # terminal 2 — clone (pinned), build, deploy, verify
```

## Upgrading the pinned contracts

`devnet/setup.sh` pins `CONTRACTS_REF` for reproducibility. To move it: bump
the ref, then **re-verify the six event signatures** against
`crates/rindexer-ingestion/abi/MultiVault.json` (AtomCreated, TripleCreated,
Deposited, Redeemed, SharePriceChanged, ProtocolFeeAccrued) — an event-shape
change is an indexer-breaking change.

## Gotchas we already hit for you

- **Contract size:** the build runs with `FOUNDRY_OPTIMIZER_RUNS=200`; at the
  repo default (10,000) MultiVault exceeds the EIP-170 24,576-byte limit.
- **Deploy block is not deterministic** (Anvil batches vary) — read it from
  `deployments-devnet.json` if you need it; `MULTIVAULT_START_BLOCK=0` is fine.
- The deployer account must be the admin (the deploy makes admin-only calls);
  `setup.sh` handles this.
