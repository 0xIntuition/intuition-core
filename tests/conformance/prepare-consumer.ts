import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const coreRoot = resolve(import.meta.dir, '../..');
export const kgDirectory = join(coreRoot, 'packages/database-kg');
const packageNames = [
	'@0xintuition/protocol',
	'@0xintuition/curves',
	'@0xintuition/deployments',
	'@0xintuition/ids',
	'viem',
];

type Manifest = {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
};

async function packageDirectory(entry: string, name: string) {
	let directory = dirname(entry);
	while (directory !== dirname(directory)) {
		try {
			const manifest: Manifest = JSON.parse(
				await readFile(join(directory, 'package.json'), 'utf8')
			);
			if (manifest.name === name) return directory;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		}
		directory = dirname(directory);
	}
	throw new Error(`Installed dependency package not found: ${name}`);
}

/** Isolate the lockfile-installed registry packages without fetching or executing scripts. */
export async function prepareConsumer() {
	const tempRoot = await realpath(tmpdir());
	const repositoryRoot = await realpath(coreRoot);
	const fromRepository = relative(repositoryRoot, tempRoot);
	if (
		fromRepository === '' ||
		(!isAbsolute(fromRepository) &&
			fromRepository !== '..' &&
			!fromRepository.startsWith(`..${sep}`))
	) {
		throw new Error('Point TMPDIR outside the repository before running conformance');
	}
	const directory = await mkdtemp(join(tempRoot, 'core-c13-consumer-'));
	try {
		await cp(join(coreRoot, 'tests/conformance/consumer'), directory, { recursive: true });
		const queue = await Promise.all(
			packageNames.map((name) => packageDirectory(Bun.resolveSync(name, kgDirectory), name))
		);
		const versions = new Map<string, string>();
		while (queue.length) {
			const source = queue.shift()!;
			const manifest: Manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
			const installed = versions.get(manifest.name);
			if (installed) {
				if (installed !== manifest.version)
					throw new Error(`Conflicting versions of ${manifest.name}`);
				continue;
			}
			versions.set(manifest.name, manifest.version);
			await cp(source, join(directory, 'node_modules', manifest.name), {
				recursive: true,
				dereference: true,
				filter: (path) =>
					path === source || relative(source, path).split(sep)[0] !== 'node_modules',
			});
			const require = createRequire(join(source, 'package.json'));
			for (const name of Object.keys(manifest.dependencies ?? {})) {
				let entry: string;
				try {
					entry = require.resolve(`${name}/package.json`);
				} catch {
					entry = require.resolve(name);
				}
				queue.push(await packageDirectory(entry, name));
			}
		}
		await writeFile(
			join(directory, 'install-evidence.txt'),
			`${versions.size} registry packages isolated\n`
		);
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}
