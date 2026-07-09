import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getMultiVaultAbiJson } from '../src/multivault';

const repoRoot = resolve(import.meta.dir, '../../..');
const multiVaultAbiPath = resolve(repoRoot, 'crates/rindexer-ingestion/abi/MultiVault.json');

await writeFile(multiVaultAbiPath, `${getMultiVaultAbiJson()}\n`);

console.log(`wrote ${multiVaultAbiPath}`);
