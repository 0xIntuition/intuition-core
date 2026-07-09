#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const minReleaseAgeSeconds = 1_209_600;
const reviewedMinimumReleaseAgeExcludes = new Set(['@0xintuition/contracts-v2']);
const failures = [];

const dependencySections = [
	'dependencies',
	'devDependencies',
	'peerDependencies',
	'optionalDependencies',
	'catalog',
	'overrides',
	'resolutions',
];

const ignoredDirectories = new Set([
	'.git',
	'.next',
	'.turbo',
	'.vercel',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'out',
	'target',
]);

const incidentIocs = [
	'router_init.js',
	'router_runtime.js',
	'tanstack_runner.js',
	'@tanstack/setup',
	'79ac49eedf774dd4b0cfa308722bc463cfe5885c',
	'ab4fcadaec49c03278063dd269ea5eef82d24f2124a8e15d7b90f2fa8601266c',
	'filev2.getsession',
	'seed1.getsession',
	'seed2.getsession',
	'seed3.getsession',
	'litter.catbox.moe',
	'zblgg',
	'voicproducoes',
];

const dependencyGitPattern =
	/^(?:git(?:\+ssh|\+https)?:|github:|https:\/\/github\.com\/|git:\/\/|ssh:\/\/git@)/i;

const toRelativePath = (filePath) => path.relative(repoRoot, filePath) || '.';

const addFailure = (filePath, message) => {
	failures.push(`${toRelativePath(filePath)}: ${message}`);
};

const readTextFile = (filePath) => fs.readFileSync(filePath, 'utf8');

const listFiles = (startPath, predicate) => {
	if (!fs.existsSync(startPath)) {
		return [];
	}

	const entries = fs.readdirSync(startPath, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const entryPath = path.join(startPath, entry.name);

		if (entry.isDirectory()) {
			if (!ignoredDirectories.has(entry.name)) {
				files.push(...listFiles(entryPath, predicate));
			}
			continue;
		}

		if (entry.isFile() && predicate(entryPath)) {
			files.push(entryPath);
		}
	}

	return files;
};

const packageJsonFiles = listFiles(
	repoRoot,
	(filePath) => path.basename(filePath) === 'package.json'
);

const checkBunPolicy = () => {
	const bunfigPath = path.join(repoRoot, 'bunfig.toml');

	if (!fs.existsSync(bunfigPath)) {
		addFailure(bunfigPath, 'missing Bun install policy file');
		return;
	}

	const bunfig = readTextFile(bunfigPath);
	const ageMatch = bunfig.match(/^\s*minimumReleaseAge\s*=\s*(\d+)/m);

	if (!ageMatch) {
		addFailure(bunfigPath, 'missing minimumReleaseAge');
	} else if (Number(ageMatch[1]) < minReleaseAgeSeconds) {
		addFailure(bunfigPath, `minimumReleaseAge must be at least ${minReleaseAgeSeconds} seconds`);
	}

	// Fail on multiple assignments outright: bun honors the LAST one, while a
	// single-match check would only inspect the first — an easy silent bypass.
	const excludeAssignments = [...bunfig.matchAll(/^\s*minimumReleaseAgeExcludes\s*=/gm)];
	if (excludeAssignments.length > 1) {
		addFailure(bunfigPath, 'minimumReleaseAgeExcludes must be assigned at most once');
		return;
	}

	const excludesMatch = bunfig.match(/^\s*minimumReleaseAgeExcludes\s*=\s*\[([^\]]*)\]/m);

	if (excludesMatch) {
		const excludes = [...excludesMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

		for (const excludedPackage of excludes) {
			if (!reviewedMinimumReleaseAgeExcludes.has(excludedPackage)) {
				addFailure(
					bunfigPath,
					`minimumReleaseAgeExcludes contains unreviewed package ${excludedPackage}`
				);
			}
		}

		for (const reviewedPackage of reviewedMinimumReleaseAgeExcludes) {
			if (!excludes.includes(reviewedPackage)) {
				addFailure(
					bunfigPath,
					`missing reviewed minimumReleaseAgeExcludes package ${reviewedPackage}`
				);
			}
		}
	}
};

const checkRootInstallPolicy = () => {
	const rootPackagePath = path.join(repoRoot, 'package.json');
	const nvmrcPath = path.join(repoRoot, '.nvmrc');

	if (!fs.existsSync(nvmrcPath) || readTextFile(nvmrcPath).trim().length === 0) {
		addFailure(nvmrcPath, 'missing non-empty Node version pin');
	}

	for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
		const lockfilePath = path.join(repoRoot, lockfile);
		if (fs.existsSync(lockfilePath)) {
			addFailure(lockfilePath, 'alternate package-manager lockfile is not allowed');
		}
	}

	const packageJson = JSON.parse(readTextFile(rootPackagePath));

	if (!packageJson.packageManager?.startsWith('bun@')) {
		addFailure(rootPackagePath, 'packageManager must pin Bun');
	}

	if (packageJson.scripts?.preinstall !== 'node scripts/enforce-bun-install.mjs') {
		addFailure(rootPackagePath, 'preinstall must enforce Bun-only installs');
	}

	if (!fs.existsSync(path.join(repoRoot, 'scripts/enforce-bun-install.mjs'))) {
		addFailure(rootPackagePath, 'missing scripts/enforce-bun-install.mjs');
	}
};

const getDependencyEntries = (manifest, sectionName) => {
	const section = manifest[sectionName];

	if (!section || typeof section !== 'object' || Array.isArray(section)) {
		return [];
	}

	return Object.entries(section).flatMap(([name, value]) => {
		if (typeof value === 'string') {
			return [[name, value]];
		}

		if (value && typeof value === 'object' && !Array.isArray(value)) {
			return Object.entries(value)
				.filter(([, nestedValue]) => typeof nestedValue === 'string')
				.map(([nestedName, nestedValue]) => [`${name}.${nestedName}`, nestedValue]);
		}

		return [];
	});
};

const checkPackageManifests = () => {
	for (const packagePath of packageJsonFiles) {
		const manifest = JSON.parse(readTextFile(packagePath));

		if ('trustedDependencies' in manifest) {
			addFailure(packagePath, 'trustedDependencies requires explicit review');
		}

		for (const sectionName of dependencySections) {
			for (const [name, version] of getDependencyEntries(manifest, sectionName)) {
				if (dependencyGitPattern.test(version)) {
					addFailure(packagePath, `${sectionName}.${name} uses a Git dependency (${version})`);
				}
			}
		}
	}
};

const checkWorkflowPolicy = () => {
	const workflowFiles = listFiles(path.join(repoRoot, '.github', 'workflows'), (filePath) =>
		/\.ya?ml$/i.test(filePath)
	);
	const sharedSetupPath = path.join(repoRoot, 'tooling/github/setup/action.yml');
	const filesToCheck = fs.existsSync(sharedSetupPath)
		? [...workflowFiles, sharedSetupPath]
		: workflowFiles;

	for (const workflowPath of filesToCheck) {
		const workflow = readTextFile(workflowPath);
		const lines = workflow.split(/\r?\n/);

		if (/\bpull_request_target\b/.test(workflow)) {
			addFailure(workflowPath, 'pull_request_target is not allowed');
		}

		if (/^\s*id-token:\s*write\b/m.test(workflow)) {
			addFailure(workflowPath, 'id-token: write requires explicit publish-job review');
		}

		lines.forEach((line, index) => {
			const trimmedLine = line.trim();

			if (trimmedLine.startsWith('#')) {
				return;
			}

			if (/(^|[\s;&|])bun\s+install\b(?![^\n]*--frozen-lockfile)/.test(line)) {
				addFailure(workflowPath, `line ${index + 1}: bun install must use --frozen-lockfile`);
			}

			if (/(^|[\s;&|])(?:npm|pnpm|yarn)\s+(?:install|i|ci)\b/.test(line)) {
				addFailure(workflowPath, `line ${index + 1}: workflow dependency installs must use Bun`);
			}

			if (/(^|[\s;&|])bun\s+install\b[^\n]*--minimum-release-age=0/.test(line)) {
				addFailure(workflowPath, `line ${index + 1}: minimum release age bypass`);
			}
		});
	}
};

const checkIncidentIocs = () => {
	const scanRoots = [
		path.join(repoRoot, '.github'),
		path.join(repoRoot, 'scripts'),
		path.join(repoRoot, 'tooling'),
		path.join(repoRoot, 'bun.lock'),
		path.join(repoRoot, 'bunfig.toml'),
		path.join(repoRoot, 'package.json'),
	];
	const filesToScan = scanRoots.flatMap((scanRoot) => {
		if (!fs.existsSync(scanRoot)) {
			return [];
		}

		if (fs.statSync(scanRoot).isFile()) {
			return [scanRoot];
		}

		return listFiles(scanRoot, () => true);
	});

	for (const filePath of filesToScan) {
		if (filePath === scriptPath) {
			continue;
		}

		const stats = fs.statSync(filePath);
		if (stats.size > 10 * 1024 * 1024) {
			continue;
		}

		const content = readTextFile(filePath);
		for (const ioc of incidentIocs) {
			if (content.includes(ioc)) {
				addFailure(filePath, `matched incident IOC: ${ioc}`);
			}
		}
	}
};

checkBunPolicy();
checkRootInstallPolicy();
checkPackageManifests();
checkWorkflowPolicy();
checkIncidentIocs();

if (failures.length > 0) {
	console.error('Supply-chain policy guard failed:\n');
	for (const failure of failures) {
		console.error(`- ${failure}`);
	}
	process.exit(1);
}

console.log('Supply-chain policy guard passed.');
