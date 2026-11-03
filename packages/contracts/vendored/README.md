# Vendored contract artifacts

Compiled artifacts retained by the devnet deployer. These fill package export
gaps or use deployer-specific compiler settings:

| Artifact | Source | Why vendored |
| --- | --- | --- |
| `TransparentUpgradeableProxy` | `@openzeppelin/contracts@5.4.0` | Every protocol contract is deployed behind one (`_disableInitializers()` in the implementations makes proxies mandatory); the package ships no proxy bytecode. |
| `UpgradeableBeacon` | `@openzeppelin/contracts@5.4.0` | AtomWallet instances are beacon proxies. |
| `MultiVaultSizeFit` | `@0xintuition/contracts-v2` `src/protocol/MultiVault.sol` | `optimizer_runs=200` build (runtime 20,913 B) for EIP-170 chains. Its `MultiVaultLib` placeholder must be linked before deployment. |

Compiler settings mirror `intuition-contracts-v2` `foundry.toml`: solc
`0.8.29`, `optimizer_runs = 10_000`, `evm_version = "cancun"`,
`bytecode_hash = "none"` (no metadata hash → deterministic output).

**Regenerate** after bumping `@0xintuition/contracts-v2` (requires forge + bun):

```bash
packages/contracts/scripts/regen-vendored.sh
```

The script compiles from the npm package's own `./src/*` export — never from a
git clone — so artifacts are always reproducible from the pinned version.

**Licensing**: the OpenZeppelin artifacts are MIT. `MultiVaultSizeFit` is compiled from
[`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2)
source, which is **BUSL-1.1** — these compiled artifacts inherit that license
(both this repo and the contracts are 0xIntuition projects; the artifacts are
vendored here solely to deploy the protocol to development chains).

`AtomWarden`, `WrappedTrust`, and `TimelockController` now use the ABI and
bytecode exports of `@0xintuition/contracts-v2@1.1.0-alpha.1`. Only the two
OpenZeppelin proxy artifacts and the size-fit MultiVault build remain local.
