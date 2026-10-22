# URI creation conformance

Run the suite against a packed train:

```sh
INTUITION_TRAIN_TARBALLS=/absolute/path/to/train TMPDIR=/tmp bun run test:conformance
```

The train directory is an explicit input. When `INTUITION_TRAIN_TARBALLS` is unset
the suite skips with a visible message; when it is set (including an empty
string), a missing manifest, tarball or digest mismatch fails the run with the
variable named. Node is resolved from `PATH` (override with
`INTUITION_CONFORMANCE_NODE`); an empty override is an error. The harness probes
both executables, requires Node 22 or newer without a Bun identity in the first
slot and a Bun version in the second, and prints both identities with the digest.

The directory must contain `MANIFEST.txt` with tab-separated tarball filename,
package name and version, and `sha256=…` fields for `@0xintuition/protocol`,
`@0xintuition/curves`, `@0xintuition/deployments`, and `@0xintuition/ids`, plus the
corresponding `.tgz` files. Protocol 4.0.0 requires deployments at runtime.
The test verifies each digest before installing these tarballs into an OS temp
consumer outside Core's repository. The real paths of `TMPDIR` and the repository
are checked before creating anything; a temp root equal to or inside the
repository (including through a symlink) is rejected. Point `TMPDIR` outside the
repository. `viem` and its transitive dependencies
resolve through local `file:` references to Core's installed dependency store;
optional peers are omitted, the cache is disposable, and the registry is an
unreachable loopback address. No repository install or runtime dependency is added.
The consumer and its cache are removed after the tests, including on setup failure.

The consumer imports public package names through their exports, rejects a
protocol `src/` deep import, and produces byte-identical output under Node and Bun. Nine vectors cover plain text,
URL, raw hex bytes, JSON, one/two URI contexts, and a three-atom batch with mixed
URI counts. Core independently checks calldata argument order, three-way ABI
shape/selector/topic0 parity, packed versus installed versus KG atom ids, encoded
and decoded ordered context logs, typed event columns, and validation rejection
reasons. The regenerated output must match
[`uri-creation-golden.json`](../tests/conformance/fixtures/uri-creation-golden.json),
which records replay inputs, calldata, term ids, and encoded logs. The fixture is
a replay record; Core's surfaces supply the parity assertions.
For every vector, Core also hashes the decoded calldata atom bytes and checks
that the resulting term id equals the id of the original input.

Guard regressions run separately with `bun test tests/conformance/guards.test.ts`.

Protocol 4.0.0 rejects odd-length hex atom data such as `0xabc` with
`atom data must be even-length hex bytes`. The suite asserts this rejection
through the public validator so calldata bytes and atom ids cannot diverge
through inconsistent padding of odd-length input.

[`POST /api/atoms`](./api-reference.md#post-apiatoms-) ingests an off-chain KG
row; seed/application writers submit `createAtomsWithUris` transactions through
the public builder. This suite does not send transactions or exercise services.
C14 retains devnet mint/index/read proof, provider integration, and load evidence;
passing local conformance does not establish that deferred proof.
