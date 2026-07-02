import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const packageRoot = join(import.meta.dir, '..');
const sourceRoot = join(packageRoot, 'src');

const bannedModulePatterns = [
	'redis',
	'ioredis',
	'@upstash/redis',
	'bull',
	'bullmq',
	'kafkajs',
	'amqplib',
	'pg',
	'@prisma/client',
	'typeorm',
	'mongoose',
	'knex',
	'sequelize',
] as const;

describe('static dependency guard', () => {
	it('does not import database, queue, or stream adapters in package core', () => {
		const files = walkFiles(sourceRoot).filter(
			(path) => path.endsWith('.ts') || path.endsWith('.tsx')
		);
		const violations: string[] = [];

		for (const filePath of files) {
			const source = readFileSync(filePath, 'utf8');
			const moduleSpecifiers = findModuleSpecifiers(source);

			for (const moduleName of moduleSpecifiers) {
				if (isBannedModule(moduleName)) {
					violations.push(`${filePath}: ${moduleName}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});

function walkFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];

	for (const entry of entries) {
		const path = join(root, entry);
		const stats = statSync(path);
		if (stats.isDirectory()) {
			files.push(...walkFiles(path));
			continue;
		}

		files.push(path);
	}

	return files;
}

function findModuleSpecifiers(source: string): string[] {
	const moduleSpecifiers: string[] = [];
	const staticImportPattern = /(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/g;
	const sideEffectImportPattern = /import\s+['"]([^'"]+)['"]/g;
	const dynamicImportPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

	for (const pattern of [staticImportPattern, sideEffectImportPattern, dynamicImportPattern]) {
		for (const match of source.matchAll(pattern)) {
			const moduleName = match[1];
			if (moduleName) {
				moduleSpecifiers.push(moduleName);
			}
		}
	}

	return moduleSpecifiers;
}

function isBannedModule(moduleName: string): boolean {
	if (moduleName.startsWith('.')) {
		return false;
	}

	return bannedModulePatterns.some(
		(banned) => moduleName === banned || moduleName.startsWith(`${banned}/`)
	);
}
