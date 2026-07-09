# Vendored contract artifacts

Compiled artifacts the devnet deployer needs but `@0xintuition/contracts-v2`
does not (yet) export:

| Artifact | Source | Why vendored |
| --- | --- | --- |
| `TransparentUpgradeableProxy` | `@openzeppelin/contracts@5.4.0` | Every protocol contract is deployed behind one (`_disableInitializers()` in the implementations makes proxies mandatory); the package ships no proxy bytecode. |
| `TimelockController` | `@openzeppelin/contracts@5.4.0` | Owns the proxy admins (upgrades) and parameter changes in the canonical deploy. |
| `UpgradeableBeacon` | `@openzeppelin/contracts@5.4.0` | AtomWallet instances are beacon proxies. |
| `AtomWarden` | `@0xintuition/contracts-v2` `src/protocol/wallet/AtomWarden.sol` | Missing from the package's `/abis` + `/bytecodes` exports. |
| `WrappedTrust` | `@0xintuition/contracts-v2` `src/WrappedTrust.sol` | Missing from the package's exports; the devnet uses it as the TRUST token. |
| `MultiVaultSizeFit` | `@0xintuition/contracts-v2` `src/protocol/MultiVault.sol` | `optimizer_runs=200` build (runtime 24,033 B) for EIP-170 chains — Intuition Sepolia enforces the cap, so the package's production `optimizer_runs=10000` bytecode (27,666 B runtime) cannot deploy there. |

Compiler settings mirror `intuition-contracts-v2` `foundry.toml`: solc
`0.8.29`, `optimizer_runs = 10_000`, `evm_version = "cancun"`,
`bytecode_hash = "none"` (no metadata hash → deterministic output).

**Regenerate** after bumping `@0xintuition/contracts-v2` (requires forge + bun):

```bash
packages/contracts/scripts/regen-vendored.sh
```

The script compiles from the npm package's own `./src/*` export — never from a
git clone — so artifacts are always reproducible from the pinned version.

**Licensing**: the OpenZeppelin artifacts are MIT. `AtomWarden`,
`WrappedTrust`, and `MultiVaultSizeFit` are compiled from
[`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2)
source, which is **BUSL-1.1** — these compiled artifacts inherit that license
(both this repo and the contracts are 0xIntuition projects; the artifacts are
vendored here solely to deploy the protocol to development chains).

**Upstream plan**: these files disappear once `@0xintuition/contracts-v2`
exports `AtomWarden`/`WrappedTrust` and the OZ infra bytecodes (tracked for
`1.0.0-alpha.1`; see `docs/local-devnet.md` follow-ups).
