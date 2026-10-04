import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const coreRoot = resolve(import.meta.dir, '../..');
export const kgDirectory = join(coreRoot, 'packages/database-kg');
const packageNames = ['@0xintuition/protocol', '@0xintuition/curves', '@0xintuition/ids'];

type Manifest = {
	name: string;
	version: string;
	dependencies?: Record<string, string>;
};

// Bun's isolated install stores viem under root node_modules/.bun rather than
// root node_modules/viem. Follow Core's existing dependency link to that store.
export async function localDependencyFiles() {
	const viemEntry = Bun.resolveSync('viem', kgDirectory);
	const queue = [await packageDirectory(viemEntry, 'viem')];
	const files: Record<string, string> = {};
	while (queue.length) {
		const directory = queue.shift()!;
		const manifest: Manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		if (files[manifest.name]) continue;
		files[manifest.name] = `file:${directory}`;
		const require = createRequire(join(directory, 'package.json'));
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
	return files;
}

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

export async function prepareConsumer(trainDirectory: string) {
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
	let manifestLines: string[];
	try {
		manifestLines = (await readFile(join(trainDirectory, 'MANIFEST.txt'), 'utf8')).split('\n');
	} catch (error) {
		throw new Error(`INTUITION_TRAIN_TARBALLS: cannot read MANIFEST.txt in ${trainDirectory}`, {
			cause: error,
		});
	}
	const directory = await mkdtemp(join(tempRoot, 'core-c13-consumer-'));
	try {
		await cp(join(coreRoot, 'tests/conformance/consumer'), directory, { recursive: true });
		const dependencies: Record<string, string> = {};
		for (const name of packageNames) {
			const line = manifestLines.find((entry) => entry.split('\t')[1]?.startsWith(`${name} `));
			if (!line) throw new Error(`Train MANIFEST.txt is missing ${name}`);
			const [filename, , digest] = line.split('\t');
			if (!filename.endsWith('.tgz') || filename !== filename.split('/').pop()) {
				throw new Error(`Invalid train tarball filename for ${name}`);
			}
			const tarball = join(trainDirectory, filename);
			const actualDigest = createHash('sha256')
				.update(await readFile(tarball))
				.digest('hex');
			if (digest !== `sha256=${actualDigest}`) throw new Error(`Train digest mismatch for ${name}`);
			dependencies[name] = `file:${tarball}`;
		}
		const localFiles = await localDependencyFiles();
		dependencies.viem = localFiles.viem;
		const template = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
		await writeFile(
			join(directory, 'package.json'),
			JSON.stringify({ ...template, dependencies, overrides: { ...localFiles, ...dependencies } })
		);
		// All required transitive packages use local file: paths. Optional peers
		// (TypeScript, zod, ws native accelerators) are unnecessary for execution.
		// An empty cache and unreachable loopback registry fail closed if a local
		// reference is accidentally omitted; no public registry can be contacted.
		const result = Bun.spawnSync(
			[
				process.execPath,
				'install',
				'--ignore-scripts',
				'--omit',
				'peer',
				'--omit',
				'optional',
				'--cache-dir',
				join(directory, 'cache'),
				'--registry',
				'http://127.0.0.1:9',
			],
			{ cwd: directory, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 }
		);
		if (result.exitCode !== 0) {
			throw new Error(`Offline consumer install failed:\n${result.stdout}\n${result.stderr}`);
		}
		await writeFile(join(directory, 'install-evidence.txt'), result.stdout);
		return directory;
	} catch (error) {
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}
