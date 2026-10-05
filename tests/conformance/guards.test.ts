import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { coreRoot } from './prepare-consumer';

function probe(overrides: Record<string, string>) {
	const result = Bun.spawnSync(
		[process.execPath, 'test', 'tests/iid-uri-creation-conformance.test.ts'],
		{
			cwd: coreRoot,
			env: {
				...process.env,
				INTUITION_TRAIN_TARBALLS: `${coreRoot}/.train-packages`,
				INTUITION_CONFORMANCE_NODE: Bun.which('node') ?? '',
				...overrides,
			},
			stdout: 'pipe',
			stderr: 'pipe',
			timeout: 60_000,
		}
	);
	return { exitCode: result.exitCode, output: `${result.stdout}\n${result.stderr}` };
}

test('empty-but-set train fails with the variable and missing manifest named', () => {
	const result = probe({ INTUITION_TRAIN_TARBALLS: '' });
	expect(result.exitCode).not.toBe(0);
	expect(result.output).toMatch(/INTUITION_TRAIN_TARBALLS.*MANIFEST\.txt/);
}, 65_000);

test('empty Node override fails instead of falling back to PATH', () => {
	const result = probe({ INTUITION_CONFORMANCE_NODE: '' });
	expect(result.exitCode).not.toBe(0);
	expect(result.output).toMatch(/INTUITION_CONFORMANCE_NODE.*empty/);
});

test('Bun cannot occupy the Node runtime slot', () => {
	const result = probe({ INTUITION_CONFORMANCE_NODE: process.execPath });
	expect(result.exitCode).not.toBe(0);
	expect(result.output).toMatch(/INTUITION_CONFORMANCE_NODE.*Node >= 22.*Bun/);
}, 65_000);

test('repository TMPDIR fails before creating any consumer artifacts', async () => {
	const before = (await readdir(coreRoot)).filter((name) => name.startsWith('core-c13-consumer-'));
	const result = probe({ TMPDIR: coreRoot });
	expect(result.exitCode).not.toBe(0);
	expect(result.output).toMatch(/TMPDIR.*outside the repository/);
	expect((await readdir(coreRoot)).filter((name) => name.startsWith('core-c13-consumer-'))).toEqual(
		before
	);
}, 65_000);
