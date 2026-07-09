#!/usr/bin/env bun
/**
 * Single source of truth for protocol ABIs: `@0xintuition/contracts-v2`.
 *
 * Generates the JSON ABI files consumed by non-TypeScript components (the
 * Rust rindexer reads a plain JSON file) from the pinned npm package, so a
 * version bump in packages/contracts/package.json propagates everywhere and
 * hand-edits are impossible.
 *
 *   bun run abis:sync     rewrite the generated files
 *   bun run abis:check    fail if a generated file is out of sync (CI gate)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MultiVaultAbi } from '@0xintuition/contracts/abis';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** target file (repo-relative) -> ABI exported by the package */
const GENERATED: Record<string, readonly unknown[]> = {
	'crates/rindexer-ingestion/abi/MultiVault.json': MultiVaultAbi,
};

const checkMode = process.argv.includes('--check');
let drifted = 0;

for (const [target, abi] of Object.entries(GENERATED)) {
	const path = resolve(repoRoot, target);
	const generated = `${JSON.stringify(abi, null, '\t')}\n`;
	const current = (() => {
		try {
			return readFileSync(path, 'utf8');
		} catch {
			return null;
		}
	})();

	if (current === generated) {
		console.log(`ok        ${relative(repoRoot, path)}`);
		continue;
	}

	if (checkMode) {
		console.error(`DRIFTED   ${relative(repoRoot, path)} — run \`bun run abis:sync\``);
		drifted += 1;
	} else {
		writeFileSync(path, generated);
		console.log(`written   ${relative(repoRoot, path)}`);
	}
}

if (drifted > 0) {
	process.exit(1);
}
