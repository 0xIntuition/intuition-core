#!/usr/bin/env bun

import {
	buildIndexingScopeDryRun,
	renderRindexerManifestPreview,
} from '../packages/types/src/indexing-scope';

const defaultConfigPath = 'docs/indexing-scope.example.json';
const configPath = process.argv[2] ?? defaultConfigPath;

async function main() {
	const config = await readJsonConfig(configPath);
	const dryRun = buildIndexingScopeDryRun(config);
	const manifestPreview = renderRindexerManifestPreview(dryRun);

	console.log(
		JSON.stringify(
			{
				status: 'ok',
				configPath,
				dryRun,
				rindexerManifestPreview: manifestPreview,
			},
			null,
			2
		)
	);
}

async function readJsonConfig(path: string): Promise<unknown> {
	try {
		return await Bun.file(path).json();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`failed to read JSON IndexingScope config at ${path}: ${message}`);
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`scope-dry-run: ${message}`);
	process.exit(1);
});
