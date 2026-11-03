# Published package conformance

Install the committed registry lockfile and run the suites:

```sh
bun install --frozen-lockfile
bun run test:conformance
```

No sibling package checkout, tarballs, or opt-in environment variables are required.
The IID suites load public npm exports and the conformance vectors shipped in
`@0xintuition/iid-spec`. Provider tests use fixture transports and stubbed DNS.

The URI suite copies the lockfile-installed protocol, curves, deployments, IDs,
viem, and their dependency closure into an isolated OS temp consumer. It does
not fetch dependencies or execute install scripts. Conflicting dependency versions
fail setup. The real paths of `TMPDIR` and Core are checked before creating
anything; set `TMPDIR` outside the repository. The consumer is removed after the
suite, including on setup failure.

Node is resolved from `PATH` or `INTUITION_CONFORMANCE_NODE`. An empty override
is an error. The harness requires Node 22 or newer without a Bun identity in
one slot and Bun in the other, and prints both identities with the output digest.

The consumer imports public package exports, rejects a protocol `src/` deep
import, and produces byte-identical output under Node and Bun. Nine vectors cover
plain text, URL, raw hex bytes, JSON, one/two URI contexts, and a three-atom batch
with mixed URI counts. Core independently checks calldata order, published /
size-fit / indexer ABI parity, selectors, event topics, atom IDs, ordered context
logs, typed event columns, and validation rejection reasons. Regenerated output
must match [`uri-creation-golden.json`](../tests/conformance/fixtures/uri-creation-golden.json).
The validator also rejects odd-length hex data so encoded bytes and atom IDs agree.

These suites do not send transactions or exercise running services. Devnet
mint/index/read, live provider integration, and load checks remain separate.
