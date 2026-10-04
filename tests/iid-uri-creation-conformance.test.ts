import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Abi, AbiEvent, AbiFunction, Hex } from 'viem';
import { kgAtomId } from '../packages/database-kg/src/actions/ids';
import { atomContextRegisteredEvents } from '../packages/database-timescale/src/schemas/timescale/events';
import { coreRoot, kgDirectory, prepareConsumer } from './conformance/prepare-consumer';

const viem = await import(Bun.resolveSync('viem', kgDirectory));
const { getTableColumns } = await import(Bun.resolveSync('drizzle-orm', kgDirectory));
const installedIds = await import(Bun.resolveSync('@0xintuition/ids', kgDirectory));
// D-C13-1: the train is an explicit input. Unset means skip; set means the suite
// runs and any missing manifest, tarball or digest mismatch fails loudly.
const trainDirectory =
	process.env.INTUITION_TRAIN_TARBALLS === undefined
		? undefined
		: resolve(process.env.INTUITION_TRAIN_TARBALLS);
const available = trainDirectory !== undefined;
if (!available) {
	console.info(
		'SKIP C13: INTUITION_TRAIN_TARBALLS is not set; point it at a packed train directory (docs/conformance.md).'
	);
}
// Node is part of the gate: resolve it from PATH or an explicit override, never a fixed path.
const nodeBinary = process.env.INTUITION_CONFORMANCE_NODE ?? Bun.which('node');

type RuntimeIdentity = { node: string; bun: string | null };

function runtimeIdentity(binary: string): RuntimeIdentity {
	const result = Bun.spawnSync(
		[binary, '-p', 'JSON.stringify({node: process.version, bun: process.versions.bun ?? null})'],
		{ stdout: 'pipe', stderr: 'pipe', timeout: 10_000 }
	);
	if (result.exitCode !== 0) {
		throw new Error(`Runtime identity probe failed: ${result.stderr}`);
	}
	return JSON.parse(result.stdout.toString());
}

type Golden = {
	publicEntrypoints: {
		protocolVersion: string;
		exports: string[];
		deepImportRejected: boolean;
		installedTarballsOnly: boolean;
	};
	abi: { functionItem: AbiFunction; eventItem: AbiEvent };
	selector: Hex;
	topic0: Hex;
	vectors: {
		name: string;
		atoms: { kind: string; input: string; data: Hex }[];
		inputs: {
			creator: Hex;
			data: Hex[];
			assets: string[];
			uris: Hex[][];
			uriTexts: string[][];
			value: string;
		};
		calldata: Hex;
		selector: Hex;
		termIds: Hex[];
		topic0: Hex;
		logs: { termId: Hex; topics: [Hex, ...Hex[]]; data: Hex }[];
	}[];
	rejections: { name: string; reason: string }[];
};

async function readAbi(path: string): Promise<Abi> {
	const artifact = JSON.parse(await readFile(join(coreRoot, path), 'utf8'));
	return Array.isArray(artifact) ? artifact : artifact.abi;
}

const vendored = await readAbi('packages/contracts/vendored/MultiVaultSizeFit.json');
const indexer = await readAbi('crates/rindexer-ingestion/abi/MultiVault.json');
const vendoredFunction = vendored.find(
	(item): item is AbiFunction => item.type === 'function' && item.name === 'createAtomsWithUris'
)!;
const indexerFunction = indexer.find(
	(item): item is AbiFunction => item.type === 'function' && item.name === 'createAtomsWithUris'
)!;
const vendoredEvent = vendored.find(
	(item): item is AbiEvent => item.type === 'event' && item.name === 'AtomContextRegistered'
)!;
const indexerEvent = indexer.find(
	(item): item is AbiEvent => item.type === 'event' && item.name === 'AtomContextRegistered'
)!;

(available ? describe : describe.skip)('packed URI creation conformance', () => {
	let consumer: string | undefined;
	let golden: Golden;
	let nodeOutput: Buffer;
	let bunOutput: Buffer;
	let nodeIdentity: RuntimeIdentity;
	let bunIdentity: RuntimeIdentity;

	beforeAll(async () => {
		if (!trainDirectory) throw new Error('INTUITION_TRAIN_TARBALLS is required inside the suite');
		if (nodeBinary === '') {
			throw new Error('INTUITION_CONFORMANCE_NODE is empty; supply a Node >= 22 executable');
		}
		if (!nodeBinary) {
			throw new Error(
				'No node binary on PATH; set INTUITION_CONFORMANCE_NODE to a Node >= 22 executable'
			);
		}
		nodeIdentity = runtimeIdentity(nodeBinary);
		const nodeMajor = Number(/^v(\d+)\./.exec(nodeIdentity.node)?.[1]);
		if (nodeIdentity.bun !== null || !Number.isInteger(nodeMajor) || nodeMajor < 22) {
			throw new Error(
				`INTUITION_CONFORMANCE_NODE must select Node >= 22 without Bun; got ${JSON.stringify(nodeIdentity)}`
			);
		}
		bunIdentity = runtimeIdentity(process.execPath);
		if (typeof bunIdentity.bun !== 'string' || bunIdentity.bun.length === 0) {
			throw new Error(`Second runtime slot must report Bun; got ${JSON.stringify(bunIdentity)}`);
		}
		consumer = await prepareConsumer(trainDirectory);
		const installEvidence = await readFile(join(consumer, 'install-evidence.txt'), 'utf8');
		console.info(installEvidence.split('\n').find((line) => line.includes('packages installed')));
		const outputs = [nodeBinary as string, process.execPath].map((runtime) => {
			const result = Bun.spawnSync([runtime, 'golden.mjs'], {
				cwd: consumer,
				stdout: 'pipe',
				stderr: 'pipe',
				timeout: 30_000,
			});
			if (result.exitCode !== 0) throw new Error(`Consumer runtime failed:\n${result.stderr}`);
			return result.stdout;
		});
		[nodeOutput, bunOutput] = outputs;
		golden = JSON.parse(nodeOutput.toString());
	}, 60_000);

	afterAll(async () => {
		if (consumer) await rm(consumer, { recursive: true, force: true });
	});

	test('Node and Bun produce byte-identical vectors through public exports only', () => {
		expect(bunOutput.equals(nodeOutput)).toBe(true);
		console.info(
			`C13 Node/Bun byte identity: ${nodeOutput.length} bytes; sha256=${createHash('sha256').update(nodeOutput).digest('hex')}; Node=${JSON.stringify(nodeIdentity)}; Bun=${JSON.stringify(bunIdentity)}`
		);
		expect(golden.publicEntrypoints).toMatchObject({
			exports: ['.', './package.json'],
			deepImportRejected: true,
			installedTarballsOnly: true,
		});
	});

	test('train, vendored and indexer ABI shapes, selectors and topic0 agree', () => {
		expect(golden.abi.functionItem).toEqual(vendoredFunction);
		expect(golden.abi.functionItem).toEqual(indexerFunction);
		expect(golden.abi.eventItem).toEqual(vendoredEvent);
		expect(golden.abi.eventItem).toEqual(indexerEvent);
		for (const item of [vendoredFunction, indexerFunction]) {
			expect(viem.toFunctionSelector(item)).toBe(golden.selector);
		}
		for (const item of [vendoredEvent, indexerEvent]) {
			expect(viem.toEventSelector(item)).toBe(golden.topic0);
		}
	});

	test('Core decodes calldata and constructs ordered per-atom logs for every vector', () => {
		expect(golden.vectors).toHaveLength(9);
		expect(golden.vectors.map((vector) => vector.name)).toEqual([
			'string-one-uri',
			'string-two-uris',
			'url-one-uri',
			'url-two-uris',
			'raw-bytes-one-uri',
			'raw-bytes-two-uris',
			'json-one-uri',
			'json-two-uris',
			'mixed-three-atom-batch',
		]);
		expect(golden.vectors.at(-1)!.inputs.uris.map((uris) => uris.length)).toEqual([2, 1, 0]);
		for (const vector of golden.vectors) {
			const { inputs } = vector;
			const decoded = viem.decodeFunctionData({ abi: vendored, data: vector.calldata });
			expect(decoded.functionName).toBe('createAtomsWithUris');
			expect(decoded.args).toEqual([
				inputs.creator,
				inputs.data,
				inputs.assets.map(BigInt),
				inputs.uris,
			]);
			expect(vector.selector).toBe(golden.selector);
			expect(vector.topic0).toBe(golden.topic0);
			expect(vector.logs).toHaveLength(inputs.data.length);
			for (const [index, log] of vector.logs.entries()) {
				const topics = viem.encodeEventTopics({
					abi: [vendoredEvent],
					eventName: 'AtomContextRegistered',
					args: { termId: vector.termIds[index], registrant: inputs.creator },
				});
				const data = viem.encodeAbiParameters(
					vendoredEvent.inputs.filter((input) => !input.indexed),
					[inputs.uris[index]]
				);
				expect(log.topics).toEqual(topics);
				expect(log.data).toBe(data);
				const event = viem.decodeEventLog({
					abi: [indexerEvent],
					topics: log.topics,
					data: log.data,
				});
				expect(event.eventName).toBe('AtomContextRegistered');
				expect(event.args).toEqual({
					termId: vector.termIds[index],
					registrant: inputs.creator,
					uris: inputs.uris[index],
				});
				expect(inputs.uris[index]).toEqual(
					inputs.uriTexts[index].map((text) => viem.stringToHex(text))
				);
			}
		}
	});

	test('packed ids agree with installed ids and Core on string, URL, raw bytes and JSON', () => {
		for (const vector of golden.vectors) {
			for (const [index, atom] of vector.atoms.entries()) {
				expect(vector.termIds[index]).toBe(installedIds.calculateAtomId(atom.input));
				expect(vector.termIds[index]).toBe(kgAtomId(atom.input));
				expect(atom.data).toBe(viem.isHex(atom.input) ? atom.input : viem.stringToHex(atom.input));
			}
		}
	});

	test('decoded calldata atom ids equal original input ids for every vector', () => {
		for (const vector of golden.vectors) {
			const decoded = viem.decodeFunctionData({ abi: vendored, data: vector.calldata });
			const data = decoded.args![1] as readonly Hex[];
			for (const [index, atom] of vector.atoms.entries()) {
				expect(kgAtomId(data[index])).toBe(kgAtomId(atom.input));
			}
		}
	});

	// Probe: args = [0x1111111111111111111111111111111111111111, ['0xabc'], [1n], [[]]], value = 1n.
	// Public validation accepts it; calldata decodes to 0xabc0, while ids hash 0x0abc bytes.
	test.todo('odd-length hex atom data is rejected by the public validator (public packages finding: builder bytes 0xabc0 vs id helpers 0x0abc)', () => {
		const result = Bun.spawnSync(
			[
				process.execPath,
				'--input-type=module',
				'-e',
				`import { multiVaultValidateCreateAtomsWithUris } from '@0xintuition/protocol';
let rejected = false;
try {
  multiVaultValidateCreateAtomsWithUris({
    args: ['0x1111111111111111111111111111111111111111', ['0xabc'], [1n], [[]]],
    value: 1n,
  });
} catch { rejected = true; }
if (!rejected) throw new Error('Public validator accepted odd-length hex atom data 0xabc');`,
			],
			{ cwd: consumer, stdout: 'pipe', stderr: 'pipe', timeout: 30_000 }
		);
		expect(result.exitCode).toBe(0);
	});

	test('typed event columns represent all three event arguments', () => {
		const columns = getTableColumns(atomContextRegisteredEvents);
		const argumentNames = indexerEvent.inputs.map((input) => input.name).sort();
		expect(argumentNames).toEqual(['registrant', 'termId', 'uris']);
		expect(
			Object.keys(columns)
				.filter((name) => argumentNames.includes(name))
				.sort()
		).toEqual(argumentNames);
		expect([columns.termId.name, columns.registrant.name, columns.uris.name]).toEqual([
			'term_id',
			'registrant',
			'uris',
		]);
		expect([columns.termIdHex.name, columns.termIdHex.notNull, columns.uris.dataType]).toEqual([
			'term_id_hex',
			true,
			'json',
		]);
	});

	test('validator and encoder reject malformed arrays, value and supplied URI limits', () => {
		expect(golden.rejections).toEqual([
			{
				name: 'misaligned-uris',
				reason: 'atom data, assets, and URI outer arrays must have the same length',
			},
			{
				name: 'misaligned-assets',
				reason: 'atom data, assets, and URI outer arrays must have the same length',
			},
			{ name: 'zero-creator', reason: 'creator must not be the zero address' },
			{ name: 'empty-batch', reason: 'createAtomsWithUris requires at least one atom' },
			{ name: 'wrong-value', reason: 'value must equal the sum of atom assets' },
			{ name: 'uri-count-limit', reason: 'atom URI count exceeds the supplied live limit' },
			{
				name: 'uri-byte-length-limit',
				reason: 'atom URI byte length exceeds the supplied live limit',
			},
		]);
	});

	test('regenerated vectors match the committed replay fixture', async () => {
		const fixture = JSON.parse(
			await readFile(join(coreRoot, 'tests/conformance/fixtures/uri-creation-golden.json'), 'utf8')
		);
		expect(golden).toEqual(fixture);
	});
});
