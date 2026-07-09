# @0xintuition/contracts

The monorepo's single protocol surface. Everything protocol-shaped flows from
the **pinned** [`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2)
npm package through this workspace package:

- **`./multivault`** — MultiVault constants for the indexer boundary
  (`MULTIVAULT_RINDEXER_EVENTS`, canonical ABI JSON used by the drift test).
- **`./abis`** — viem-typed ABIs for every protocol contract (single import
  point; includes `AtomWardenAbi`/`WrappedTrustAbi` from the vendored
  artifacts the package doesn't export yet).
- **`./addresses`** — network address book (Intuition Sepolia `13579`) and the
  devnet state-file loader (`devnet/deployments-devnet.json`).
- **`./deploy`** — the local devnet deployer: replays the canonical
  `IntuitionDeployAndSetup.s.sol` sequence with viem against anvil (chain
  `31337`), using the package's **production bytecode**. See
  [docs/local-devnet.md](../../docs/local-devnet.md).

```bash
# deploy to a running `anvil --disable-code-size-limit` (repo root):
bun run devnet:deploy

# stand up a fresh, self-owned instance on Intuition Sepolia (chain 13579):
PRIVATE_KEY=0x… bun run testnet:deploy
```

The testnet deploy needs a funded key (~40 txs of tTRUST gas — faucet:
https://testnet.hub.intuition.systems). It reuses the canonical WTRUST
(`TRUST_TOKEN=fresh` deploys your own), writes
`devnet/deployments-testnet.json`, runs the createAtoms acceptance test, and
prints the `.env` block that points the Core indexer at your new instance.

Version bumps: update `@0xintuition/contracts-v2` here, then run
`bun run abis:sync` (regenerates the rindexer's JSON ABI; CI gates drift) and
`scripts/regen-vendored.sh` (recompiles vendored artifacts). Full checklist in
[docs/local-devnet.md](../../docs/local-devnet.md#upgrading-the-contracts).
