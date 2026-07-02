import { describe, expect, it } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PACKAGE_ROOT = join(import.meta.dir, '..');
const SRC_ROOT = join(PACKAGE_ROOT, 'src');
const PLUGINS_ROOT = join(PACKAGE_ROOT, 'plugins');

const bannedImportPatterns = [
	/@0xintuition\/database-/,
	/@0xintuition\/database\b/,
	/from\s+['"][^'"]*\/database(?:\/|['"])/,
	/from\s+['"][^'"]*\/persistence(?:\/|['"])/,
	/from\s+['"][^'"]*\/storage(?:\/|['"])/,
];

describe('package boundary contract', () => {
	it('does not import database or persistence modules in source files', () => {
		const roots = [SRC_ROOT, PLUGINS_ROOT].filter((root) => existsSync(root));
		const files = roots
			.flatMap((root) => listFilesRecursively(root))
			.filter((file) => file.endsWith('.ts'));
		const violations: string[] = [];

		for (const filePath of files) {
			const content = readFileSync(filePath, 'utf8');
			for (const pattern of bannedImportPatterns) {
				if (pattern.test(content)) {
					violations.push(`${relative(PACKAGE_ROOT, filePath)} violates ${String(pattern)}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	it('does not declare database/persistence packages as dependencies', () => {
		const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};

		const deps = Object.keys(packageJson.dependencies ?? {});
		const devDeps = Object.keys(packageJson.devDependencies ?? {});
		const allDeps = [...deps, ...devDeps];

		const banned = allDeps.filter((name) => /^@0xintuition\/database-/.test(name));
		expect(banned).toEqual([]);
	});
});

function listFilesRecursively(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];

	for (const entry of entries) {
		const absolute = join(root, entry);
		const stats = statSync(absolute);

		if (stats.isDirectory()) {
			files.push(...listFilesRecursively(absolute));
		} else if (stats.isFile()) {
			files.push(absolute);
		}
	}

	return files;
}
